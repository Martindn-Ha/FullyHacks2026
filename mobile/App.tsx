import { StatusBar } from 'expo-status-bar';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as Location from 'expo-location';
import { fetchRecommendations, getApiBaseUrl, type ActivityLevel, type GlucoseTrend } from './src/api';

export default function App() {
  const [symptoms, setSymptoms] = useState('');
  const [glucose, setGlucose] = useState('');
  const [trend, setTrend] = useState<GlucoseTrend>('stable');
  const [minutesSinceMeal, setMinutesSinceMeal] = useState('');
  const [mealCarbs, setMealCarbs] = useState('');
  const [medsOnTime, setMedsOnTime] = useState(true);
  const [activity, setActivity] = useState<ActivityLevel>('moderate');
  const [lat, setLat] = useState('33.8823');
  const [lng, setLng] = useState('-117.8851');
  const [loading, setLoading] = useState(false);
  const [resultText, setResultText] = useState<string | null>(null);

  const symptomList = useMemo(
    () =>
      symptoms
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    [symptoms],
  );

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
        recentGlucoseMgDl: glucose.trim() ? Number(glucose) : undefined,
        glucoseTrend: trend,
        minutesSinceLastMeal: minutesSinceMeal.trim() ? Number(minutesSinceMeal) : undefined,
        lastMealCarbsG: mealCarbs.trim() ? Number(mealCarbs) : undefined,
        medicationOnSchedule: medsOnTime,
        activityLevel: activity,
        latitude,
        longitude,
      });

      if (data.safety.escalate) {
        setResultText(
          `${data.escalationMessage ?? data.safety.message ?? 'Escalation triggered.'}\n\n${data.disclaimer ?? ''}`,
        );
        return;
      }

      const risk = data.risk;
      const header = risk
        ? `Risk score: ${risk.riskScore.toFixed(2)} (${risk.severity})\n${risk.factors.join('\n')}`
        : 'Risk unavailable.';

      const recs = data.recommendations
        .map((r, idx) => {
          const note = r.groundedNote ? `\n${r.groundedNote}` : '';
          return `${idx + 1}. ${r.place.name} (~${r.place.distanceM}m)\nSuggested: ${r.suggestedItem}\n${r.explanation}${note}`;
        })
        .join('\n\n');

      const sources = data.sources
        ? `\n\nSources: places=${data.sources.places}, guidance=${data.sources.guidance}`
        : '';

      setResultText(`${header}\n\nTop picks:\n${recs}${sources}\n\n${data.disclaimer ?? ''}`);
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

  return (
    <View style={styles.screen}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Nearby meal guidance</Text>
        <Text style={styles.subtitle}>
          Spike-risk estimate plus ranked nearby options. Not medical advice.
        </Text>
        <Text style={styles.apiHint} selectable>
          API: {getApiBaseUrl()}
        </Text>

        <Text style={styles.label}>Symptoms (comma-separated)</Text>
        <TextInput
          value={symptoms}
          onChangeText={setSymptoms}
          placeholder="e.g. mild headache"
          style={styles.input}
          autoCapitalize="none"
        />

        <Text style={styles.label}>Recent glucose (mg/dL), optional</Text>
        <TextInput value={glucose} onChangeText={setGlucose} placeholder="e.g. 165" style={styles.input} keyboardType="number-pad" />

        <Text style={styles.label}>Glucose trend</Text>
        <View style={styles.row}>
          {(['falling', 'stable', 'rising'] as const).map((t) => (
            <Pressable key={t} onPress={() => setTrend(t)} style={[styles.chip, trend === t && styles.chipOn]}>
              <Text style={[styles.chipText, trend === t && styles.chipTextOn]}>{t}</Text>
            </Pressable>
          ))}
        </View>

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
