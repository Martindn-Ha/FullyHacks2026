import fs from 'node:fs';
import path from 'node:path';

/**
 * Serves the first `Clarity_Export*.csv` under repo `dummydata/` (gitignored) for mobile demo graphs.
 * `cwd` is usually `backend/` when running `npm run dev`.
 */
export function tryReadClarityDemoCsv(): string | null {
  const candidates = [
    path.resolve(process.cwd(), '..', 'dummydata'),
    path.resolve(process.cwd(), 'dummydata'),
  ];
  for (const dir of candidates) {
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue;
    const files = fs
      .readdirSync(dir)
      .filter(
        (f) =>
          f.toLowerCase().endsWith('.csv') &&
          (f.toLowerCase().includes('clarity') || f.toLowerCase().includes('export')),
      )
      .sort();
    if (!files.length) continue;
    const full = path.join(dir, files[0]);
    try {
      return fs.readFileSync(full, 'utf8');
    } catch {
      /* try next dir */
    }
  }
  return null;
}
