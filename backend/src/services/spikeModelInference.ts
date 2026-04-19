import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Response shape from `ml_model/infer_glucose_regression_json.py` (Ridge time-series regression bundle). */
export type SpikeRiskResult = {
  ready: boolean;
  /** 0–1 heat for the existing graph band (derived from predicted max vs threshold). */
  spikeProbability?: number | null;
  /** Predicted maximum glucose in `(t, t+horizon]` on the 5-minute grid (regression target). */
  predictedMaxMgDl?: number | null;
  task?: string;
  thresholdMgDl?: number;
  horizonMinutes?: number;
  nPointsUsed?: number;
  error?: string;
  reason?: string;
  message?: string;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** Repo root: backend/src/services → …/FullyHacks2026 */
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

function defaultInferScript(): string {
  return path.join(REPO_ROOT, 'ml_model', 'infer_glucose_regression_json.py');
}

/**
 * Prefer `ML_MODEL_PYTHON`, then legacy `SPIKE_PYTHON`, else `ml_model/.venv`, else `spike_model_app/.venv`, else `python3`.
 */
function resolveMlModelPython(): string {
  const fromEnv = process.env.ML_MODEL_PYTHON?.trim() || process.env.SPIKE_PYTHON?.trim();
  if (fromEnv) return fromEnv;
  const mlVenv =
    process.platform === 'win32'
      ? path.join(REPO_ROOT, 'ml_model', '.venv', 'Scripts', 'python.exe')
      : path.join(REPO_ROOT, 'ml_model', '.venv', 'bin', 'python3');
  if (existsSync(mlVenv)) return mlVenv;
  const legacyVenv =
    process.platform === 'win32'
      ? path.join(REPO_ROOT, 'spike_model_app', '.venv', 'Scripts', 'python.exe')
      : path.join(REPO_ROOT, 'spike_model_app', '.venv', 'bin', 'python3');
  if (existsSync(legacyVenv)) return legacyVenv;
  return 'python3';
}

function inferScriptPath(): string {
  return (
    process.env.ML_MODEL_INFER_SCRIPT?.trim() ||
    process.env.SPIKE_INFER_SCRIPT?.trim() ||
    defaultInferScript()
  );
}

function inferTimeoutMs(): number {
  return Number(
    process.env.ML_MODEL_INFER_TIMEOUT_MS ||
      process.env.SPIKE_INFER_TIMEOUT_MS ||
      25_000,
  );
}

/**
 * Runs the Ridge regression glucose bundle via Python (`ml_model/`).
 * Returns `{ ready: false }` if Python or dependencies are missing — does not throw for ops issues.
 */
export function runSpikeModelInference(points: { t: number; mgdl: number }[]): SpikeRiskResult {
  const python = resolveMlModelPython();
  const script = inferScriptPath();

  const payload = JSON.stringify({ points });
  const r = spawnSync(python, [script], {
    input: payload,
    encoding: 'utf-8',
    maxBuffer: 10 * 1024 * 1024,
    timeout: inferTimeoutMs(),
    env: { ...process.env },
  });

  if (r.error) {
    const msg = r.error.message;
    console.warn('[ml-model]', msg);
    return { ready: false, error: 'spawn_failed', message: msg };
  }
  if (r.status !== 0) {
    const stderr = (r.stderr || '').trim();
    console.warn('[ml-model] exit', r.status, stderr || r.stdout);
    return {
      ready: false,
      error: 'python_exit',
      message: stderr || `exit ${r.status}`,
    };
  }

  const out = (r.stdout || '').trim();
  if (!out) {
    return { ready: false, error: 'empty_output' };
  }
  try {
    return JSON.parse(out) as SpikeRiskResult;
  } catch {
    return { ready: false, error: 'invalid_model_output', message: out.slice(0, 200) };
  }
}
