import { useEffect, useMemo, useState } from 'react';
import type { GlucosePoint } from './parseClarityExport';
import { glucoseAtTime, inferGlucoseTrend } from './parseClarityExport';

/**
 * Virtual timeline ms advanced per **real** ms (`next += dt * compression`).
 * `1` ≈ replay at real-world clock; `60` ≈ 1 minute of CGM time per 1 second wall time.
 */
export const DEFAULT_TIME_COMPRESSION = 10;

/** Preset “virtual ÷ real” multipliers (see module comment). */
export const CGM_SPEED_PRESETS = [
  { label: 'Creep', compression: 4 },
  { label: 'Slow', compression: 10 },
  { label: 'Med', compression: 22 },
  { label: 'Quick', compression: 55 },
  { label: 'Fast', compression: 160 },
] as const;

export function useSimulatedCgmPlayback(
  points: GlucosePoint[],
  opts?: { timeCompression?: number; playing?: boolean },
) {
  const compression = opts?.timeCompression ?? DEFAULT_TIME_COMPRESSION;
  const wantPlay = opts?.playing !== false;

  const tStart = points[0]?.t ?? Date.now();
  const tEnd = points[points.length - 1]?.t ?? Date.now();
  const span = Math.max(60_000, tEnd - tStart);

  const [playbackT, setPlaybackT] = useState(() => tStart + span * 0.25);

  useEffect(() => {
    if (points.length < 2 || !wantPlay) return;
    let last = Date.now();
    const id = setInterval(() => {
      const now = Date.now();
      const dt = Math.min(250, now - last);
      last = now;
      setPlaybackT((t) => {
        let next = t + dt * compression;
        while (next >= tEnd) next -= span;
        while (next < tStart) next += span;
        return next;
      });
    }, 16);
    return () => clearInterval(id);
  }, [points, wantPlay, compression, tStart, tEnd, span]);

  useEffect(() => {
    if (points.length < 2) return;
    setPlaybackT(tStart + span * 0.22);
  }, [points, tStart, span]);

  const displayMgdl = useMemo(() => glucoseAtTime(points, playbackT), [points, playbackT]);
  const trend = useMemo(() => inferGlucoseTrend(points, playbackT), [points, playbackT]);

  return { playbackT, displayMgdl, trend, tStart, tEnd, span };
}
