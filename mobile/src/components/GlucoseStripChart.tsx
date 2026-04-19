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
 * From **App**: `demoGlucoseDataset` → cloud height + cloud/sea Y offsets; `width` / `height` props → whole chart (scales dolphin Y and line with `innerH` / `innerW`).
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

  const { polylinePoints, translateX, playheadX, contentW } = useMemo(() => {
    if (points.length < 2) {
      const ph = Math.min(width - padR - 4, padL + innerW * 0.7);
      return { polylinePoints: '', translateX: 0, playheadX: ph, contentW: innerW };
    }
    const t0 = points[0].t;
    const t1 = points[points.length - 1].t;
    const totalMs = Math.max(60_000, t1 - t0);
    const visibleMs = 4 * 60 * 60 * 1000;
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
    const playheadScreenX = Math.min(width - padR - 4, padL + innerW * 0.7);
    const translateX = playheadScreenX - playheadDataX;

    return { polylinePoints, translateX, playheadX: playheadScreenX, contentW };
  }, [points, playbackT, innerW, innerH, padL, padT, width]);

  const yTicks = [70, 100, 140, 180, 220];

  /** Sea: fixed top (`seaYOffset`), stretch to bottom of SVG (`height`). */
  const seaH = Math.max(1, height - seaYOffset);

  /** Dolphin: glucose at playhead (linear interpolation between EGV points — can differ slightly from discrete samples). */
  const mgdlFloat = points.length >= 2 ? glucoseLinearUnroundedAtTime(points, playbackT) : 0;
  /** Dolphin: Y from same value as the seaweed-green glucose line; X from `playheadX` / `translateX` logic in `useMemo`. */
  const dolphinY =
    points.length >= 2 ? padT + yForMgdl(mgdlFloat, innerH) : padT + innerH * 0.45;
  const dolphinCry = mgdlFloat >= targetBandHigh;
  const dolphinX = playheadX - DOLPHIN_W / 2;
  const dolphinTop = Math.max(padT + 2, Math.min(height - padB - DOLPHIN_H - 2, dolphinY - DOLPHIN_H / 2));

  /** Horizontal grid: fixed to viewport (not in scrolling `G`) so lines never sweep over Y-axis labels. */
  const gridLineX2 = width - padR;

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
              strokeDasharray={isThresholdHigh ? 'none' : '4 6'}
            />
          );
        })}
        <G transform={`translate(${translateX},0)`}>
          <Polyline points={polylinePoints} fill="none" stroke="#5a9d86" strokeWidth={2.25} strokeLinejoin="round" />
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
        <Text style={styles.axisHint}>Earlier</Text>
        <Text style={styles.axisHint}>Simulated live</Text>
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
    borderColor: '#e2e8f0',
  },
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
