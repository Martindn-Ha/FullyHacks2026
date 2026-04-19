import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { Alert, ScrollView } from 'react-native';
import * as Location from 'expo-location';
import { fetchClarityDemoCsv, fetchRecommendations, type ClarityDemoDataset } from '../api';
import { buildSyntheticClarityCsv, parseClarityExportCsv, type GlucosePoint } from '../clarity/parseClarityExport';
import { DEFAULT_TIME_COMPRESSION, useSimulatedCgmPlayback } from '../clarity/useSimulatedCgmPlayback';

type CgmSessionContextValue = {
  glucosePoints: GlucosePoint[];
  demoGlucoseDataset: ClarityDemoDataset;
  setDemoGlucoseDataset: (d: ClarityDemoDataset) => void;
  timeCompression: number;
  setTimeCompression: (c: number | ((p: number) => number)) => void;
  playbackT: number;
  displayMgdl: number;
  trend: string;
  lat: string;
  lng: string;
  setLat: (s: string) => void;
  setLng: (s: string) => void;
  loading: boolean;
  resultText: string | null;
  recommendationsScrollRef: RefObject<ScrollView | null>;
  useDeviceLocation: () => Promise<void>;
  requestRecommendations: () => Promise<void>;
};

const CgmSessionContext = createContext<CgmSessionContextValue | null>(null);

export function CgmSessionProvider({ children }: { children: ReactNode }) {
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

  const [lat, setLat] = useState('33.8823');
  const [lng, setLng] = useState('-117.8851');
  const [loading, setLoading] = useState(false);
  const [resultText, setResultText] = useState<string | null>(null);
  const recommendationsScrollRef = useRef<ScrollView>(null);

  const useDeviceLocation = useCallback(async () => {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (permission.status !== 'granted') {
      Alert.alert('Location', 'Location permission is needed to find nearby options.');
      return;
    }

    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    setLat(String(pos.coords.latitude));
    setLng(String(pos.coords.longitude));
  }, []);

  const requestRecommendations = useCallback(async () => {
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
      setTimeout(() => recommendationsScrollRef.current?.scrollToEnd({ animated: true }), 150);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Unknown error';
      console.error('[recommendations]', message);
      setResultText(
        `Could not reach the API.\n\n${message}\n\nBackend (on your Mac):\n  cd backend && npm run dev`,
      );
    } finally {
      setLoading(false);
    }
  }, [lat, lng, displayMgdl, trend]);

  const value = useMemo(
    () =>
      ({
        glucosePoints,
        demoGlucoseDataset,
        setDemoGlucoseDataset,
        timeCompression,
        setTimeCompression,
        playbackT,
        displayMgdl,
        trend,
        lat,
        lng,
        setLat,
        setLng,
        loading,
        resultText,
        recommendationsScrollRef,
        useDeviceLocation,
        requestRecommendations,
      }) satisfies CgmSessionContextValue,
    [
      glucosePoints,
      demoGlucoseDataset,
      timeCompression,
      playbackT,
      displayMgdl,
      trend,
      lat,
      lng,
      loading,
      resultText,
      useDeviceLocation,
      requestRecommendations,
    ],
  );

  return <CgmSessionContext.Provider value={value}>{children}</CgmSessionContext.Provider>;
}

export function useCgmSession(): CgmSessionContextValue {
  const ctx = useContext(CgmSessionContext);
  if (!ctx) {
    throw new Error('useCgmSession must be used within CgmSessionProvider');
  }
  return ctx;
}
