/** One CGM-style glucose sample (Dexcom / Stelo export ≈ every 5 minutes for EGV). */
export type GlucosePoint = { t: number; mgdl: number };

function splitCsvRow(line: string): string[] {
  return line.split(',').map((c) => c.trim());
}

/**
 * Parses Dexcom Clarity CSV (Stelo / G7 style) — uses `Event Type` = EGV and
 * `Glucose Value (mg/dL)` plus `Timestamp (YYYY-MM-DDThh:mm:ss)`.
 */
export function parseClarityExportCsv(csvText: string): GlucosePoint[] {
  const lines = csvText.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  const header = splitCsvRow(lines[0]);
  const idxTs = header.findIndex((h) => h.includes('Timestamp'));
  const idxEv = header.findIndex((h) => h === 'Event Type' || h.startsWith('Event Type'));
  const idxGlu = header.findIndex((h) => h.includes('Glucose Value'));
  if (idxTs < 0 || idxEv < 0 || idxGlu < 0) return [];

  const out: GlucosePoint[] = [];
  for (let i = 1; i < lines.length; i++) {
    const row = lines[i];
    if (!row) continue;
    const cells = splitCsvRow(row);
    if (cells[idxEv] !== 'EGV') continue;
    const ts = cells[idxTs];
    if (!ts) continue;
    const g = Number(cells[idxGlu]);
    if (!Number.isFinite(g) || g <= 0) continue;
    const t = Date.parse(ts);
    if (!Number.isFinite(t)) continue;
    out.push({ t, mgdl: Math.round(g) });
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

/** Smoothstep between CGM points (~5 min apart) + tiny slow ripple so motion feels “alive”. */
export function glucoseAtTime(points: GlucosePoint[], t: number): number {
  if (points.length === 0) return 100;
  if (t <= points[0].t) return points[0].mgdl;
  const last = points[points.length - 1];
  if (t >= last.t) return last.mgdl;

  let lo = 0;
  let hi = points.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const a = points[lo];
  const b = points[hi];
  const span = b.t - a.t;
  const frac = span > 0 ? (t - a.t) / span : 0;
  const s = frac * frac * (3 - 2 * frac);
  let v = a.mgdl + (b.mgdl - a.mgdl) * s;
  v += Math.sin(t / 42000) * 0.55;
  return Math.round(Math.max(40, Math.min(400, v)));
}

export function inferGlucoseTrend(points: GlucosePoint[], t: number, lookbackMs = 15 * 60 * 1000) {
  const now = glucoseAtTime(points, t);
  const past = glucoseAtTime(points, Math.max(points[0]?.t ?? t, t - lookbackMs));
  const d = now - past;
  if (d > 4) return 'rising' as const;
  if (d < -4) return 'falling' as const;
  return 'stable' as const;
}

/** Bundled fallback when `dummydata/` is absent or `/api/clarity-demo` is unreachable. */
export function buildSyntheticClarityCsv(): string {
  const header =
    'Index,Timestamp (YYYY-MM-DDThh:mm:ss),Event Type,Event Subtype,Patient Info,Device Info,Source Device ID,Glucose Value (mg/dL),Insulin Value (u),Carb Value (grams),Duration (hh:mm:ss),Glucose Rate of Change (mg/dL/min),Transmitter Time (Long Integer),Transmitter ID';
  const rows: string[] = [];
  const base = Date.UTC(2026, 3, 16, 6, 0, 0);
  let v = 108;
  for (let i = 0; i < 400; i++) {
    const t = base + i * 5 * 60 * 1000;
    const iso = new Date(t).toISOString().slice(0, 19);
    v += Math.sin(i / 9) * 3.2 + (Math.random() - 0.48) * 5;
    v = Math.max(76, Math.min(175, v));
    rows.push(`${i + 5},${iso},EGV,,,,Demo,,${Math.round(v)},,,,,,`);
  }
  return [header, ...rows].join('\n');
}
