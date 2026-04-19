#!/usr/bin/env python3
"""
Read JSON from stdin, write JSON to stdout (for Node / Express).

Input:  { "points": [ { "t": epoch_ms, "mgdl": number }, ... ] }
Output: { "ready": true, "spikeProbability": 0.0-1.0, "thresholdMgDl": 180, "horizonMinutes": 30, ... }
        or { "ready": false, "reason": "...", ... }
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

from export_spike_bundle import load_booster_only
from realtime_spike import latest_feature_row_for_model


def main() -> None:
    bundle = ROOT / "model_bundle"
    meta_path = bundle / "spike_model_meta.json"
    model_path = bundle / "lgbm_spike_model.txt"
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
        booster, meta = load_booster_only(bundle)
    except Exception as e:
        print(json.dumps({"ready": False, "error": "load_model", "message": str(e)}))
        return

    try:
        row = latest_feature_row_for_model(df, meta)
    except Exception as e:
        print(json.dumps({"ready": False, "error": "features", "message": str(e)}))
        return

    thr = float(meta.get("spike_threshold_mg_dl", 180.0))
    hz = int(meta.get("horizon_minutes", 30))

    if row is None or row.empty:
        print(
            json.dumps(
                {
                    "ready": False,
                    "spikeProbability": None,
                    "reason": "insufficient_history",
                    "thresholdMgDl": thr,
                    "horizonMinutes": hz,
                    "nPointsUsed": int(len(df)),
                }
            )
        )
        return

    cols = meta["feature_cols"]
    X = row[cols].to_numpy(dtype=np.float64)
    try:
        pred = booster.predict(X)
        proba = float(np.asarray(pred).ravel()[0])
    except Exception as e:
        print(json.dumps({"ready": False, "error": "predict", "message": str(e)}))
        return

    print(
        json.dumps(
            {
                "ready": True,
                "spikeProbability": proba,
                "thresholdMgDl": thr,
                "horizonMinutes": hz,
                "nPointsUsed": int(len(df)),
            }
        )
    )


if __name__ == "__main__":
    main()
