import { memo, useMemo } from 'react';
import { Image as RNImage, View, Text, StyleSheet } from 'react-native';
import Svg, { G, Image as SvgImage, Line, Polyline, Rect, Text as SvgText } from 'react-native-svg';
import type { ClarityDemoDataset } from '../api';
import type { GlucosePoint } from '../clarity/parseClarityExport';
import { glucoseLinearUnroundedAtTime } from '../clarity/parseClarityExport';

const dolphinPng = require('../../assets/dolphin.png');
const dolphinCryPng = require('../../assets/dolphinCry.png');
const dolphinUri = RNImage.resolveAssetSource(dolphinPng).uri;
const dolphinCryUri = RNImage.resolveAssetSource(dolphinCryPng).uri;

const cloudPng = require('../../assets/cloud.png');
const cloudUri = RNImage.resolveAssetSource(cloudPng).uri;

const seaPng = require('../../assets/sea.png');
const seaUri = RNImage.resolveAssetSource(seaPng).uri;

/** mg/dL — show cry dolphin at or above; normal dolphin below. */
const DOLPHIN_CRY_THRESHOLD = 140;

const Y_MIN = 40;
const Y_MAX = 260;
const DEFAULT_TARGET_LOW = 70;
const DEFAULT_TARGET_HIGH = 180;

const DOLPHIN_W = 38;
const DOLPHIN_H = 38;

type Props = {
  points: GlucosePoint[];
  playbackT: number;
  width: number;
  height?: number;
  targetBandLow?: number;
  targetBandHigh?: number;
  /** Drives sea layer height: diabetic → 300px, non-diabetic → 500px. */
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
  targetBandLow: _targetBandLow = DEFAULT_TARGET_LOW,
  targetBandHigh: _targetBandHigh = DEFAULT_TARGET_HIGH,
  demoGlucoseDataset = 'nondiabetic',
}: Props) {
  const seaImageHeight = demoGlucoseDataset === 'diabetic' ? 300 : 500;
  const cloudImageHeight = demoGlucoseDataset === 'diabetic' ? 70 : 122;

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

  const mgdlFloat = points.length >= 2 ? glucoseLinearUnroundedAtTime(points, playbackT) : 0;
  const dolphinY =
    points.length >= 2 ? padT + yForMgdl(mgdlFloat, innerH) : padT + innerH * 0.45;
  const dolphinCry = mgdlFloat >= DOLPHIN_CRY_THRESHOLD;
  const dolphinX = playheadX - DOLPHIN_W / 2;
  const dolphinTop = Math.max(padT + 2, Math.min(height - padB - DOLPHIN_H - 2, dolphinY - DOLPHIN_H / 2));

  return (
    <View style={[styles.wrap, { width, maxWidth: '100%' }]}>
      <Svg width={width} height={height}>
        <Rect x={0} y={0} width={width} height={height} fill="#061a2e" rx={12} ry={12} />
        <SvgImage
          href={cloudUri}
          x={0}
          y={0}
          width={width}
          height={cloudImageHeight}
          preserveAspectRatio="xMidYMid slice"
          opacity={0.8}
        />
        <SvgImage
          href={seaUri}
          x={0}
          y={0}
          width={width}
          height={seaImageHeight}
          preserveAspectRatio="xMidYMid slice"
          opacity={0.45}
        />
        {yTicks.map((mg) => {
          const y = padT + yForMgdl(mg, innerH);
          return (
            <SvgText
              key={`ylab-${mg}`}
              x={padL - 5}
              y={y}
              textAnchor="end"
              alignmentBaseline="middle"
              fill="#cbd5e1"
              fontSize={10}
              fontWeight="600"
            >
              {String(mg)}
            </SvgText>
          );
        })}
        <G transform={`translate(${translateX},0)`}>
          {yTicks.map((mg) => {
            const y = padT + yForMgdl(mg, innerH);
            return (
              <Line
                key={mg}
                x1={padL}
                x2={padL + contentW}
                y1={y}
                y2={y}
                stroke="#2a3548"
                strokeWidth={1}
                strokeDasharray="4 6"
              />
            );
          })}
          <Polyline points={polylinePoints} fill="none" stroke="#5eead4" strokeWidth={2.25} strokeLinejoin="round" />
        </G>
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
  wrap: { borderRadius: 12, overflow: 'hidden', backgroundColor: '#061a2e', alignSelf: 'center' },
  axisRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#061a2e',
  },
  axisHint: { fontSize: 10, color: '#94a3b8', fontWeight: '600' },
});
