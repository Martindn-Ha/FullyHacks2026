#!/usr/bin/env node
/**
 * Launcher from repo root. Real script: backend/scripts/hd-start-website-index.mjs
 *
 *   cd FullyHacks2026 && HUMAN_DELTA_API_KEY=… node scripts/hd-start-website-index.mjs --poll
 */

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const target = path.join(__dirname, '..', 'backend', 'scripts', 'hd-start-website-index.mjs');

const r = spawnSync(process.execPath, [target, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: process.env,
  cwd: path.join(__dirname, '..', 'backend'),
});
process.exit(r.status === null ? 1 : r.status);
