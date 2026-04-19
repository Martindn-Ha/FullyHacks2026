"""Build the latest regression feature row (same column contract as training)."""

from __future__ import annotations

from typing import Any

import pandas as pd

from feature_table import build_feature_table_from_cgm


def latest_feature_row_for_regressor(
    df_cgm: pd.DataFrame,
    meta: dict[str, Any],
    *,
    min_raw_rows: int = 30,
) -> pd.DataFrame | None:
    if len(df_cgm) < min_raw_rows:
        return None
    cols = meta["feature_cols"]
    thr = float(meta.get("spike_threshold_mg_dl_for_features", 180.0))
    hz = int(meta.get("horizon_minutes", 30))
    feat = build_feature_table_from_cgm(
        df_cgm,
        person_id=0,
        spike_mg_dl=thr,
        horizon_minutes=hz,
        include_label=False,
    )
    if feat.empty:
        return None
    last = feat.iloc[[-1]]
    missing = [c for c in cols if c not in last.columns]
    if missing:
        raise ValueError(f"Feature columns missing from engineered row: {missing}")
    return last[cols]
