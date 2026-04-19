import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { StatusBar } from 'expo-status-bar';
import { useMemo, useState } from 'react';
import { ImageBackground, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CGM_SPEED_PRESETS } from '../clarity/useSimulatedCgmPlayback';
import { GlucoseStripChart } from '../components/GlucoseStripChart';
import { useCgmSession } from '../context/CgmSessionContext';

const seafloorBackground = require('../../assets/seafloor.png');

/** Less time across the plot width ⇒ more horizontal zoom (30‑min ML band looks wider). */
const CHART_VISIBLE_HOUR_PRESETS = [
  { label: '1h', hours: 1 },
  { label: '1.5h', hours: 1.5 },
  { label: '2h', hours: 2 },
  { label: '4h', hours: 4 },
  { label: '8h', hours: 8 },
] as const;

export function HomeScreen() {
  const { width: winW, height: winH } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const {
    glucosePoints,
    demoGlucoseDataset,
    setDemoGlucoseDataset,
    timeCompression,
    setTimeCompression,
    playbackT,
    displayMgdl,
    trend,
    mlSpikeReady,
    mlSpikeProbability,
    mlPredictedMaxMgDl,
    mlSpikeThresholdMgDl,
    mlSpikeHorizonMinutes,
    mlSpikeNote,
  } = useCgmSession();

  /** Scroll horizontal padding (14×2) + card padding (12×2). */
  const chartW = Math.max(220, winW - 28 - 24);
  /**
   * Strip SVG height (GlucoseStripChart also adds ~36px axis row below SVG).
   * `VERTICAL_CHROME` includes bottom tab bar height so the chart fits above it.
   */
  const chartH = useMemo(() => {
    if (!winH) return 280;
    const inner = winH - insets.top - insets.bottom;
    const VERTICAL_CHROME = 16 + 44 + 12 + 36 + 8 + 54 + 12 + 10 + 58 + 12 + tabBarHeight;
    return Math.max(220, Math.min(580, Math.floor(inner - VERTICAL_CHROME)));
  }, [winH, insets.top, insets.bottom, tabBarHeight]);

  const [showChartSettings, setShowChartSettings] = useState(false);
  const [chartVisibleHours, setChartVisibleHours] = useState(4);
  const [showFutureOrangeTrace, setShowFutureOrangeTrace] = useState(true);

  /** Green band matches demo cohort: diabetic CSV → 70–180; non-diabetic export → 70–140. */
  const targetBandHigh = demoGlucoseDataset === 'diabetic' ? 180 : 140;

  const clockLabel = useMemo(() => {
    try {
      return new Date(playbackT).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return '';
    }
  }, [playbackT]);

  return (
    <ImageBackground
      source={seafloorBackground}
      style={[styles.screen, { paddingTop: insets.top }]}
      resizeMode="cover"
    >
      <StatusBar style="light" />
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.topBar}>
          <Text style={styles.titleCompact}>Sugar Moonshot</Text>
          <Pressable onPress={() => setShowChartSettings((s) => !s)} hitSlop={10}>
            <Text style={styles.demoSettingsLink}>
              {showChartSettings ? 'Hide demo' : 'Demo settings'}
            </Text>
          </Pressable>
        </View>

        <View style={styles.cgmCard}>
          {glucosePoints.length >= 8 ? (
            <>
              <GlucoseStripChart
                points={glucosePoints}
                playbackT={playbackT}
                width={chartW}
                height={chartH}
                targetBandLow={70}
                targetBandHigh={targetBandHigh}
                demoGlucoseDataset={demoGlucoseDataset}
                mlForecast={{
                  horizonMinutes: mlSpikeHorizonMinutes ?? 30,
                  thresholdMgDl: mlSpikeThresholdMgDl ?? 180,
                  predictedMaxMgDl:
                    mlSpikeReady && mlPredictedMaxMgDl !== null ? mlPredictedMaxMgDl : null,
                  ready: mlSpikeReady,
                }}
                visibleRangeHours={chartVisibleHours}
                showFutureOrangeTrace={showFutureOrangeTrace}
              />
              <View style={styles.orangeTraceToggleRow}>
                <Pressable
                  onPress={() => setShowFutureOrangeTrace((s) => !s)}
                  style={({ pressed }) => [styles.orangeTraceToggleBtn, pressed && styles.orangeTraceToggleBtnPressed]}
                  hitSlop={6}
                >
                  <Text style={styles.orangeTraceToggleText}>
                    {showFutureOrangeTrace ? 'Hide future (orange) trace' : 'Show future (orange) trace'}
                  </Text>
                </Pressable>
              </View>
            </>
          ) : (
            <View style={[styles.graphPlaceholder, { width: chartW, minHeight: chartH }]}>
              <Text style={styles.cgmLoading}>Preparing graph…</Text>
            </View>
          )}
          <View style={styles.cgmStatsBar}>
            <View style={styles.cgmStatsLeft}>
              <Text style={styles.cgmValueCompact}>{displayMgdl}</Text>
              <Text style={styles.cgmUnitCompact}>mg/dL · {trend}</Text>
            </View>
            <Text style={styles.cgmClockCompact} numberOfLines={2}>
              {clockLabel}
            </Text>
          </View>
          <View style={styles.spikeRow}>
            <Text style={styles.spikeLabel}>ML glucose forecast (forward window)</Text>
            <Text style={styles.spikeValue} numberOfLines={8}>
              {mlSpikeReady && mlSpikeProbability !== null
                ? mlPredictedMaxMgDl !== null
                  ? `Ridge regression predicts max glucose ≈ ${Math.round(mlPredictedMaxMgDl)} mg/dL in the next ${mlSpikeHorizonMinutes ?? '—'} min (target: highest reading in that window on a 5‑minute grid).\nPurple dashed trace = ramp to that predicted level (timed to the replay’s peak in the window when orange data exists), then level to the horizon — still one scalar forecast, shaped for easier reading.`
                  : `Model score ${Math.round(mlSpikeProbability * 100)}% vs threshold ${mlSpikeThresholdMgDl ?? '—'} mg/dL in the next ${mlSpikeHorizonMinutes ?? '—'} min.\nWhen the API returns a predicted max, the chart shows it as the purple dashed segment.`
                : (mlSpikeNote ?? '…')}
            </Text>
          </View>
        </View>

        {showChartSettings ? (
          <>
            <Text style={styles.speedLabel}>Graph speed</Text>
            <View style={styles.speedPresets}>
              {CGM_SPEED_PRESETS.map((p) => {
                const on = timeCompression === p.compression;
                return (
                  <Pressable
                    key={p.label}
                    onPress={() => setTimeCompression(p.compression)}
                    style={[styles.speedChip, on && styles.speedChipOn]}
                  >
                    <Text style={[styles.speedChipText, on && styles.speedChipTextOn]}>{p.label}</Text>
                  </Pressable>
                );
              })}
            </View>
            <View style={styles.speedFineRow}>
              <Pressable
                onPress={() => setTimeCompression((c) => Math.max(2, Math.round(c / 1.12)))}
                style={styles.speedFineBtn}
              >
                <Text style={styles.speedFineBtnText}>Slower −</Text>
              </Pressable>
              <Text style={styles.speedFineValue}>{timeCompression}×</Text>
              <Pressable
                onPress={() => setTimeCompression((c) => Math.min(2500, Math.round(c * 1.12)))}
                style={styles.speedFineBtn}
              >
                <Text style={styles.speedFineBtnText}>Faster +</Text>
              </Pressable>
            </View>

            <Text style={styles.speedLabel}>Chart zoom (time across graph width)</Text>
            <Text style={styles.zoomHint}>
              Smaller = zoom in — the ML 30‑min band uses more of the chart. Does not change playback speed.
            </Text>
            <View style={styles.speedPresets}>
              {CHART_VISIBLE_HOUR_PRESETS.map((p) => {
                const on = chartVisibleHours === p.hours;
                return (
                  <Pressable
                    key={p.label}
                    onPress={() => setChartVisibleHours(p.hours)}
                    style={[styles.speedChip, on && styles.speedChipOn]}
                  >
                    <Text style={[styles.speedChipText, on && styles.speedChipTextOn]}>{p.label}</Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={styles.speedLabel}>Demo person (CSV + target band)</Text>
            <View style={styles.speedPresets}>
              <Pressable
                onPress={() => setDemoGlucoseDataset('nondiabetic')}
                style={[styles.speedChip, demoGlucoseDataset === 'nondiabetic' && styles.speedChipOn]}
              >
                <Text
                  style={[styles.speedChipText, demoGlucoseDataset === 'nondiabetic' && styles.speedChipTextOn]}
                >
                  Non-diabetic · 70–140
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setDemoGlucoseDataset('diabetic')}
                style={[styles.speedChip, demoGlucoseDataset === 'diabetic' && styles.speedChipOn]}
              >
                <Text style={[styles.speedChipText, demoGlucoseDataset === 'diabetic' && styles.speedChipTextOn]}>
                  Diabetic · 70–180
                </Text>
              </Pressable>
            </View>

            <Text style={styles.hint}>Location and meal picks live on the Recommendations tab.</Text>
          </>
        ) : null}
      </ScrollView>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  scrollView: { flex: 1, backgroundColor: 'transparent' },
  scrollContent: {
    paddingHorizontal: 14,
    paddingTop: 6,
    paddingBottom: 12,
    gap: 6,
    flexGrow: 1,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 0,
    marginBottom: 4,
    paddingHorizontal: 2,
  },
  titleCompact: { fontSize: 17, fontWeight: '800', color: '#000000', letterSpacing: -0.3 },
  demoSettingsLink: { fontSize: 14, fontWeight: '700', color: '#000000' },
  cgmCard: {
    marginTop: 4,
    backgroundColor: '#fff',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#e5eaf3',
    padding: 12,
    gap: 8,
    overflow: 'hidden',
  },
  graphPlaceholder: {
    alignSelf: 'center',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f1f5f9',
    borderRadius: 12,
  },
  orangeTraceToggleRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 2,
    paddingTop: 2,
    paddingBottom: 0,
  },
  orangeTraceToggleBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#f1f5f9',
  },
  orangeTraceToggleBtnPressed: { opacity: 0.88 },
  orangeTraceToggleText: { fontSize: 12, fontWeight: '700', color: '#334155' },
  cgmStatsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingTop: 4,
    paddingHorizontal: 2,
  },
  cgmStatsLeft: { flexShrink: 1 },
  cgmValueCompact: { fontSize: 32, fontWeight: '800', color: '#0b1f3a', letterSpacing: -0.8 },
  cgmUnitCompact: {
    fontSize: 13,
    fontWeight: '600',
    color: '#475569',
    marginTop: 2,
    textTransform: 'capitalize',
  },
  cgmClockCompact: { fontSize: 12, fontWeight: '700', color: '#64748b', textAlign: 'right', maxWidth: '42%' },
  spikeRow: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#e5eaf3',
    gap: 4,
  },
  spikeLabel: { fontSize: 11, fontWeight: '800', color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 },
  spikeValue: { fontSize: 13, fontWeight: '700', color: '#0b1f3a', lineHeight: 18 },
  cgmLoading: { fontSize: 14, color: '#5c6b82', fontWeight: '600' },
  zoomHint: {
    fontSize: 11,
    color: '#64748b',
    fontWeight: '600',
    marginTop: -2,
    marginBottom: 4,
    paddingHorizontal: 2,
    lineHeight: 15,
  },
  speedLabel: { marginTop: 12, fontSize: 13, fontWeight: '700', color: '#000000' },
  speedPresets: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  speedChip: {
    paddingVertical: 8,
    paddingHorizontal: 11,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#94a3b8',
    backgroundColor: '#f1f5f9',
  },
  speedChipOn: { backgroundColor: '#0e7490', borderColor: '#0f766e' },
  speedChipText: { fontSize: 12, fontWeight: '700', color: '#000000' },
  speedChipTextOn: { color: '#ffffff' },
  speedFineRow: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  speedFineBtn: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#94a3b8',
    backgroundColor: '#f1f5f9',
  },
  speedFineBtnText: { fontWeight: '700', color: '#000000', fontSize: 13 },
  speedFineValue: { fontSize: 16, fontWeight: '800', color: '#000000', minWidth: 56, textAlign: 'center' },
  hint: {
    marginTop: 14,
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
    lineHeight: 17,
  },
});
