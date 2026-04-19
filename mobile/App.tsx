import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ImageBackground,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import {
  fetchClarityDemoCsv,
  fetchRecommendations,
  type ClarityDemoDataset,
} from './src/api';
import { buildSyntheticClarityCsv, parseClarityExportCsv, type GlucosePoint } from './src/clarity/parseClarityExport';
import {
  CGM_SPEED_PRESETS,
  DEFAULT_TIME_COMPRESSION,
  useSimulatedCgmPlayback,
} from './src/clarity/useSimulatedCgmPlayback';
import { GlucoseStripChart } from './src/components/GlucoseStripChart';

const seafloorBackground = require('./assets/seafloor.png');

export default function App() {
  const { width: winW, height: winH } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  /** Scroll horizontal padding (14×2) + card padding (12×2). */
  const chartW = Math.max(220, winW - 28 - 24);
  /**
   * Strip SVG height (GlucoseStripChart also adds ~36px axis row below SVG).
   * `VERTICAL_CHROME` = scroll padding + top bar + card padding/gaps/stats + primary button + margins.
   */
  const chartH = useMemo(() => {
    if (!winH) return 280;
    const inner = winH - insets.top - insets.bottom;
    const VERTICAL_CHROME = 16 + 44 + 12 + 36 + 8 + 54 + 12 + 10 + 58 + 12;
    return Math.max(220, Math.min(580, Math.floor(inner - VERTICAL_CHROME)));
  }, [winH, insets.top, insets.bottom]);

  const [glucosePoints, setGlucosePoints] = useState<GlucosePoint[]>([]);
  const [demoGlucoseDataset, setDemoGlucoseDataset] = useState<ClarityDemoDataset>('nondiabetic');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const raw = await fetchClarityDemoCsv(demoGlucoseDataset);
      const text = raw ?? buildSyntheticClarityCsv();
      const pts = parseClarityExportCsv(text);
      if (cancelled) return;
      const ok = pts.length >= 8 ? pts : parseClarityExportCsv(buildSyntheticClarityCsv());
      setGlucosePoints(ok);
    })();
    return () => {
      cancelled = true;
    };
  }, [demoGlucoseDataset]);

  const [timeCompression, setTimeCompression] = useState(DEFAULT_TIME_COMPRESSION);
  const { playbackT, displayMgdl, trend } = useSimulatedCgmPlayback(glucosePoints, {
    timeCompression,
  });

  const [showChartSettings, setShowChartSettings] = useState(false);
  const [lat, setLat] = useState('33.8823');
  const [lng, setLng] = useState('-117.8851');
  const [loading, setLoading] = useState(false);
  const [resultText, setResultText] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  /** Green band matches demo cohort: diabetic CSV → 70–180; non-diabetic export → 70–140. */
  const targetBandHigh = demoGlucoseDataset === 'diabetic' ? 180 : 140;

  async function useDeviceLocation() {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (permission.status !== 'granted') {
      Alert.alert('Location', 'Location permission is needed to find nearby options.');
      return;
    }

    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    setLat(String(pos.coords.latitude));
    setLng(String(pos.coords.longitude));
  }

  async function onRecommend() {
    const latitude = Number(lat);
    const longitude = Number(lng);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      Alert.alert('Location', 'Enter valid latitude and longitude, or use device location.');
      return;
    }

    setLoading(true);
    setResultText(null);
    try {
      const data = await fetchRecommendations({
        symptoms: [],
        recentGlucoseMgDl: displayMgdl,
        glucoseTrend: trend,
        minutesSinceLastMeal: undefined,
        lastMealCarbsG: undefined,
        medicationOnSchedule: true,
        activityLevel: 'moderate',
        latitude,
        longitude,
      });

      if (data.safety.escalate) {
        setResultText(data.escalationMessage ?? data.safety.message ?? 'Escalation triggered.');
        return;
      }

      const risk = data.risk;
      const note = data.recommendationsNote?.trim();

      const header = risk
        ? `Risk score: ${risk.riskScore.toFixed(2)} (${risk.severity})\n${risk.factors.join('\n')}`
        : 'Risk unavailable.';

      const recs = data.recommendations
        .map((r, idx) => {
          const gn = r.groundedNote ? `\n${r.groundedNote}` : '';
          const nut = r.nutritionInfo?.trim() ? `  |  Nutrition: ${r.nutritionInfo.trim()}` : '';
          return `${idx + 1}. ${r.place.name} (~${r.place.distanceM}m)\nHealthier-style pick: ${r.suggestedItem}${nut}\n${r.explanation}${gn}`;
        })
        .join('\n\n');

      const stamp = new Date().toLocaleString();
      const noteBlock = note ? `\n\n${note}\n` : '';
      setResultText(`Updated: ${stamp}\n\n${header}\n\nTop picks:\n${recs || '(none)'}${noteBlock}`);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 150);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Unknown error';
      console.error('[recommendations]', message);
      setResultText(
        `Could not reach the API.\n\n${message}\n\nBackend (on your Mac):\n  cd backend && npm run dev`,
      );
    } finally {
      setLoading(false);
    }
  }

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
      style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}
      resizeMode="cover"
    >
      <StatusBar style="light" />
      <ScrollView
        ref={scrollRef}
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
            /*
             * Chart sprites (see `GlucoseStripChart.tsx` header):
             * - **Cloud / sea** — `demoGlucoseDataset` sets **cloud** height + Y offset and **sea** top Y (258 nondiabetic / 140 diabetic); sea stretches to the chart bottom (see that file).
             * - **Dolphin** — same file: cry vs calm uses `targetBandHigh` + linear glucose at playhead; size constants; position from `points` + `playbackT`. **Graph speed** (Demo settings) changes how fast `playbackT` advances (dolphin moves faster/slower).
             * - **All layers** — `width` (`chartW`), `height` (`chartH`) scale the SVG; `chartH` is derived from window + safe area in this file.
             * `targetBandHigh` — band top for dolphin cry (180 diabetic / 140 nondiabetic); `targetBandLow` reserved for future chart use.
             */
            <GlucoseStripChart
              points={glucosePoints}
              playbackT={playbackT}
              width={chartW}
              height={chartH}
              targetBandLow={70}
              targetBandHigh={targetBandHigh}
              demoGlucoseDataset={demoGlucoseDataset}
            />
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

            <Text style={styles.label}>Location</Text>
            <View style={styles.locRow}>
              <TextInput value={lat} onChangeText={setLat} style={[styles.input, styles.locInput]} keyboardType="numbers-and-punctuation" />
              <TextInput value={lng} onChangeText={setLng} style={[styles.input, styles.locInput]} keyboardType="numbers-and-punctuation" />
            </View>
            <Pressable onPress={useDeviceLocation} style={styles.secondaryBtn}>
              <Text style={styles.secondaryBtnText}>Use device location</Text>
            </Pressable>
          </>
        ) : null}

        <Pressable onPress={onRecommend} style={styles.primaryBtn} disabled={loading}>
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Get recommendations</Text>}
        </Pressable>
        {loading ? (
          <Text style={styles.loadingHint}>
            Calling your backend (nearby places and meal suggestions). This can take up to a couple of minutes the first
            time — scroll down for results when the spinner stops.
          </Text>
        ) : null}

        {resultText ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Results</Text>
            <Text style={styles.cardBody}>{resultText}</Text>
          </View>
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
  subtitle: { fontSize: 14, color: '#3a4a63', lineHeight: 20, marginBottom: 4 },
  apiHint: {
    fontSize: 12,
    color: '#5c6b82',
    marginBottom: 8,
    fontFamily: 'monospace',
  },
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
  cgmLoading: { fontSize: 14, color: '#5c6b82', fontWeight: '600' },
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
  label: { marginTop: 10, fontSize: 13, fontWeight: '600', color: '#000000' },
  input: {
    marginTop: 6,
    borderWidth: 1,
    borderColor: '#d7deea',
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: '#0b1f3a',
  },
  locRow: { flexDirection: 'row', gap: 8 },
  locInput: { flex: 1 },
  secondaryBtn: {
    marginTop: 8,
    alignSelf: 'flex-start',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#94a3b8',
    backgroundColor: '#f1f5f9',
  },
  secondaryBtnText: { color: '#000000', fontWeight: '700' },
  primaryBtn: {
    marginTop: 10,
    backgroundColor: '#1f6feb',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  loadingHint: {
    marginTop: 10,
    fontSize: 13,
    color: '#94a3b8',
    lineHeight: 18,
  },
  card: {
    marginTop: 16,
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e5eaf3',
    padding: 14,
  },
  cardTitle: { fontSize: 16, fontWeight: '800', color: '#0b1f3a', marginBottom: 8 },
  cardBody: { fontSize: 14, color: '#22324d', lineHeight: 20 },
});
