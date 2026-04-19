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
import { fetchClarityDemoCsv, fetchRecommendations, fetchSpikeRisk, type ClarityDemoDataset } from '../api';
import { buildSyntheticClarityCsv, parseClarityExportCsv, type GlucosePoint } from '../clarity/parseClarityExport';
import { DEFAULT_TIME_COMPRESSION, useSimulatedCgmPlayback } from '../clarity/useSimulatedCgmPlayback';

/** When predicted max (purple / Ridge) exceeds this, auto-run device location + recommendations once until it drops. */
const AUTO_RECS_PREDICTED_MAX_MG_DL = 180;
/** Prediction must stay at/below threshold at least this long before a new high can trigger auto recommendations (ignores brief dips). */
const AUTO_RECS_MIN_BELOW_THRESHOLD_MS = 5 * 60 * 1000;

function isFiniteLatLng(o: unknown): o is { latitude: number; longitude: number } {
  if (!o || typeof o !== 'object') return false;
  const lat = Number((o as { latitude?: unknown }).latitude);
  const lng = Number((o as { longitude?: unknown }).longitude);
  return Number.isFinite(lat) && Number.isFinite(lng);
}

export type RecommendationPickVm = {
  placeName: string;
  distanceM: number;
  suggestedItem: string;
  explanation: string;
  nutritionInfo?: string;
  groundedNote?: string;
};

/** Structured last `/api/recommendations` payload for richer UI (still mirrored in `resultText`). */
export type RecommendationResultsVm = {
  updatedAt: string;
  risk: { riskScore: number; severity: string; factors: string[] } | null;
  picks: RecommendationPickVm[];
  note?: string;
};

type CgmSessionContextValue = {
  glucosePoints: GlucosePoint[];
  demoGlucoseDataset: ClarityDemoDataset;
  setDemoGlucoseDataset: (d: ClarityDemoDataset) => void;
  isPlaybackPaused: boolean;
  setPlaybackPaused: (paused: boolean | ((p: boolean) => boolean)) => void;
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
  /** Last successful recommendations response shape; null after errors, escalation, or before first fetch. */
  recommendationResults: RecommendationResultsVm | null;
  recommendationsScrollRef: RefObject<ScrollView | null>;
  useDeviceLocation: () => Promise<void>;
  /** Optional coords skip reading `lat`/`lng` strings (e.g. immediately after GPS). */
  requestRecommendations: (coordsOverride?: { latitude: number; longitude: number }) => Promise<boolean>;
  /** ML model: Ridge regression on 5-minute features (`ml_model/`) via backend; band tint uses a 0–1 score vs threshold. */
  mlSpikeReady: boolean;
  mlSpikeProbability: number | null;
  /** Predicted max glucose in the forward horizon (regression target), when the server returns it. */
  mlPredictedMaxMgDl: number | null;
  mlSpikeThresholdMgDl: number | null;
  mlSpikeHorizonMinutes: number | null;
  mlSpikeNote: string | null;
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
  const [isPlaybackPaused, setPlaybackPaused] = useState(false);
  const { playbackT, displayMgdl, trend } = useSimulatedCgmPlayback(glucosePoints, {
    timeCompression,
    playing: !isPlaybackPaused,
  });

  const [lat, setLat] = useState('33.8823');
  const [lng, setLng] = useState('-117.8851');
  const [loading, setLoading] = useState(false);
  const [resultText, setResultText] = useState<string | null>(null);
  const [recommendationResults, setRecommendationResults] = useState<RecommendationResultsVm | null>(null);
  const [mlSpikeReady, setMlSpikeReady] = useState(false);
  const [mlSpikeProbability, setMlSpikeProbability] = useState<number | null>(null);
  const [mlPredictedMaxMgDl, setMlPredictedMaxMgDl] = useState<number | null>(null);
  const [mlSpikeThresholdMgDl, setMlSpikeThresholdMgDl] = useState<number | null>(null);
  const [mlSpikeHorizonMinutes, setMlSpikeHorizonMinutes] = useState<number | null>(null);
  const [mlSpikeNote, setMlSpikeNote] = useState<string | null>(null);
  const recommendationsScrollRef = useRef<ScrollView>(null);
  const autoRecsFromPredictionLatchRef = useRef(false);
  /** When latched, first time we see pred ≤ threshold; used to require sustained “low” before re-arming. */
  const dipBelowThresholdSinceMsRef = useRef<number | null>(null);

  /** `playbackT` updates every frame during replay; do not put it in effect deps or the debounce never fires. */
  const playbackTRef = useRef(playbackT);
  const glucosePointsRef = useRef(glucosePoints);
  const timeCompressionRef = useRef(timeCompression);
  playbackTRef.current = playbackT;
  glucosePointsRef.current = glucosePoints;
  timeCompressionRef.current = timeCompression;

  useEffect(() => {
    if (glucosePoints.length < 30) {
      setMlSpikeReady(false);
      setMlSpikeProbability(null);
      setMlPredictedMaxMgDl(null);
      setMlSpikeThresholdMgDl(null);
      setMlSpikeHorizonMinutes(null);
      setMlSpikeNote('ML spike: need more CGM points in buffer.');
      return;
    }

    setMlSpikeNote(null);

    let cancelled = false;
    let inFlight: AbortController | null = null;
    /** Avoid overlapping `/spike-risk` calls — aborting each tick cancelled the prior request before Python finished (looked like “always 0%”). */
    let spikeFetchBusy = false;

    const tick = async () => {
      if (cancelled || spikeFetchBusy) return;
      spikeFetchBusy = true;
      const ac = new AbortController();
      inFlight = ac;
      const signal = ac.signal;

      const wallStart = Date.now();
      const playbackAtRequest = playbackTRef.current;
      const comp = timeCompressionRef.current;

      const pts = glucosePointsRef.current;
      const t = playbackAtRequest;
      const slice = pts.filter((p) => p.t <= t).slice(-800);
      if (slice.length < 30) {
        spikeFetchBusy = false;
        if (!signal.aborted && !cancelled) {
          setMlSpikeReady(false);
          setMlSpikeProbability(null);
          setMlPredictedMaxMgDl(null);
          setMlSpikeNote('ML spike: need more history up to the playhead.');
        }
        return;
      }
      try {
        const r = await fetchSpikeRisk(slice, signal);
        if (signal.aborted || cancelled) return;

        const wallDt = Date.now() - wallStart;
        const drift = Math.abs(playbackTRef.current - playbackAtRequest);
        /** Allow batched rAF (drift can exceed `wallDt×comp`); still drop obviously stale responses after slow networks. */
        const maxDrift = Math.min(wallDt * comp * 5 + 500_000, 50 * 60_000);
        if (drift > maxDrift) {
          return;
        }

        setMlSpikeThresholdMgDl(typeof r.thresholdMgDl === 'number' ? r.thresholdMgDl : null);
        setMlSpikeHorizonMinutes(typeof r.horizonMinutes === 'number' ? r.horizonMinutes : null);
        const pred =
          typeof r.predictedMaxMgDl === 'number' && Number.isFinite(r.predictedMaxMgDl)
            ? r.predictedMaxMgDl
            : null;
        if (r.ready && typeof r.spikeProbability === 'number' && Number.isFinite(r.spikeProbability)) {
          setMlSpikeReady(true);
          setMlSpikeProbability(r.spikeProbability);
          setMlPredictedMaxMgDl(pred);
          setMlSpikeNote(null);
        } else {
          setMlSpikeReady(false);
          setMlSpikeProbability(null);
          setMlPredictedMaxMgDl(null);
          setMlSpikeNote(
            r.reason === 'insufficient_history'
              ? 'ML spike: not enough recent window (~90+ min of CGM).'
              : r.error
                ? `ML spike: ${r.error}${r.message ? ` (${r.message})` : ''}`
                : 'ML spike unavailable.',
          );
        }
      } catch {
        if (!signal.aborted && !cancelled) {
          setMlSpikeReady(false);
          setMlSpikeProbability(null);
          setMlPredictedMaxMgDl(null);
          setMlSpikeNote('ML spike: API unreachable or timed out.');
        }
      } finally {
        spikeFetchBusy = false;
      }
    };

    void tick();
    const pollMs = Math.max(
      900,
      Math.min(2500, Math.round(1_200_000 / Math.max(40, timeCompression))),
    );
    const id = setInterval(() => void tick(), pollMs);
    return () => {
      cancelled = true;
      inFlight?.abort();
      clearInterval(id);
    };
  }, [glucosePoints, timeCompression]);

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

  const requestRecommendations = useCallback(
    async (coordsOverride?: { latitude: number; longitude: number }): Promise<boolean> => {
    const latitude = isFiniteLatLng(coordsOverride) ? coordsOverride.latitude : Number(lat);
    const longitude = isFiniteLatLng(coordsOverride) ? coordsOverride.longitude : Number(lng);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      Alert.alert('Location', 'Enter valid latitude and longitude, or use device location.');
      return false;
    }

    setLoading(true);
    setResultText(null);
    setRecommendationResults(null);
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
        setRecommendationResults(null);
        setResultText(data.escalationMessage ?? data.safety.message ?? 'Escalation triggered.');
        return true;
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
      setRecommendationResults({
        updatedAt: stamp,
        risk: risk
          ? {
              riskScore: risk.riskScore,
              severity: risk.severity,
              factors: [...risk.factors],
            }
          : null,
        picks: data.recommendations.map((r) => ({
          placeName: r.place.name,
          distanceM: r.place.distanceM,
          suggestedItem: r.suggestedItem,
          explanation: r.explanation,
          nutritionInfo: r.nutritionInfo?.trim() || undefined,
          groundedNote: r.groundedNote?.trim() || undefined,
        })),
        note: note || undefined,
      });
      setTimeout(() => recommendationsScrollRef.current?.scrollToEnd({ animated: true }), 150);
      return true;
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Unknown error';
      console.error('[recommendations]', message);
      setRecommendationResults(null);
      setResultText(
        `Could not reach the API.\n\n${message}\n\nBackend (on your Mac):\n  cd backend && npm run dev`,
      );
      return false;
    } finally {
      setLoading(false);
    }
  },
  [lat, lng, displayMgdl, trend],
);

  /**
   * Predicted max > 180 → foreground location + recommendations (once per high episode).
   * Must stay ≤ threshold for `AUTO_RECS_MIN_BELOW_THRESHOLD_MS` before re-arming; a short dip then spike does not re-trigger.
   * `playbackT` is in deps so duration is re-evaluated during CGM replay.
   */
  useEffect(() => {
    const pred = mlPredictedMaxMgDl;
    const predOk = pred != null && Number.isFinite(pred);

    const resetEpisode = () => {
      autoRecsFromPredictionLatchRef.current = false;
      dipBelowThresholdSinceMsRef.current = null;
    };

    if (!mlSpikeReady || !predOk) {
      if (!predOk || pred <= AUTO_RECS_PREDICTED_MAX_MG_DL) {
        resetEpisode();
      }
      return;
    }

    if (pred <= AUTO_RECS_PREDICTED_MAX_MG_DL) {
      if (autoRecsFromPredictionLatchRef.current) {
        if (dipBelowThresholdSinceMsRef.current == null) {
          dipBelowThresholdSinceMsRef.current = Date.now();
        } else if (Date.now() - dipBelowThresholdSinceMsRef.current >= AUTO_RECS_MIN_BELOW_THRESHOLD_MS) {
          resetEpisode();
        }
      } else {
        dipBelowThresholdSinceMsRef.current = null;
      }
      return;
    }

    if (dipBelowThresholdSinceMsRef.current != null) {
      const dipMs = Date.now() - dipBelowThresholdSinceMsRef.current;
      dipBelowThresholdSinceMsRef.current = null;
      if (dipMs < AUTO_RECS_MIN_BELOW_THRESHOLD_MS && autoRecsFromPredictionLatchRef.current) {
        return;
      }
    }

    if (autoRecsFromPredictionLatchRef.current) return;
    autoRecsFromPredictionLatchRef.current = true;

    void (async () => {
      try {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (permission.status !== 'granted') {
          resetEpisode();
          return;
        }
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        const latitude = pos.coords.latitude;
        const longitude = pos.coords.longitude;
        setLat(String(latitude));
        setLng(String(longitude));
        const ok = await requestRecommendations({ latitude, longitude });
        if (!ok) {
          resetEpisode();
        }
      } catch (e) {
        console.error('[auto-recs prediction]', e);
        resetEpisode();
      }
    })();
  }, [mlSpikeReady, mlPredictedMaxMgDl, requestRecommendations, playbackT]);

  const value = useMemo(
    () =>
      ({
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
        lat,
        lng,
        setLat,
        setLng,
        loading,
        resultText,
        recommendationResults,
        recommendationsScrollRef,
        useDeviceLocation,
        requestRecommendations,
        mlSpikeReady,
        mlSpikeProbability,
        mlPredictedMaxMgDl,
        mlSpikeThresholdMgDl,
        mlSpikeHorizonMinutes,
        mlSpikeNote,
      }) satisfies CgmSessionContextValue,
    [
      glucosePoints,
      demoGlucoseDataset,
      isPlaybackPaused,
      timeCompression,
      playbackT,
      displayMgdl,
      trend,
      lat,
      lng,
      loading,
      resultText,
      recommendationResults,
      mlSpikeReady,
      mlSpikeProbability,
      mlPredictedMaxMgDl,
      mlSpikeThresholdMgDl,
      mlSpikeHorizonMinutes,
      mlSpikeNote,
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
