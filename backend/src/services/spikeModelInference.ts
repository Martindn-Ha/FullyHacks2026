import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Response shape from `spike_model_app/infer_spike_json.py`. */
export type SpikeRiskResult = {
  ready: boolean;
  spikeProbability?: number | null;
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
  return path.join(REPO_ROOT, 'spike_model_app', 'infer_spike_json.py');
}

/** Prefer `SPIKE_PYTHON`, else repo `spike_model_app/.venv` (PEP 668–safe), else `python3`. */
function resolveSpikePython(): string {
  const fromEnv = process.env.SPIKE_PYTHON?.trim();
  if (fromEnv) return fromEnv;
  const venvExe =
    process.platform === 'win32'
      ? path.join(REPO_ROOT, 'spike_model_app', '.venv', 'Scripts', 'python.exe')
      : path.join(REPO_ROOT, 'spike_model_app', '.venv', 'bin', 'python3');
  if (existsSync(venvExe)) return venvExe;
  return 'python3';
}

/**
 * Runs the LightGBM spike bundle via Python (see `spike_model_app/requirements-inference.txt`).
 * Returns `{ ready: false }` if Python or dependencies are missing — does not throw for ops issues.
 */
export function runSpikeModelInference(points: { t: number; mgdl: number }[]): SpikeRiskResult {
  const python = resolveSpikePython();
  const script = process.env.SPIKE_INFER_SCRIPT?.trim() || defaultInferScript();

  const payload = JSON.stringify({ points });
  const r = spawnSync(python, [script], {
    input: payload,
    encoding: 'utf-8',
    maxBuffer: 10 * 1024 * 1024,
    timeout: Number(process.env.SPIKE_INFER_TIMEOUT_MS || 25_000),
    env: { ...process.env },
  });

  if (r.error) {
    const msg = r.error.message;
    console.warn('[spike-model]', msg);
    return { ready: false, error: 'spawn_failed', message: msg };
  }
  if (r.status !== 0) {
    const stderr = (r.stderr || '').trim();
    console.warn('[spike-model] exit', r.status, stderr || r.stdout);
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
