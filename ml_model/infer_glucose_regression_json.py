#!/usr/bin/env python3
"""
stdin:  { "points": [ { "t": epoch_ms, "mgdl": number }, ... ] }
stdout: { "ready": true, "task": "...", "predictedMaxMgDl": float, "spikeProbability": 0-1 (UI heat),
          "thresholdMgDl", "horizonMinutes", "nPointsUsed", ... }
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from export_regression_bundle import load_regression_bundle
from realtime_timeseries import latest_feature_row_for_regressor


def _risk_01(predicted_mg_dl: float, threshold: float) -> float:
    """Map predicted max glucose to 0–1 for existing app band tint (linear ramp above threshold)."""
    if not np.isfinite(predicted_mg_dl) or not np.isfinite(threshold):
        return 0.0
    return float(max(0.0, min(1.0, (predicted_mg_dl - threshold) / 80.0)))


def main() -> None:
    bundle = ROOT
    meta_path = bundle / "timeseries_model_meta.json"
    model_path = bundle / "glucose_regressor.joblib"
    if not meta_path.is_file() or not model_path.is_file():
        print(json.dumps({"ready": False, "error": "model_bundle_missing"}))
        return

    try:
        raw = sys.stdin.read()
        data = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError as e:
        print(json.dumps({"ready": False, "error": "invalid_json", "message": str(e)}))
        return

    pts = data.get("points")
    if not isinstance(pts, list) or len(pts) == 0:
        print(json.dumps({"ready": False, "error": "no_points"}))
        return

    rows: list[dict] = []
    for p in pts:
        if not isinstance(p, dict):
            continue
        t = p.get("t")
        g = p.get("mgdl")
        try:
            t_i = int(t)
            g_f = float(g)
        except (TypeError, ValueError):
            continue
        if not (np.isfinite(g_f) and g_f > 0):
            continue
        rows.append(
            {
                "time": pd.Timestamp(t_i, unit="ms"),
                "glucose_mg_dl": float(g_f),
                "event_type": "EGV",
            }
        )

    df = pd.DataFrame(rows).sort_values("time")
    if df.empty:
        print(json.dumps({"ready": False, "error": "no_valid_points"}))
        return

    try:
        model, meta = load_regression_bundle(bundle)
    except Exception as e:
        print(json.dumps({"ready": False, "error": "load_model", "message": str(e)}))
        return

    try:
        row = latest_feature_row_for_regressor(df, meta)
    except Exception as e:
        print(json.dumps({"ready": False, "error": "features", "message": str(e)}))
        return

    thr = float(meta.get("spike_threshold_mg_dl_for_features", 180.0))
    hz = int(meta.get("horizon_minutes", 30))
    task = str(meta.get("task", "regression_glucose_target"))

    if row is None or row.empty:
        print(
            json.dumps(
                {
                    "ready": False,
                    "spikeProbability": None,
                    "predictedMaxMgDl": None,
                    "reason": "insufficient_history",
                    "thresholdMgDl": thr,
                    "horizonMinutes": hz,
                    "task": task,
                    "nPointsUsed": int(len(df)),
                }
            )
        )
        return

    cols = meta["feature_cols"]
    X_df = row[cols].astype(np.float64)
    try:
        pred = float(np.asarray(model.predict(X_df)).ravel()[0])
    except Exception as e:
        print(json.dumps({"ready": False, "error": "predict", "message": str(e)}))
        return

    spike_prob = _risk_01(pred, thr)

    print(
        json.dumps(
            {
                "ready": True,
                "task": task,
                "predictedMaxMgDl": pred,
                "spikeProbability": spike_prob,
                "thresholdMgDl": thr,
                "horizonMinutes": hz,
                "nPointsUsed": int(len(df)),
            }
        )
    )


if __name__ == "__main__":
    main()
