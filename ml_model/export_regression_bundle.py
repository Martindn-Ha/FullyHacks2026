"""Load Ridge (or sklearn) glucose regressor + metadata from this folder."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import joblib


def load_regression_bundle(bundle_dir: Path) -> tuple[Any, dict[str, Any]]:
    bundle_dir = Path(bundle_dir)
    meta_path = bundle_dir / "timeseries_model_meta.json"
    model_path = bundle_dir / "glucose_regressor.joblib"
    if not meta_path.is_file():
        raise FileNotFoundError(meta_path)
    if not model_path.is_file():
        raise FileNotFoundError(model_path)
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    model = joblib.load(model_path)
    return model, meta
