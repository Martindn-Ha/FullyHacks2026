Glucose regression bundle — app integration
==================================================

What this folder contains
--------------------------
  glucose_regressor.joblib     — trained model (joblib)
  timeseries_model_meta.json   — feature order + training settings (JSON)
  README_APP.txt         — this file

What the model predicts
------------------------
  target_mode: max_in_window
  horizon_minutes: 30
  Meaning: Maximum glucose in (t, t+horizon] on the 5-minute grid (excludes current bin).
  Trained estimator: sklearn.linear_model._ridge.Ridge

Python dependencies
----------------------
  pip install numpy pandas scikit-learn joblib

Files to copy into your app project
------------------------------------
  1. This entire bundle directory (keep files together).
  2. From the training repo, copy these modules next to your app code
     (same versions you used to export):
       - train_clarity_spikes.py   (load_clarity_cgm + feature engineering)
       - export_timeseries_bundle.py (load_regression_bundle)
       - realtime_timeseries.py   (optional helper for one-row features)

Minimal prediction example
----------------------------
  from pathlib import Path
  from export_timeseries_bundle import load_regression_bundle
  from realtime_timeseries import latest_feature_row_for_regressor
  from train_clarity_spikes import load_clarity_cgm

  bundle = Path('timeseries_model_bundle')  # path to this folder
  model, meta = load_regression_bundle(bundle)
  raw = load_clarity_cgm(Path('path/to/Clarity_Export_....csv'))
  # Need enough recent EGV rows (same as training, default min 30).
  X = latest_feature_row_for_regressor(raw, meta)
  if X is not None:
      predicted_mg_dl = float(model.predict(X)[0])

Without realtime_timeseries: use build_feature_table_from_cgm from
train_clarity_spikes with include_label=False, spike_mg_dl=meta's
spike_threshold_mg_dl_for_features, horizon_minutes=meta's value,
then take the last row's columns in meta['feature_cols'] order.

Important
-----------
  - Feature columns MUST match meta['feature_cols'] order exactly.
  - Use the same 5-minute Clarity pipeline as training (see train_clarity_spikes).
  - Prediction is for the label defined at training time (see target_summary).
