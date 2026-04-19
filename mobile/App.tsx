import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import * as Location from 'expo-location';
import { fetchClarityDemoCsv, fetchRecommendations, getApiBaseUrl, type ActivityLevel } from './src/api';
import { buildSyntheticClarityCsv, parseClarityExportCsv, type GlucosePoint } from './src/clarity/parseClarityExport';
import {
  CGM_SPEED_PRESETS,
  DEFAULT_TIME_COMPRESSION,
  useSimulatedCgmPlayback,
} from './src/clarity/useSimulatedCgmPlayback';
import { GlucoseStripChart } from './src/components/GlucoseStripChart';

export default function App() {
  const { width: winW } = useWindowDimensions();
  /** Scroll horizontal padding (18×2) + CGM card padding (14×2) — chart must fit inside the white card. */
  const chartW = Math.max(220, winW - 36 - 28);

  const [glucosePoints, setGlucosePoints] = useState<GlucosePoint[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const raw = await fetchClarityDemoCsv();
      const text = raw ?? buildSyntheticClarityCsv();
      const pts = parseClarityExportCsv(text);
      if (cancelled) return;
      const ok = pts.length >= 8 ? pts : parseClarityExportCsv(buildSyntheticClarityCsv());
      setGlucosePoints(ok);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const [timeCompression, setTimeCompression] = useState(DEFAULT_TIME_COMPRESSION);
  const { playbackT, displayMgdl, trend } = useSimulatedCgmPlayback(glucosePoints, {
    timeCompression,
  });

  const [showAdvanced, setShowAdvanced] = useState(false);
  const [symptoms, setSymptoms] = useState('');
  const [glucoseOverride, setGlucoseOverride] = useState('');
  const [minutesSinceMeal, setMinutesSinceMeal] = useState('');
  const [mealCarbs, setMealCarbs] = useState('');
  const [medsOnTime, setMedsOnTime] = useState(true);
  const [activity, setActivity] = useState<ActivityLevel>('moderate');
  const [lat, setLat] = useState('33.8823');
  const [lng, setLng] = useState('-117.8851');
  const [loading, setLoading] = useState(false);
  const [resultText, setResultText] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  const symptomList = useMemo(
    () =>
      symptoms
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    [symptoms],
  );

  const effectiveGlucose = useMemo(() => {
    if (showAdvanced && glucoseOverride.trim()) {
      const n = Number(glucoseOverride);
      if (Number.isFinite(n) && n > 0) return Math.round(n);
    }
    return displayMgdl;
  }, [showAdvanced, glucoseOverride, displayMgdl]);

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
        symptoms: symptomList,
        recentGlucoseMgDl: effectiveGlucose,
        glucoseTrend: trend,
        minutesSinceLastMeal: minutesSinceMeal.trim() ? Number(minutesSinceMeal) : undefined,
        lastMealCarbsG: mealCarbs.trim() ? Number(mealCarbs) : undefined,
        medicationOnSchedule: medsOnTime,
        activityLevel: activity,
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
    <View style={styles.screen}>
      <StatusBar style="dark" />
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>Sugar Moonshot</Text>

        <View style={styles.cgmCard}>
          <View style={styles.cgmTopRow}>
            <View>
              <Text style={styles.cgmValue}>{effectiveGlucose}</Text>
              <Text style={styles.cgmUnit}>mg/dL · {trend}</Text>
            </View>
            <View style={styles.cgmMeta}>
              <Text style={styles.cgmMetaText}>{clockLabel}</Text>
            </View>
          </View>
          {glucosePoints.length >= 8 ? (
            <GlucoseStripChart points={glucosePoints} playbackT={playbackT} width={chartW} height={172} />
          ) : (
            <Text style={styles.cgmLoading}>Preparing graph…</Text>
          )}

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
        </View>

        <Pressable onPress={() => setShowAdvanced((s) => !s)} style={styles.advancedToggle}>
          <Text style={styles.advancedToggleText}>{showAdvanced ? 'Hide advanced' : 'Advanced (optional)'}</Text>
        </Pressable>

        {showAdvanced ? (
          <>
            <Text style={styles.label}>Symptoms (comma-separated)</Text>
            <TextInput
              value={symptoms}
              onChangeText={setSymptoms}
              placeholder="e.g. mild headache"
              style={styles.input}
              autoCapitalize="none"
            />

            <Text style={styles.label}>Override glucose (mg/dL), optional</Text>
            <TextInput
              value={glucoseOverride}
              onChangeText={setGlucoseOverride}
              placeholder={`Leave blank to use live value (${displayMgdl})`}
              style={styles.input}
              keyboardType="number-pad"
            />

            <Text style={styles.label}>Minutes since last meal (optional)</Text>
            <TextInput
              value={minutesSinceMeal}
              onChangeText={setMinutesSinceMeal}
              placeholder="e.g. 30"
              style={styles.input}
              keyboardType="number-pad"
            />

            <Text style={styles.label}>Last meal carbs (g), optional</Text>
            <TextInput
              value={mealCarbs}
              onChangeText={setMealCarbs}
              placeholder="e.g. 60"
              style={styles.input}
              keyboardType="number-pad"
            />

            <View style={styles.switchRow}>
              <Text style={styles.labelInline}>Medication on schedule</Text>
              <Switch value={medsOnTime} onValueChange={setMedsOnTime} />
            </View>

            <Text style={styles.label}>Activity level</Text>
            <View style={styles.row}>
              {(['low', 'moderate', 'high'] as const).map((a) => (
                <Pressable key={a} onPress={() => setActivity(a)} style={[styles.chip, activity === a && styles.chipOn]}>
                  <Text style={[styles.chipText, activity === a && styles.chipTextOn]}>{a}</Text>
                </Pressable>
              ))}
            </View>
          </>
        ) : null}

        <Text style={styles.label}>Location</Text>
        <View style={styles.locRow}>
          <TextInput value={lat} onChangeText={setLat} style={[styles.input, styles.locInput]} keyboardType="numbers-and-punctuation" />
          <TextInput value={lng} onChangeText={setLng} style={[styles.input, styles.locInput]} keyboardType="numbers-and-punctuation" />
        </View>
        <Pressable onPress={useDeviceLocation} style={styles.secondaryBtn}>
          <Text style={styles.secondaryBtnText}>Use device location</Text>
        </Pressable>

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
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f6f8fb' },
  scroll: { padding: 18, paddingBottom: 36, gap: 8 },
  title: { fontSize: 26, fontWeight: '700', color: '#0b1f3a', marginTop: 10 },
  subtitle: { fontSize: 14, color: '#3a4a63', lineHeight: 20, marginBottom: 4 },
  apiHint: {
    fontSize: 12,
    color: '#5c6b82',
    marginBottom: 8,
    fontFamily: 'monospace',
  },
  cgmCard: {
    marginTop: 6,
    backgroundColor: '#fff',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#e5eaf3',
    padding: 14,
    gap: 10,
    overflow: 'hidden',
  },
  cgmTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  cgmValue: { fontSize: 44, fontWeight: '800', color: '#0b1f3a', letterSpacing: -1 },
  cgmUnit: { fontSize: 14, fontWeight: '600', color: '#3a4a63', marginTop: 2, textTransform: 'capitalize' },
  cgmMeta: { alignItems: 'flex-end', maxWidth: '52%' },
  cgmMetaText: { fontSize: 13, fontWeight: '700', color: '#22324d' },
  cgmLoading: { paddingVertical: 24, textAlign: 'center', color: '#5c6b82' },
  speedLabel: { marginTop: 12, fontSize: 13, fontWeight: '700', color: '#22324d' },
  speedPresets: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  speedChip: {
    paddingVertical: 8,
    paddingHorizontal: 11,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#c9d4e8',
    backgroundColor: '#f8fafc',
  },
  speedChipOn: { backgroundColor: '#0f172a', borderColor: '#0f172a' },
  speedChipText: { fontSize: 12, fontWeight: '700', color: '#334155' },
  speedChipTextOn: { color: '#fff' },
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
    borderColor: '#c9d4e8',
    backgroundColor: '#fff',
  },
  speedFineBtnText: { fontWeight: '700', color: '#1f6feb', fontSize: 13 },
  speedFineValue: { fontSize: 16, fontWeight: '800', color: '#0b1f3a', minWidth: 56, textAlign: 'center' },
  advancedToggle: { alignSelf: 'flex-start', marginTop: 4, paddingVertical: 8 },
  advancedToggleText: { color: '#1f6feb', fontWeight: '700', fontSize: 14 },
  label: { marginTop: 10, fontSize: 13, fontWeight: '600', color: '#22324d' },
  labelInline: { fontSize: 13, fontWeight: '600', color: '#22324d' },
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
  row: { flexDirection: 'row', gap: 8, marginTop: 8, flexWrap: 'wrap' },
  chip: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#c9d4e8',
    backgroundColor: '#fff',
  },
  chipOn: { backgroundColor: '#1f6feb', borderColor: '#1f6feb' },
  chipText: { color: '#22324d', fontWeight: '600', textTransform: 'capitalize' },
  chipTextOn: { color: '#fff' },
  switchRow: { marginTop: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  locRow: { flexDirection: 'row', gap: 8 },
  locInput: { flex: 1 },
  secondaryBtn: {
    marginTop: 8,
    alignSelf: 'flex-start',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#c9d4e8',
    backgroundColor: '#fff',
  },
  secondaryBtnText: { color: '#1f6feb', fontWeight: '700' },
  primaryBtn: {
    marginTop: 14,
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
    color: '#5c6b82',
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
