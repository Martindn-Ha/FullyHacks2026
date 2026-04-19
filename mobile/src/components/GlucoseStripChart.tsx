import { memo, useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { G, Line, Polyline, Rect } from 'react-native-svg';
import type { GlucosePoint } from '../clarity/parseClarityExport';

const Y_MIN = 40;
const Y_MAX = 260;
const TARGET_LOW = 70;
const TARGET_HIGH = 180;

type Props = {
  points: GlucosePoint[];
  playbackT: number;
  width: number;
  height?: number;
};

function yForMgdl(mgdl: number, innerH: number): number {
  const n = (mgdl - Y_MIN) / (Y_MAX - Y_MIN);
  return innerH - Math.max(0, Math.min(1, n)) * innerH;
}

export const GlucoseStripChart = memo(function GlucoseStripChart({ points, playbackT, width, height = 172 }: Props) {
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
    /** ~4 h of history visible across inner width (Stelo-like strip). */
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
    /** Keep playhead slightly left of true right edge so stroke + transform never clip past the rounded card. */
    const playheadScreenX = Math.min(width - padR - 4, padL + innerW * 0.7);
    const translateX = playheadScreenX - playheadDataX;

    return { polylinePoints, translateX, playheadX: playheadScreenX, contentW };
  }, [points, playbackT, innerW, innerH, padL, padT]);

  const bandTop = padT + yForMgdl(TARGET_HIGH, innerH);
  const bandH = yForMgdl(TARGET_LOW, innerH) - bandTop;

  const yTicks = [70, 100, 140, 180, 220];

  return (
    <View style={[styles.wrap, { width, maxWidth: '100%' }]}>
      <Svg width={width} height={height}>
        <Rect x={0} y={0} width={width} height={height} fill="#0c1220" rx={12} ry={12} />
        <G transform={`translate(${translateX},0)`}>
          <Rect
            x={padL}
            y={bandTop}
            width={contentW}
            height={Math.max(1, bandH)}
            fill="#1a3d2e"
            opacity={0.45}
          />
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
        <Line
          x1={playheadX}
          x2={playheadX}
          y1={padT}
          y2={padT + innerH}
          stroke="#fbbf24"
          strokeWidth={1.5}
          opacity={0.95}
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
  wrap: { borderRadius: 12, overflow: 'hidden', backgroundColor: '#0c1220', alignSelf: 'center' },
  axisRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#0c1220',
  },
  axisHint: { fontSize: 10, color: '#94a3b8', fontWeight: '600' },
});
