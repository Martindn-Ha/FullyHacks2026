import Constants from 'expo-constants';

const baseUrl =
  process.env.EXPO_PUBLIC_API_BASE_URL ||
  (Constants.expoConfig?.extra as { apiBaseUrl?: string } | undefined)?.apiBaseUrl ||
  'http://localhost:3000';

export function getApiBaseUrl(): string {
  return baseUrl;
}

/** Backend can take up to ~115s (Google 25s + Human Delta 90s) before responding. */
const RECOMMENDATIONS_TIMEOUT_MS = 150_000;

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
  sources?: { places: string; guidance: string };
  /** When spike risk is low, backend skips Maps/Gemini and explains why `recommendations` is empty. */
  recommendationsNote?: string;
  escalationMessage?: string;
  disclaimer?: string;
};

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
