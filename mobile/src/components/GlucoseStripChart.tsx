import { memo, useMemo } from 'react';
import { Image as RNImage, View, Text, StyleSheet } from 'react-native';
import Svg, { G, Image as SvgImage, Line, Polyline, Rect, Text as SvgText } from 'react-native-svg';
import type { ClarityDemoDataset } from '../api';
import type { GlucosePoint } from '../clarity/parseClarityExport';
import { glucoseLinearUnroundedAtTime } from '../clarity/parseClarityExport';

/**
 * Sprite tuning (what to edit):
 * - **Cloud** — `cloudImageHeight`, **`CLOUD_Y_OFFSET_*`** (shift down from SVG top), `CLOUD_SCALE`; cloud `SvgImage` (`width`/`height`/`x`/`y`/`opacity`/`preserveAspectRatio`), asset `assets/cloud.png`.
 * - **Sea** — top Y from **`SEA_Y_OFFSET_*`** / `demoGlucoseDataset` (258 nondiabetic, 140 diabetic); height fills to chart bottom (`preserveAspectRatio="none"`). Asset `assets/sea.png`.
 * - **Dolphin** — cry when linear glucose at playhead ≥ `targetBandHigh` (from App: 140 nondiabetic, 180 diabetic); `DOLPHIN_W` / `DOLPHIN_H`, dolphin `SvgImage` (`preserveAspectRatio`); calm/cry assets `dolphin.png` / `dolphinCry.png`; position follows `playbackT` + `points` (same as the line).
 * From **App**: `demoGlucoseDataset` → cloud height + cloud/sea Y offsets; `width` / `height` props → whole chart (scales dolphin Y and line with `innerH` / `innerW`). **`visibleRangeHours`** — fewer hours across the plot width = horizontal zoom (wider segment for the regression “now → horizon” line on screen).
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

/** Ridge regression forecast: predicted max glucose in the forward window (from playhead). */
export type MlForecastProps = {
  horizonMinutes: number;
  thresholdMgDl?: number;
  predictedMaxMgDl: number | null;
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
  /** Optional: draw a distinct-colored segment after the playhead (current → predicted max at horizon). */
  mlForecast?: MlForecastProps | null;
  /**
   * How many hours of CGM time span the main plot width (`innerW`). Lower = zoom in (e.g. **1** makes a 30‑min band ~½ the plot vs **4** ~⅛).
   * @default 4
   */
  visibleRangeHours?: number;
  /** When false, the orange “actual future replay” segment is not drawn (controlled by parent). @default true */
  showFutureOrangeTrace?: boolean;
};

function yForMgdl(mgdl: number, innerH: number): number {
  const n = (mgdl - Y_MIN) / (Y_MAX - Y_MIN);
  return innerH - Math.max(0, Math.min(1, n)) * innerH;
}

export const GlucoseStripChart = memo(function GlucoseStripChart({
  points,
  playbackT,
  width,
  height = 172,
  targetBandLow = DEFAULT_TARGET_LOW,
  targetBandHigh = DEFAULT_TARGET_HIGH,
  demoGlucoseDataset = 'nondiabetic',
  mlForecast = null,
  visibleRangeHours = 4,
  showFutureOrangeTrace = true,
}: Props) {
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

  const horizonMin = mlForecast?.horizonMinutes ?? 30;

  const {
    pastPolylinePoints,
    futurePolylinePoints,
    pastOk,
    futureOk,
    translateX,
    playheadX,
    contentW,
    predictionPolylinePoints,
  } = useMemo(() => {
    if (points.length < 2) {
      const ph = Math.min(width - padR - 4, padL + innerW * 0.7);
      return {
        pastPolylinePoints: '',
        futurePolylinePoints: '',
        pastOk: false,
        futureOk: false,
        translateX: 0,
        playheadX: ph,
        contentW: innerW,
        predictionPolylinePoints: null,
      };
    }
    const t0 = points[0].t;
    const t1 = points[points.length - 1].t;
    const totalMs = Math.max(60_000, t1 - t0);
    const visH = Math.min(48, Math.max(0.5, visibleRangeHours));
    const visibleMs = visH * 60 * 60 * 1000;
    const pxPerMs = innerW / visibleMs;
    const contentW = totalMs * pxPerMs + innerW;

    const mgAtPlay = glucoseLinearUnroundedAtTime(points, playbackT);
    const playheadDataX = (playbackT - t0) * pxPerMs + padL;
    const phY = padT + yForMgdl(mgAtPlay, innerH);
    const phStr = `${playheadDataX.toFixed(1)},${phY.toFixed(1)}`;

    const pastArr: string[] = [];
    let maxPastT = -Infinity;
    for (const p of points) {
      if (p.t <= playbackT) {
        const x = (p.t - t0) * pxPerMs + padL;
        const y = padT + yForMgdl(p.mgdl, innerH);
        pastArr.push(`${x.toFixed(1)},${y.toFixed(1)}`);
        maxPastT = Math.max(maxPastT, p.t);
      }
    }
    if (maxPastT < playbackT) {
      pastArr.push(phStr);
    } else if (pastArr.length > 0 && maxPastT === playbackT) {
      pastArr[pastArr.length - 1] = phStr;
    } else if (pastArr.length === 0 && points.some((q) => q.t > playbackT)) {
      pastArr.push(phStr);
    }

    const futureArr: string[] = [];
    if (points.some((q) => q.t > playbackT)) {
      futureArr.push(phStr);
      for (const p of points) {
        if (p.t > playbackT) {
          const x = (p.t - t0) * pxPerMs + padL;
          const y = padT + yForMgdl(p.mgdl, innerH);
          futureArr.push(`${x.toFixed(1)},${y.toFixed(1)}`);
        }
      }
    }

    const pastPolylinePoints = pastArr.join(' ');
    const futurePolylinePoints = futureArr.join(' ');
    const pastOk = pastArr.length >= 2;
    const futureOk = futureArr.length >= 2;

    /** Park playhead ~70% across the plot so past + upcoming replay (actual CGM) are both visible. */
    const playheadScreenX = Math.min(width - padR - 4, padL + innerW * 0.7);
    const translateX = playheadScreenX - playheadDataX;

    const horizonMs = horizonMin * 60 * 1000;
    const tHorizon = playbackT + horizonMs;
    const pred = mlForecast?.predictedMaxMgDl;
    let predictionPolylinePoints: string | null = null;
    if (mlForecast?.ready && pred != null && Number.isFinite(pred)) {
      const yPred = padT + yForMgdl(pred, innerH);
      const xEnd = (tHorizon - t0) * pxPerMs + padL;

      /** When replay has samples in the window, put a “knee” at the time of the actual max (layout only) so timing matches orange; height is still the model’s predicted max. */
      let peakT = tHorizon;
      let peakMg = Number.NEGATIVE_INFINITY;
      for (const p of points) {
        if (p.t <= playbackT || p.t > tHorizon) continue;
        if (p.mgdl > peakMg) {
          peakMg = p.mgdl;
          peakT = p.t;
        }
      }
      const xKnee =
        peakMg !== Number.NEGATIVE_INFINITY ? (peakT - t0) * pxPerMs + padL : xEnd;

      const parts: string[] = [`${playheadDataX.toFixed(1)},${phY.toFixed(1)}`];
      const dxKnee = Math.abs(xKnee - playheadDataX);
      const dxEnd = Math.abs(xEnd - xKnee);
      if (dxKnee >= 3 && dxEnd >= 3) {
        parts.push(`${xKnee.toFixed(1)},${yPred.toFixed(1)}`);
      }
      parts.push(`${xEnd.toFixed(1)},${yPred.toFixed(1)}`);
      predictionPolylinePoints = parts.join(' ');
    }

    return {
      pastPolylinePoints,
      futurePolylinePoints,
      pastOk,
      futureOk,
      translateX,
      playheadX: playheadScreenX,
      contentW,
      predictionPolylinePoints,
    };
  }, [
    points,
    playbackT,
    innerW,
    innerH,
    padL,
    padT,
    width,
    horizonMin,
    visibleRangeHours,
    mlForecast?.ready,
    mlForecast?.predictedMaxMgDl,
  ]);

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
   * When the chart’s high band matches the model threshold (e.g. diabetic 180), use strict `>` so the dolphin
   * lines up with the same boundary used in training features. Otherwise use ≥ `targetBandHigh`.
   */
  const mlThr = mlForecast?.thresholdMgDl;
  const bandMatchesMl =
    mlThr != null && Number.isFinite(mlThr) && Math.abs(mlThr - targetBandHigh) < 0.5;
  const dolphinCry = bandMatchesMl ? mgdlFloat > targetBandHigh : mgdlFloat >= targetBandHigh;
  const dolphinX = playheadX - DOLPHIN_W / 2;
  const dolphinTop = Math.max(padT + 2, Math.min(height - padB - DOLPHIN_H - 2, dolphinY - DOLPHIN_H / 2));

  const showPredictionTrace =
    predictionPolylinePoints != null &&
    mlForecast?.ready &&
    mlForecast.predictedMaxMgDl != null &&
    Number.isFinite(mlForecast.predictedMaxMgDl);

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
              x2={gridLineX2}
              y1={y}
              y2={y}
              stroke={isThresholdHigh ? '#1e293b' : '#e2e8f0'}
              strokeWidth={isThresholdHigh ? 1.75 : 1}
              strokeDasharray="4 6"
            />
          );
        })}
        <G transform={`translate(${translateX},0)`}>
          {pastOk ? (
            <Polyline
              points={pastPolylinePoints}
              fill="none"
              stroke="#5a9d86"
              strokeWidth={2.25}
              strokeLinejoin="round"
            />
          ) : null}
          {showFutureOrangeTrace && futureOk ? (
            <Polyline
              points={futurePolylinePoints}
              fill="none"
              stroke="#ea580c"
              strokeWidth={2.25}
              strokeLinejoin="round"
            />
          ) : null}
          {showPredictionTrace && predictionPolylinePoints ? (
            <Polyline
              points={predictionPolylinePoints}
              fill="none"
              stroke="#7c3aed"
              strokeWidth={2.75}
              strokeDasharray="7 5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ) : null}
        </G>
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
      <View style={styles.axisRow}>
        <View style={styles.legendRow}>
          <View style={styles.legendItem}>
            <View style={[styles.legendSwatch, { backgroundColor: '#5a9d86' }]} />
            <Text style={styles.legendLabel}>Past</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendSwatch, { backgroundColor: '#7c3aed' }]} />
            <Text style={styles.legendLabel}>Prediction</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendSwatch, { backgroundColor: '#ea580c' }]} />
            <Text style={styles.legendLabel}>True value</Text>
          </View>
        </View>
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
  axisRow: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#ffffff',
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
  },
  legendRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 14,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendSwatch: {
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(15, 23, 42, 0.18)',
  },
  legendLabel: {
    fontSize: 11,
    color: '#475569',
    fontWeight: '600',
  },
});
