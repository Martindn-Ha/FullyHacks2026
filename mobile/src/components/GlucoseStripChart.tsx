import { memo, useMemo, useState } from 'react';
import { Image as RNImage, Pressable, View, Text, StyleSheet } from 'react-native';
import Svg, { G, Image as SvgImage, Line, Polyline, Rect, Text as SvgText } from 'react-native-svg';
import type { ClarityDemoDataset } from '../api';
import type { GlucosePoint } from '../clarity/parseClarityExport';
import { glucoseLinearUnroundedAtTime } from '../clarity/parseClarityExport';

/**
 * Sprite tuning (what to edit):
 * - **Cloud** — `cloudImageHeight`, **`CLOUD_Y_OFFSET_*`** (shift down from SVG top), `CLOUD_SCALE`; cloud `SvgImage` (`width`/`height`/`x`/`y`/`opacity`/`preserveAspectRatio`), asset `assets/cloud.png`.
 * - **Sea** — top Y from **`SEA_Y_OFFSET_*`** / `demoGlucoseDataset` (258 nondiabetic, 140 diabetic); height fills to chart bottom (`preserveAspectRatio="none"`). Asset `assets/sea.png`.
 * - **Dolphin** — cry when linear glucose at playhead ≥ `targetBandHigh` (from App: 140 nondiabetic, 180 diabetic); `DOLPHIN_W` / `DOLPHIN_H`, dolphin `SvgImage` (`preserveAspectRatio`); calm/cry assets `dolphin.png` / `dolphinCry.png`; position follows `playbackT` + `points` (same as the line).
 * From **App**: `demoGlucoseDataset` → cloud height + cloud/sea Y offsets; `width` / `height` props → whole chart (scales dolphin Y and line with `innerH` / `innerW`). **`visibleRangeHours`** — fewer hours across the plot width = horizontal zoom (wider ML horizon band on screen).
 */

const dolphinPng = require('../../assets/dolphin.png');
const dolphinCryPng = require('../../assets/dolphinCry.png');
const dolphinUri = RNImage.resolveAssetSource(dolphinPng).uri;
const dolphinCryUri = RNImage.resolveAssetSource(dolphinCryPng).uri;

const cloudPng = require('../../assets/cloud.png');
const cloudUri = RNImage.resolveAssetSource(cloudPng).uri;

const seaPng = require('../../assets/sea.png');
const seaUri = RNImage.resolveAssetSource(seaPng).uri;

const Y_MIN = 40;
const Y_MAX = 260;
const DEFAULT_TARGET_LOW = 70;
const DEFAULT_TARGET_HIGH = 180;

/** Dolphin only: on-screen sprite size (px). */
const DOLPHIN_W = 38;
const DOLPHIN_H = 38;

/** Cloud only: multiply chart `width` and `cloudImageHeight` so the cloud is larger horizontally and vertically (>1 = bigger). Centered on chart width. */
const CLOUD_SCALE = 1.5;

/** Cloud only: shift layer down from top of SVG (px). Nondiabetic vs diabetic from `demoGlucoseDataset`. */
const CLOUD_Y_OFFSET_NONDIA = -190;
const CLOUD_Y_OFFSET_DIABETIC = -90;

/** Sea only: top of sea layer (px). Nondiabetic vs diabetic from `demoGlucoseDataset`. */
const SEA_Y_OFFSET_NONDIA = 258;
const SEA_Y_OFFSET_DIABETIC = 140;

/** Shaded strip = forward time window the spike model uses (from “now” / playhead), not a predicted trace. */
export type MlSpikeBandProps = {
  horizonMinutes: number;
  thresholdMgDl: number;
  /** 0–1 when the model returned a score; null = show window only. */
  probability: number | null;
  ready: boolean;
};

type Props = {
  points: GlucosePoint[];
  playbackT: number;
  width: number;
  height?: number;
  targetBandLow?: number;
  targetBandHigh?: number;
  /**
   * **Demo person (App)** — toggles CSV + band; here drives **cloud** height/Y offset and **sea** top Y (see header).
   */
  demoGlucoseDataset?: ClarityDemoDataset;
  /** Optional: tint the next `horizonMinutes` after the playhead to match ML spike risk. */
  mlSpikeBand?: MlSpikeBandProps | null;
  /**
   * How many hours of CGM time span the main plot width (`innerW`). Lower = zoom in (e.g. **1** makes a 30‑min band ~½ the plot vs **4** ~⅛).
   * @default 4
   */
  visibleRangeHours?: number;
};

function yForMgdl(mgdl: number, innerH: number): number {
  const n = (mgdl - Y_MIN) / (Y_MAX - Y_MIN);
  return innerH - Math.max(0, Math.min(1, n)) * innerH;
}

/** Clip polyline to screen x ≤ playhead (data coords + translateX). Adds an interpolated vertex at the cut. */
function truncatePolylineAtPlayhead(polylinePoints: string, translateX: number, playheadX: number): string {
  if (!polylinePoints.trim()) return '';
  const pairs = polylinePoints
    .trim()
    .split(/\s+/)
    .map((tok) => tok.split(',').map(Number));
  if (pairs.length < 2) return polylinePoints;
  const out: string[] = [];
  for (let i = 0; i < pairs.length; i++) {
    const xy = pairs[i];
    if (xy.length < 2) continue;
    const [x, y] = xy;
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const sx = x + translateX;
    if (sx <= playheadX) {
      out.push(`${x.toFixed(1)},${y.toFixed(1)}`);
    } else {
      const prev = pairs[i - 1];
      if (prev && prev.length >= 2 && out.length > 0) {
        const [x0, y0] = prev;
        const sx0 = x0 + translateX;
        if (sx0 < playheadX && sx > playheadX) {
          const denom = x - x0;
          if (Math.abs(denom) > 1e-9) {
            const xc = playheadX - translateX;
            const t = (xc - x0) / denom;
            const xi = x0 + t * (x - x0);
            const yi = y0 + t * (y - y0);
            out.push(`${xi.toFixed(1)},${yi.toFixed(1)}`);
          }
        }
      }
      break;
    }
  }
  return out.join(' ');
}

export const GlucoseStripChart = memo(function GlucoseStripChart({
  points,
  playbackT,
  width,
  height = 172,
  targetBandLow = DEFAULT_TARGET_LOW,
  targetBandHigh = DEFAULT_TARGET_HIGH,
  demoGlucoseDataset = 'nondiabetic',
  mlSpikeBand = null,
  visibleRangeHours = 4,
}: Props) {
  const [showFuture, setShowFuture] = useState(true);

  /** Cloud layer: passed to cloud `SvgImage` `height` (px). `nondiabetic` → 350, `diabetic` → 225 (`demoGlucoseDataset` from App). */
  const cloudImageHeight = demoGlucoseDataset === 'diabetic' ? 225 : 350;
  const cloudYOffset = demoGlucoseDataset === 'diabetic' ? CLOUD_Y_OFFSET_DIABETIC : CLOUD_Y_OFFSET_NONDIA;
  const seaYOffset = demoGlucoseDataset === 'diabetic' ? SEA_Y_OFFSET_DIABETIC : SEA_Y_OFFSET_NONDIA;

  const cloudW = width * CLOUD_SCALE;
  const cloudH = cloudImageHeight * CLOUD_SCALE;
  const cloudX = (width - cloudW) / 2;
  const cloudY = cloudYOffset;

  const padL = 32;
  const padR = 10;
  const padT = 8;
  const padB = 18;
  const innerW = Math.max(40, width - padL - padR);
  const innerH = height - padT - padB;

  const horizonMin = mlSpikeBand?.horizonMinutes ?? 30;

  const { polylinePoints, translateX, playheadX, contentW, forecastBandW } = useMemo(() => {
    const rightPlayheadX = Math.max(
      padL + DOLPHIN_W / 2 + 4,
      width - padR - DOLPHIN_W / 2 - 2,
    );

    if (points.length < 2) {
      const ph = showFuture ? Math.min(width - padR - 4, padL + innerW * 0.7) : rightPlayheadX;
      return { polylinePoints: '', translateX: 0, playheadX: ph, contentW: innerW, forecastBandW: 0 };
    }
    const t0 = points[0].t;
    const t1 = points[points.length - 1].t;
    const totalMs = Math.max(60_000, t1 - t0);
    const visH = Math.min(48, Math.max(0.5, visibleRangeHours));
    const visibleMs = visH * 60 * 60 * 1000;
    const pxPerMs = innerW / visibleMs;
    const contentW = totalMs * pxPerMs + innerW;

    const pts: string[] = [];
    for (const p of points) {
      const x = (p.t - t0) * pxPerMs + padL;
      const y = padT + yForMgdl(p.mgdl, innerH);
      pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
    }
    const polylinePoints = pts.join(' ');

    const playheadDataX = (playbackT - t0) * pxPerMs + padL;
    /** With future hidden, park “now” on the right so the trace ends flush and nothing shows to the right. */
    const playheadScreenX = showFuture
      ? Math.min(width - padR - 4, padL + innerW * 0.7)
      : rightPlayheadX;
    const translateX = playheadScreenX - playheadDataX;

    const horizonMs = horizonMin * 60 * 1000;
    const rawBandW = horizonMs * pxPerMs;
    const maxW = Math.max(0, width - padR - playheadScreenX);
    const forecastBandW = Math.min(Math.max(0, rawBandW), maxW);

    return { polylinePoints, translateX, playheadX: playheadScreenX, contentW, forecastBandW };
  }, [points, playbackT, innerW, innerH, padL, padT, width, horizonMin, visibleRangeHours, showFuture]);

  /** Right edge of plot area for grid / extended trace (screen x). */
  const gridLineX2 = width - padR;

  const yTicks = [70, 100, 140, 180, 220];

  /** Sea: fixed top (`seaYOffset`), stretch to bottom of SVG (`height`). */
  const seaH = Math.max(1, height - seaYOffset);

  /** Dolphin: glucose at playhead (linear interpolation between EGV points — can differ slightly from discrete samples). */
  const mgdlFloat = points.length >= 2 ? glucoseLinearUnroundedAtTime(points, playbackT) : 0;
  /** Dolphin: Y from same value as the seaweed-green glucose line; X from `playheadX` / `translateX` logic in `useMemo`. */
  const dolphinY =
    points.length >= 2 ? padT + yForMgdl(mgdlFloat, innerH) : padT + innerH * 0.45;
  /**
   * ML spike label is “any **future** sample **>** threshold in the horizon” (not “≥ now”).
   * When the chart’s high band matches the model threshold (e.g. diabetic 180), use strict `>` so the dolphin
   * does not flip before the same boundary the model uses for positives. Non‑diabetic band (140) still uses ≥140.
   */
  const mlThr = mlSpikeBand?.thresholdMgDl;
  const bandMatchesMl =
    mlThr != null && Number.isFinite(mlThr) && Math.abs(mlThr - targetBandHigh) < 0.5;
  const dolphinCry = bandMatchesMl ? mgdlFloat > targetBandHigh : mgdlFloat >= targetBandHigh;
  const dolphinX = playheadX - DOLPHIN_W / 2;
  const dolphinTop = Math.max(padT + 2, Math.min(height - padB - DOLPHIN_H - 2, dolphinY - DOLPHIN_H / 2));

  const thr = mlSpikeBand?.thresholdMgDl ?? 180;
  const p = mlSpikeBand?.probability;
  const bandReady = mlSpikeBand?.ready && typeof p === 'number' && Number.isFinite(p);
  const bandFill =
    bandReady && typeof p === 'number'
      ? `rgba(234, 88, 12, ${0.07 + 0.26 * Math.min(1, Math.max(0, p))})`
      : 'rgba(79, 70, 229, 0.08)';
  const bandStroke = bandReady ? 'rgba(194, 65, 12, 0.45)' : 'rgba(79, 70, 229, 0.35)';

  const polylineToDraw = useMemo(() => {
    if (showFuture || points.length < 2) return polylinePoints;
    return truncatePolylineAtPlayhead(polylinePoints, translateX, playheadX);
  }, [showFuture, points.length, polylinePoints, translateX, playheadX]);

  return (
    <View style={[styles.wrap, { width, maxWidth: '100%' }]}>
      <Svg width={width} height={height}>
        <Rect x={0} y={0} width={width} height={height} fill="#ffffff" rx={12} ry={12} />
        {/* Cloud: draw first = behind sea. `cloudYOffset` + size from `cloudImageHeight` / `CLOUD_SCALE`; `cloudX` centers wider cloud. */}
        <SvgImage
          href={cloudUri}
          x={cloudX}
          y={cloudY}
          width={cloudW}
          height={cloudH}
          preserveAspectRatio="xMidYMid slice"
          opacity={0.70}
        />
        {/* Sea: on top of cloud. Top from `seaYOffset` (dataset); stretched to chart bottom (`preserveAspectRatio="none"`). */}
        <SvgImage
          href={seaUri}
          x={0}
          y={seaYOffset}
          width={width}
          height={seaH}
          preserveAspectRatio="none"
          opacity={1}
        />
        {yTicks
          .filter((mg) => mg !== targetBandLow)
          .map((mg) => {
          const y = padT + yForMgdl(mg, innerH);
          const isThresholdHigh = mg === targetBandHigh;
          return (
            <Line
              key={`grid-${mg}`}
              x1={padL}
              x2={showFuture ? gridLineX2 : playheadX}
              y1={y}
              y2={y}
              stroke={isThresholdHigh ? '#1e293b' : '#e2e8f0'}
              strokeWidth={isThresholdHigh ? 1.75 : 1}
              strokeDasharray="4 6"
            />
          );
        })}
        <G transform={`translate(${translateX},0)`}>
          <Polyline points={polylineToDraw} fill="none" stroke="#5a9d86" strokeWidth={2.25} strokeLinejoin="round" />
        </G>
        {points.length >= 2 ? (
          <Line
            x1={playheadX}
            x2={playheadX}
            y1={padT}
            y2={padT + innerH}
            stroke="rgba(30, 41, 59, 0.45)"
            strokeWidth={1.25}
            pointerEvents="none"
          />
        ) : null}
        {showFuture && points.length >= 2 ? (
          <>
            {/* Right of fixed playhead = simulated time not yet reached (curve there is “future” in the replay). */}
            <Rect
              x={playheadX}
              y={padT}
              width={Math.max(0, width - padR - playheadX)}
              height={innerH}
              fill="rgba(30, 41, 59, 0.22)"
              pointerEvents="none"
            />
            {width - padR - playheadX > 56 ? (
              <SvgText
                x={playheadX + 4}
                y={padT + innerH - 5}
                fill="#475569"
                fontSize={9}
                fontWeight="700"
              >
                Future in demo
              </SvgText>
            ) : null}
          </>
        ) : null}
        {showFuture && mlSpikeBand && forecastBandW > 2 ? (
          <>
            <Rect
              x={playheadX}
              y={padT}
              width={forecastBandW}
              height={innerH}
              fill={bandFill}
              stroke={bandStroke}
              strokeWidth={1}
              strokeDasharray="5 4"
              rx={3}
              ry={3}
            />
            <SvgText
              x={playheadX + 4}
              y={padT + 13}
              fill="#312e81"
              fontSize={9}
              fontWeight="700"
            >
              {`Next ${horizonMin}m · model >${thr}`}
            </SvgText>
          </>
        ) : null}
        {yTicks.map((mg) => {
          const y = padT + yForMgdl(mg, innerH);
          return (
            <SvgText
              key={`ylab-${mg}`}
              x={padL - 5}
              y={y}
              textAnchor="end"
              alignmentBaseline="middle"
              fill="#475569"
              fontSize={10}
              fontWeight="600"
            >
              {String(mg)}
            </SvgText>
          );
        })}
        {/* Dolphin: above line (`G`). `href` from `dolphinCry`; size `DOLPHIN_W`/`H`; position `dolphinX`/`dolphinTop`. */}
        <SvgImage
          key={dolphinCry ? 'cry' : 'calm'}
          href={dolphinCry ? dolphinCryUri : dolphinUri}
          x={dolphinX}
          y={dolphinTop}
          width={DOLPHIN_W}
          height={DOLPHIN_H}
          preserveAspectRatio="xMidYMid meet"
        />
      </Svg>
      <View style={styles.futureToggleRow}>
        <Pressable
          onPress={() => setShowFuture((s) => !s)}
          style={({ pressed }) => [styles.futureToggleBtn, pressed && styles.futureToggleBtnPressed]}
          hitSlop={6}
        >
          <Text style={styles.futureToggleText}>{showFuture ? 'Hide future' : 'Show future'}</Text>
        </Pressable>
      </View>
      <View style={styles.axisRow}>
        <Text style={styles.axisHint}>Past side</Text>
        <Text style={styles.axisHint}>
          {showFuture ? 'Now · right = future in demo' : 'Now at right · past only'}
        </Text>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#ffffff',
    alignSelf: 'center',
    borderWidth: 1,
    borderColor: '#94a3b8',
  },
  futureToggleRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 10,
    paddingTop: 4,
    paddingBottom: 2,
    backgroundColor: '#ffffff',
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
  },
  futureToggleBtn: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: '#e2e8f0',
  },
  futureToggleBtnPressed: { opacity: 0.85 },
  futureToggleText: { fontSize: 12, fontWeight: '700', color: '#334155' },
  axisRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#ffffff',
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
  },
  axisHint: { fontSize: 10, color: '#64748b', fontWeight: '600' },
});
