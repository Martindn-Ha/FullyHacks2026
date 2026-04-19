Spike model — copy this whole folder to your other computer / app repo.

Contents
--------
- model_bundle/     Trained model + metadata (see below)
- export_spike_bundle.py   load_bundle(), export_bundle()
- realtime_spike.py        latest_feature_row_for_model() for streaming / graph playhead
- train_clarity_spikes.py  load_clarity_cgm(), build_feature_table_from_cgm() — required for feature engineering
- requirements-inference.txt   pip install -r this file (Python inference stack)

If model_bundle is missing lgbm_spike_classifier.joblib
------------------------------------------------------------
On this machine, run the export cell in train_spikes.ipynb, then copy the
updated model_bundle/ folder into spike_model_app/ again.

Other computer
--------------
  cd spike_model_app
  pip install -r requirements-inference.txt

Python:

  from pathlib import Path
  from export_spike_bundle import load_bundle
  from realtime_spike import latest_feature_row_for_model

  clf, meta = load_bundle(Path("model_bundle"))
  # buffer_df: columns time, glucose_mg_dl, event_type (EGV rows)
  row = latest_feature_row_for_model(buffer_df, meta)
  if row is not None:
      p = float(clf.predict_proba(row)[0, 1])
