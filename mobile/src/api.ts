import Constants from 'expo-constants';
import type { GlucosePoint } from './clarity/parseClarityExport';

const baseUrl =
  process.env.EXPO_PUBLIC_API_BASE_URL ||
  (Constants.expoConfig?.extra as { apiBaseUrl?: string } | undefined)?.apiBaseUrl ||
  'http://localhost:3000';

export function getApiBaseUrl(): string {
  return baseUrl;
}

export type ClarityDemoDataset = 'nondiabetic' | 'diabetic';

export type SpikeRiskResponse = {
  ready: boolean;
  spikeProbability?: number | null;
  predictedMaxMgDl?: number | null;
  task?: string;
  thresholdMgDl?: number;
  horizonMinutes?: number;
  nPointsUsed?: number;
  error?: string;
  reason?: string;
  message?: string;
};

const SPIKE_TIMEOUT_MS = 30_000;

/** Calls backend `/api/spike-risk` (Python Ridge regression bundle in `ml_model/` on the server). */
export async function fetchSpikeRisk(
  points: Pick<GlucosePoint, 't' | 'mgdl'>[],
  outerSignal?: AbortSignal,
): Promise<SpikeRiskResponse> {
  const url = `${baseUrl.replace(/\/$/, '')}/api/spike-risk`;
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), SPIKE_TIMEOUT_MS);
  if (outerSignal) {
    if (outerSignal.aborted) ctrl.abort();
    else outerSignal.addEventListener('abort', () => ctrl.abort(), { once: true });
  }
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ points }),
      signal: ctrl.signal,
    });
    const text = await res.text();
    let data: SpikeRiskResponse;
    try {
      data = JSON.parse(text) as SpikeRiskResponse;
    } catch {
      throw new Error(text.slice(0, 200) || `Spike risk failed (${res.status})`);
    }
    if (!res.ok) {
      throw new Error(data.message || data.error || `Spike risk failed (${res.status})`);
    }
    return data;
  } finally {
    clearTimeout(id);
  }
}

/** Optional: raw Clarity / Stelo CSV from backend `dummydata/` for the CGM-style graph. */
export async function fetchClarityDemoCsv(dataset: ClarityDemoDataset = 'nondiabetic'): Promise<string | null> {
  const url = `${baseUrl.replace(/\/$/, '')}/api/clarity-demo?dataset=${encodeURIComponent(dataset)}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

/** Backend can take up to ~115s (Google 25s + Human Delta 90s) before responding. */
const RECOMMENDATIONS_TIMEOUT_MS = 150_000;

/** Human Delta search + Gemini SMS narrative (Contact screen). */
const SMS_CHECK_IN_MESSAGE_TIMEOUT_MS = 120_000;

async function fetchWithTimeout(
  input: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(id);
  }
}

export type GlucoseTrend = 'rising' | 'stable' | 'falling';
export type ActivityLevel = 'low' | 'moderate' | 'high';

export type RecommendationRequest = {
  symptoms: string[];
  recentGlucoseMgDl?: number;
  glucoseTrend?: GlucoseTrend;
  minutesSinceLastMeal?: number;
  lastMealCarbsG?: number;
  medicationOnSchedule?: boolean;
  activityLevel?: ActivityLevel;
  latitude: number;
  longitude: number;
  radiusM?: number;
};

export type RecommendationResponse = {
  safety: { escalate: boolean; suppressFoodRecommendations: boolean; message?: string };
  risk: { riskScore: number; severity: string; factors: string[] } | null;
  recommendations: {
    place: { id: string; name: string; vicinity?: string; distanceM: number };
    suggestedItem: string;
    explanation: string;
    nutritionInfo?: string;
    groundedNote?: string;
  }[];
  exerciseRecommendations?: {
    title: string;
    minutes: number;
    intensity: 'low' | 'moderate';
    reason: string;
    indoorPreferred: boolean;
  }[];
  weather?: {
    temperatureC: number | null;
    apparentTemperatureC: number | null;
    precipitationMm: number | null;
    weatherCode: number | null;
    windSpeedKmh: number | null;
    isDay: boolean | null;
  } | null;
  sources?: { places: string; guidance: string; weather?: string };
  /** When spike risk is low, backend skips Maps/Gemini and explains why `recommendations` is empty. */
  recommendationsNote?: string;
  escalationMessage?: string;
  disclaimer?: string;
};

export type SmsCheckInMessageRequest = {
  symptoms: string[];
  templateFields: Record<string, string>;
  messageTemplate?: string;
  recentSpikeEvents: {
    atMs: number;
    glucoseMgDl: number;
    latitude: number | null;
    longitude: number | null;
  }[];
};

export type SmsCheckInMessageResponse = {
  message: string;
  humanDeltaPassageCount: number;
  disclaimer?: string;
};

export async function fetchSmsCheckInMessage(
  body: SmsCheckInMessageRequest,
): Promise<SmsCheckInMessageResponse> {
  const url = `${baseUrl.replace(/\/$/, '')}/api/sms-check-in-message`;
  const res = await fetchWithTimeout(
    url,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
    SMS_CHECK_IN_MESSAGE_TIMEOUT_MS,
  );
  const text = await res.text();
  let data: SmsCheckInMessageResponse & { error?: string };
  try {
    data = JSON.parse(text) as typeof data;
  } catch {
    throw new Error(text.slice(0, 200) || `SMS narrative failed (${res.status})`);
  }
  if (!res.ok) {
    throw new Error(data.error || text || `SMS narrative failed (${res.status})`);
  }
  if (typeof data.message !== 'string' || !data.message.trim()) {
    throw new Error('SMS narrative response missing message.');
  }
  return data;
}

export async function fetchRecommendations(
  body: RecommendationRequest,
): Promise<RecommendationResponse> {
  const url = `${baseUrl.replace(/\/$/, '')}/api/recommendations`;

  let res: Response;
  try {
    res = await fetchWithTimeout(
      url,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
      RECOMMENDATIONS_TIMEOUT_MS,
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Network request failed';
    const aborted = e instanceof Error && e.name === 'AbortError';
    /** iOS often uses this wording when the TCP path to the Mac never completes (wrong IP, Wi‑Fi isolation, firewall). */
    const iosUnreachable =
      /network request timed out|could not connect|failed to connect|not connected to internet/i.test(
        msg,
      );

    const raw = aborted
      ? `No HTTP response within ${RECOMMENDATIONS_TIMEOUT_MS / 1000}s (client gave up). If the backend is slow, check the Mac terminal; otherwise the phone may not be reaching your Mac.`
      : iosUnreachable
        ? `${msg} (Usually: iPhone and Mac not on the same LAN, Mac Wi‑Fi IP changed, or macOS Firewall blocking port 3000.)`
        : msg;

    const localhostish =
      /localhost|127\.0\.0\.1/i.test(baseUrl) || baseUrl === 'http://localhost:3000';
    const hint = localhostish
      ? ' On a physical iPhone, localhost is the phone. Set EXPO_PUBLIC_API_BASE_URL to http://<YOUR-MAC-LAN-IP>:3000 (run on Mac: ipconfig getifaddr en0), same Wi‑Fi as the Mac, then restart Expo with npx expo start --clear.'
      : ` On the iPhone, open Safari and visit ${baseUrl.replace(/\/$/, '')}/health — if it does not show {"ok":true}, fix Wi‑Fi/IP/firewall first. Expo "tunnel" only loads JS; it does not tunnel this API URL. For cellular or guest Wi‑Fi, expose the backend with ngrok/cloudflared and put that https URL in EXPO_PUBLIC_API_BASE_URL.`;
    console.error('[recommendations] fetch failed', { url, aborted, message: msg });
    throw new Error(`${raw}\n\n${hint}\n\nRequest URL: ${url}`);
  }

  if (!res.ok) {
    const text = await res.text();
    let parsed: { error?: string } | null = null;
    try {
      parsed = JSON.parse(text) as { error?: string };
    } catch {
      parsed = null;
    }
    if (parsed && typeof parsed.error === 'string' && parsed.error.trim()) {
      throw new Error(parsed.error);
    }
    throw new Error(text || `Request failed (${res.status})`);
  }

  return (await res.json()) as RecommendationResponse;
}
