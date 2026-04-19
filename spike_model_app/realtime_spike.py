"""
Real-time style scoring with a saved spike model.

The classifier expects the same engineered features as training (5-minute grid,
60-minute rollups, etc.). Typical pattern:

1. Keep a rolling in-memory buffer of recent EGV points (time + glucose_mg_dl).
2. On each new reading (or every minute), rebuild features from the buffer and
   take the **last** row — same logic as training, but ``include_label=False``.
3. Run ``clf.predict_proba(X[feature_cols])[:, 1]``.

You need roughly **≥ ~90 minutes** of CGM history in the buffer so rolling
60-minute windows and 15-minute lags are meaningful after resampling (more is safer).

Example::

    from pathlib import Path
    import pandas as pd
    from export_spike_bundle import load_bundle
    from realtime_spike import latest_feature_row_for_model

    clf, meta = load_bundle(Path("model_bundle"))
    # buffer_df: columns time, glucose_mg_dl from your stream
    row = latest_feature_row_for_model(buffer_df, meta)
    if row is not None:
        p = float(clf.predict_proba(row)[0, 1])
"""

from __future__ import annotations

from typing import Any

import pandas as pd

from train_clarity_spikes import build_feature_table_from_cgm


def latest_feature_row_for_model(
    df_cgm: pd.DataFrame,
    meta: dict[str, Any],
    *,
    min_raw_rows: int = 30,
) -> pd.DataFrame | None:
    """
    Return a **single-row** DataFrame with exactly ``meta['feature_cols']``,
    or ``None`` if the buffer is too short / features are not yet defined.
    """
    if len(df_cgm) < min_raw_rows:
        return None
    cols = meta["feature_cols"]
    thr = float(meta.get("spike_threshold_mg_dl", 180.0))
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
