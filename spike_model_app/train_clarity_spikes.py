"""
Train LightGBM on Dexcom Clarity CSV exports to predict glucose spikes
(>= threshold mg/dL) within the next horizon minutes.

Defaults match classic_ml.ipynb: 5-minute grid, 60-minute history features,
label = any reading > 180 in the next 30 minutes. Hold out 20% of people
(one export file = one person_id) for validation.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from lightgbm import LGBMClassifier
from sklearn.metrics import classification_report, roc_auc_score


def load_clarity_cgm(csv_path: Path) -> pd.DataFrame:
    """Load EGV rows from a Dexcom Clarity export CSV."""
    df = pd.read_csv(csv_path, low_memory=False)
    # Normalize column names (exports sometimes differ slightly)
    col_map = {c: c.strip().strip('"') for c in df.columns}
    df = df.rename(columns=col_map)

    ts_name = "Timestamp (YYYY-MM-DDThh:mm:ss)"
    ts_col = ts_name if ts_name in df.columns else None
    if ts_col is None:
        # Fallback: any column containing Timestamp
        hits = [c for c in df.columns if "timestamp" in c.lower()]
        ts_col = hits[0] if hits else None
    if ts_col is None:
        raise ValueError(f"No timestamp column in {csv_path.name}: {list(df.columns)}")

    if "Event Type" not in df.columns:
        raise ValueError(f"No 'Event Type' column in {csv_path.name}")
    if "Glucose Value (mg/dL)" not in df.columns:
        raise ValueError(f"No glucose column in {csv_path.name}")

    sub = df.loc[df["Event Type"].astype(str).str.strip() == "EGV"].copy()
    sub["time"] = pd.to_datetime(sub[ts_col], errors="coerce")
    sub["glucose_mg_dl"] = pd.to_numeric(
        sub["Glucose Value (mg/dL)"], errors="coerce"
    )
    sub = sub.dropna(subset=["time", "glucose_mg_dl"])
    sub["event_type"] = "EGV"
    out = sub[["time", "glucose_mg_dl", "event_type"]].sort_values("time")
    return out.reset_index(drop=True)


def build_feature_table_from_cgm(
    df_cgm: pd.DataFrame,
    person_id: int,
    spike_mg_dl: float,
    horizon_minutes: int,
    *,
    include_label: bool = True,
) -> pd.DataFrame:
    """5-minute grid, rolling 60-minute features, optional forward spike label.

    For real-time inference use ``include_label=False`` so rows are not dropped
    because future labels are unknown; only past-based features are needed.
    """
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


def discover_csvs(data_dir: Path) -> list[Path]:
    paths = sorted(data_dir.glob("Clarity_Export_*.csv"))
    if not paths:
        paths = sorted(data_dir.glob("**/*.csv"))
    return [p for p in paths if p.is_file()]


def main() -> int:
    p = argparse.ArgumentParser(description="LightGBM spike prediction on Clarity CSVs")
    p.add_argument(
        "--data-dir",
        type=Path,
        default=None,
        help="Folder with Clarity_Export_*.csv (default: drive-download-* under cwd)",
    )
    p.add_argument("--spike-threshold", type=float, default=180.0)
    p.add_argument("--horizon-minutes", type=int, default=30)
    p.add_argument("--val-fraction", type=float, default=0.2)
    p.add_argument("--max-people", type=int, default=None)
    p.add_argument("--min-rows", type=int, default=12)
    args = p.parse_args()

    cwd = Path.cwd()
    if args.data_dir is not None:
        data_dir = args.data_dir.resolve()
    else:
        candidates = sorted(cwd.glob("drive-download-*"))
        data_dir = candidates[0].resolve() if candidates else cwd

    if not data_dir.is_dir():
        print(f"Not a directory: {data_dir}", file=sys.stderr)
        return 1

    csv_paths = discover_csvs(data_dir)
    if not csv_paths:
        print(f"No CSV exports found under {data_dir}", file=sys.stderr)
        return 1

    # Stable person_id from filename order
    stems = [x.stem for x in csv_paths]
    pid_by_stem = {s: i + 1 for i, s in enumerate(sorted(set(stems)))}

    feat_parts: list[pd.DataFrame] = []
    errors: list[tuple[str, str]] = []

    id_list = csv_paths
    if args.max_people is not None:
        id_list = id_list[: args.max_people]

    for path in id_list:
        pid = pid_by_stem[path.stem]
        try:
            raw = load_clarity_cgm(path)
            if raw.empty:
                errors.append((path.name, "no_egv_rows"))
                continue
            feat = build_feature_table_from_cgm(
                raw,
                pid,
                spike_mg_dl=args.spike_threshold,
                horizon_minutes=args.horizon_minutes,
            )
            if len(feat) >= args.min_rows:
                feat_parts.append(feat)
            else:
                errors.append((path.name, "too_few_rows"))
        except Exception as e:
            errors.append((path.name, repr(e)))
            continue

    print(f"Data dir: {data_dir}")
    print(f"CSV files: {len(csv_paths)}, feature tables OK: {len(feat_parts)}, errors: {len(errors)}")
    if errors:
        print("Sample errors:", errors[:10])

    if not feat_parts:
        print("No usable feature tables.", file=sys.stderr)
        return 1

    df_feat = pd.concat(feat_parts, ignore_index=True)

    _exclude = {"label_spike", "person_id", "time"}
    feature_cols = [c for c in df_feat.columns if c not in _exclude]

    all_pids = np.sort(df_feat["person_id"].unique())
    n = len(all_pids)
    n_val = max(1, int(round(args.val_fraction * n)))
    n_train = n - n_val
    if n_train < 1:
        n_train = 1
        n_val = n - 1
    train_pids = all_pids[:n_train]
    val_pids = all_pids[n_train:]

    train_df = df_feat[df_feat["person_id"].isin(train_pids)]
    val_df = df_feat[df_feat["person_id"].isin(val_pids)]

    X_train = train_df[feature_cols]
    X_val = val_df[feature_cols]
    y_train = train_df["label_spike"]
    y_val = val_df["label_spike"]

    pos_rate = float(y_train.mean())
    print(
        f"\nTrain rows: {len(train_df):,} ({len(train_pids)} people), "
        f"positive rate: {pos_rate:.4f}"
    )
    print(
        f"Val rows:   {len(val_df):,} ({len(val_pids)} people), "
        f"positive rate: {float(y_val.mean()):.4f}"
    )

    clf = LGBMClassifier(
        n_estimators=300,
        learning_rate=0.05,
        num_leaves=31,
        max_depth=-1,
        class_weight="balanced",
        random_state=42,
        n_jobs=-1,
        verbosity=-1,
    )
    clf.fit(X_train, y_train)

    y_pred = clf.predict(X_val)
    y_proba = clf.predict_proba(X_val)[:, 1]

    if len(np.unique(y_val)) < 2:
        print("\nValidation set has a single class; ROC-AUC is undefined.")
    else:
        print("\nROC-AUC:", roc_auc_score(y_val, y_proba))
    print("\nClassification report (validation):\n")
    print(classification_report(y_val, y_pred, digits=3))

    imp = pd.DataFrame({"feature": feature_cols, "importance": clf.feature_importances_})
    imp = imp.sort_values("importance", ascending=False)
    print("\nTop features by gain/split importance:\n", imp.to_string(index=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
