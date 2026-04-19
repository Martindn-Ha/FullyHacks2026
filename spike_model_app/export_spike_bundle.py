"""
Save / load the trained spike classifier for use in another Python app.

After training in train_spikes.ipynb (variable `clf` and `feature_cols`):

    from export_spike_bundle import export_bundle
    export_bundle(clf, feature_cols, Path("model_bundle"))

In your app:

    from export_spike_bundle import load_bundle
    clf, meta = load_bundle(Path("model_bundle"))
    X = row[meta["feature_cols"]]  # pandas DataFrame, same column order
    p = clf.predict_proba(X)[0, 1]
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import joblib


def export_bundle(
    clf: Any,
    feature_cols: list[str],
    out_dir: Path,
    *,
    spike_threshold_mg_dl: float = 180.0,
    horizon_minutes: int = 30,
    extra_meta: dict[str, Any] | None = None,
) -> None:
    """Write joblib (sklearn wrapper), LightGBM native text, and metadata JSON."""
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    joblib.dump(clf, out_dir / "lgbm_spike_classifier.joblib")
    clf.booster_.save_model(str(out_dir / "lgbm_spike_model.txt"))

    meta: dict[str, Any] = {
        "feature_cols": list(feature_cols),
        "spike_threshold_mg_dl": spike_threshold_mg_dl,
        "horizon_minutes": horizon_minutes,
        "sklearn_class": "LGBMClassifier",
    }
    if extra_meta:
        meta.update(extra_meta)
    (out_dir / "spike_model_meta.json").write_text(
        json.dumps(meta, indent=2), encoding="utf-8"
    )


def load_bundle(bundle_dir: Path) -> tuple[Any, dict[str, Any]]:
    """Load classifier + metadata. Requires joblib, lightgbm, sklearn in the app env."""
    bundle_dir = Path(bundle_dir)
    clf = joblib.load(bundle_dir / "lgbm_spike_classifier.joblib")
    meta = json.loads((bundle_dir / "spike_model_meta.json").read_text(encoding="utf-8"))
    return clf, meta


def load_booster_only(bundle_dir: Path):
    """
    Load only the LightGBM Booster (no sklearn wrapper).
    Predict with booster.predict(X) where X is float32/float64 2D array
    in the same column order as meta['feature_cols'].
    """
    import lightgbm as lgb

    bundle_dir = Path(bundle_dir)
    meta = json.loads((bundle_dir / "spike_model_meta.json").read_text(encoding="utf-8"))
    booster = lgb.Booster(model_file=str(bundle_dir / "lgbm_spike_model.txt"))
    return booster, meta
