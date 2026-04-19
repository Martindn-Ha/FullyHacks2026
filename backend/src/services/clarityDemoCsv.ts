import fs from 'node:fs';
import path from 'node:path';

export type ClarityDemoDataset = 'nondiabetic' | 'diabetic';

const DEMO_FILES: Record<ClarityDemoDataset, string> = {
  nondiabetic: 'Clarity_Export_Ha_Martin_2026-04-19_015400.csv',
  diabetic: 'diabetic.csv',
};

function dummydataDirs(): string[] {
  return [path.resolve(process.cwd(), '..', 'dummydata'), path.resolve(process.cwd(), 'dummydata')];
}

function readCsvIfPresent(dir: string, fileName: string): string | null {
  const resolvedDir = path.resolve(dir);
  const full = path.resolve(path.join(resolvedDir, fileName));
  const rel = path.relative(resolvedDir, full);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return null;
  try {
    return fs.readFileSync(full, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Reads a fixed demo CSV from repo `dummydata/` (gitignored).
 * `cwd` is usually `backend/` when running `npm run dev`.
 */
export function tryReadClarityDemoCsv(dataset: ClarityDemoDataset = 'nondiabetic'): string | null {
  const fileName = DEMO_FILES[dataset];
  for (const dir of dummydataDirs()) {
    const raw = readCsvIfPresent(dir, fileName);
    if (raw) return raw;
  }
  return null;
}
