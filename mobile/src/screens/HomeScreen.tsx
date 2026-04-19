import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { StatusBar } from 'expo-status-bar';
import { useMemo, useState } from 'react';
import {
  ImageBackground,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
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
    isPlaybackPaused,
    setPlaybackPaused,
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

  const [demoSettingsOpen, setDemoSettingsOpen] = useState(false);
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
        <View style={styles.titleRow}>
          <View style={styles.titleBlock}>
            <Text style={[styles.title, styles.titleInRow]} numberOfLines={2}>
              Tide Together
            </Text>
          </View>
          <Pressable
            onPress={() => setDemoSettingsOpen(true)}
            style={({ pressed }) => [styles.demoSettingsBtn, pressed && styles.demoSettingsBtnPressed]}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Open demo settings"
          >
            <Text style={styles.demoSettingsBtnText}>Demo settings</Text>
          </Pressable>
        </View>
        <Text style={styles.subtitle}>
          Live demo glucose <Text style={styles.subtitleStrong}>{displayMgdl}</Text> mg/dL · {trend}
        </Text>

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
            {mlSpikeReady &&
            mlPredictedMaxMgDl !== null &&
            typeof mlPredictedMaxMgDl === 'number' &&
            Number.isFinite(mlPredictedMaxMgDl) ? (
              <>
                <Text style={styles.spikePredictedValue}>
                  ≈ {Math.round(mlPredictedMaxMgDl)} mg/dL
                </Text>
                <Text style={styles.spikePredictedDetail} numberOfLines={1}>
                  Peak predicted in next {mlSpikeHorizonMinutes ?? '—'} min (5‑min grid).
                </Text>
              </>
            ) : mlSpikeReady && mlSpikeProbability !== null && Number.isFinite(mlSpikeProbability) ? (
              <Text style={styles.spikeValue}>
                Heat {Math.round(mlSpikeProbability * 100)}% · next {mlSpikeHorizonMinutes ?? '—'} min · threshold{' '}
                {mlSpikeThresholdMgDl ?? '—'} mg/dL
              </Text>
            ) : (
              <Text style={styles.spikeValue}>{mlSpikeNote ?? 'Forecast unavailable.'}</Text>
            )}
          </View>
        </View>
      </ScrollView>

      <Modal
        visible={demoSettingsOpen}
        animationType="fade"
        transparent
        onRequestClose={() => setDemoSettingsOpen(false)}
      >
        <KeyboardAvoidingView
          style={styles.modalRoot}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={[styles.modalOverlay, { paddingTop: insets.top + 12 }]}>
            <Pressable
              style={styles.modalBackdrop}
              onPress={() => setDemoSettingsOpen(false)}
              accessibilityRole="button"
              accessibilityLabel="Close demo settings"
            />
            <View style={[styles.modalSheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
              <ScrollView
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
                bounces={false}
                style={styles.modalScroll}
              >
                <Text style={styles.modalTitle}>Demo settings</Text>
                <Text style={styles.modalSubtitle}>
                  Playback speed, chart zoom, demo cohort, and forecast trace for this screen.
                </Text>

                <View style={[styles.controlsCard, styles.modalControlsCard]}>
                  <Text style={styles.speedLabel}>Playback</Text>
                  <View style={styles.orangeTraceToggleRow}>
                    <Pressable
                      onPress={() => setPlaybackPaused((p) => !p)}
                      style={({ pressed }) => [
                        styles.orangeTraceToggleBtn,
                        pressed && styles.orangeTraceToggleBtnPressed,
                      ]}
                      hitSlop={6}
                    >
                      <Text style={styles.orangeTraceToggleText}>
                        {isPlaybackPaused ? 'Resume demo' : 'Pause demo'}
                      </Text>
                    </Pressable>
                  </View>

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

                  <Text style={styles.speedLabel}>Future orange trace</Text>
                  <View style={styles.orangeTraceToggleRow}>
                    <Pressable
                      onPress={() => setShowFutureOrangeTrace((s) => !s)}
                      style={({ pressed }) => [
                        styles.orangeTraceToggleBtn,
                        pressed && styles.orangeTraceToggleBtnPressed,
                      ]}
                      hitSlop={6}
                    >
                      <Text style={styles.orangeTraceToggleText}>
                        {showFutureOrangeTrace ? 'Hide future (orange) trace' : 'Show future (orange) trace'}
                      </Text>
                    </Pressable>
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
                </View>

                <Pressable
                  onPress={() => setDemoSettingsOpen(false)}
                  style={({ pressed }) => [styles.modalDoneBtn, pressed && styles.modalDoneBtnPressed]}
                  accessibilityRole="button"
                  accessibilityLabel="Done"
                >
                  <Text style={styles.modalDoneText}>Done</Text>
                </Pressable>
              </ScrollView>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
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
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  titleBlock: { flex: 1, minWidth: 0, gap: 4 },
  titleInRow: { flex: 1, minWidth: 0 },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: '#ffffff',
    letterSpacing: -0.6,
    textShadowColor: 'rgba(15, 23, 42, 0.55)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 10,
  },
  demoSettingsBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderWidth: 1,
    borderColor: 'rgba(226,232,240,0.95)',
  },
  demoSettingsBtnPressed: { opacity: 0.88 },
  demoSettingsBtnText: { fontSize: 13, fontWeight: '800', color: '#0f766e', textAlign: 'center' },
  subtitle: {
    marginTop: 6,
    fontSize: 15,
    fontWeight: '700',
    color: 'rgba(255, 255, 255, 0.94)',
    lineHeight: 22,
    textShadowColor: 'rgba(15, 23, 42, 0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 8,
  },
  subtitleStrong: { fontWeight: '800', color: '#ffffff' },
  cgmCard: {
    marginTop: 12,
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
  spikePredictedValue: {
    fontSize: 28,
    fontWeight: '800',
    color: '#0b1f3a',
    letterSpacing: -0.5,
  },
  spikePredictedDetail: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748b',
    lineHeight: 16,
  },
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
  modalRoot: { flex: 1 },
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.48)',
  },
  modalSheet: {
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.98)',
    borderRadius: 22,
    paddingHorizontal: 18,
    paddingTop: 18,
    borderWidth: 1,
    borderColor: 'rgba(226, 232, 240, 0.95)',
    maxHeight: '88%',
  },
  modalScroll: { maxHeight: '100%' },
  modalTitle: { fontSize: 20, fontWeight: '800', color: '#020617', letterSpacing: -0.4 },
  modalSubtitle: {
    marginTop: 6,
    marginBottom: 4,
    fontSize: 13,
    fontWeight: '600',
    color: '#64748b',
    lineHeight: 18,
  },
  controlsCard: {
    marginTop: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.94)',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(226, 232, 240, 0.95)',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 2,
  },
  modalControlsCard: { marginTop: 12 },
  modalDoneBtn: {
    marginTop: 14,
    paddingVertical: 14,
    alignItems: 'center',
    borderRadius: 16,
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  modalDoneBtnPressed: { opacity: 0.9 },
  modalDoneText: { fontSize: 16, fontWeight: '800', color: '#0f172a' },
});
