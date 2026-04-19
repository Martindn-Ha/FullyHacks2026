"""
5-minute Clarity-style CGM feature grid (same logic as spike training pipeline).
Used by `infer_glucose_regression_json.py` — no LightGBM dependency.
"""

from __future__ import annotations

import numpy as np
import pandas as pd


def build_feature_table_from_cgm(
    df_cgm: pd.DataFrame,
    person_id: int,
    spike_mg_dl: float,
    horizon_minutes: int,
    *,
    include_label: bool = True,
) -> pd.DataFrame:
    """5-minute grid, rolling 60-minute features, optional forward label column."""
    horizon_steps = max(1, int(round(horizon_minutes / 5)))

    df_ts = (
        df_cgm.set_index("time")
        .resample("5min")
        .mean(numeric_only=True)
        .interpolate("time")
    )
    window = "60min"
    df_ts["mean_60"] = df_ts["glucose_mg_dl"].rolling(window, min_periods=3).mean()
    df_ts["std_60"] = df_ts["glucose_mg_dl"].rolling(window, min_periods=3).std()
    df_ts["min_60"] = df_ts["glucose_mg_dl"].rolling(window, min_periods=3).min()
    df_ts["max_60"] = df_ts["glucose_mg_dl"].rolling(window, min_periods=3).max()
    df_ts["glucose_lag_15"] = df_ts["glucose_mg_dl"].shift(3)
    df_ts["slope_15"] = df_ts["glucose_mg_dl"] - df_ts["glucose_lag_15"]
    idx = df_ts.index
    hour = idx.hour + idx.minute / 60.0
    df_ts["tod_sin"] = np.sin(2 * np.pi * hour / 24.0)
    df_ts["tod_cos"] = np.cos(2 * np.pi * hour / 24.0)

    if include_label:
        values = df_ts["glucose_mg_dl"].to_numpy()
        labels = np.zeros_like(values, dtype=int)
        thr = float(spike_mg_dl)
        for i in range(len(values)):
            j_start = i + 1
            j_end = min(len(values), i + horizon_steps + 1)
            if j_start < j_end and (values[j_start:j_end] > thr).any():
                labels[i] = 1
        df_ts["label_spike"] = labels

    out = df_ts.dropna().copy()
    out = out.reset_index()
    tcol = out.columns[0]
    if tcol != "time":
        out = out.rename(columns={tcol: "time"})
    out["person_id"] = int(person_id)
    return out
