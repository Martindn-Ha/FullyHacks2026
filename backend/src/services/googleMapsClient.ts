import type { PlaceCandidate } from '../types.js';
import { isAbortOrTimeout } from '../utils/isAbortOrTimeout.js';
import { IntegrationError } from './integrationError.js';

const GOOGLE_FETCH_TIMEOUT_MS = 25_000;

const PLACES_NEW_NEARBY_URL = 'https://places.googleapis.com/v1/places:searchNearby';

/** Field mask for Nearby Search (New); spaces are not allowed in the header value. */
const FIELD_MASK =
  'places.id,places.displayName,places.location,places.shortFormattedAddress,places.formattedAddress';

type LatLng = { latitude: number; longitude: number };

type NewNearbyPlace = {
  id?: string;
  displayName?: { text?: string };
  location?: LatLng;
  shortFormattedAddress?: string;
  formattedAddress?: string;
};

type NewNearbyResponse = {
  places?: NewNearbyPlace[];
  error?: { status?: string; message?: string; code?: number };
};

function haversineM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function formatGoogleHttpError(status: number, rawText: string): string {
  try {
    const j = JSON.parse(rawText) as {
      error?: { message?: string; status?: string; code?: number; details?: unknown };
    };
    if (j.error?.message) {
      const bits = [
        `HTTP ${status}`,
        j.error.status,
        typeof j.error.code === 'number' ? `code ${j.error.code}` : '',
        j.error.message,
      ].filter(Boolean);
      return bits.join(' — ');
    }
  } catch {
    /* use raw below */
  }
  return `HTTP ${status}: ${rawText.slice(0, 800)}`;
}

export async function findNearbyRestaurants(params: {
  latitude: number;
  longitude: number;
  radiusM: number;
  apiKey?: string;
}): Promise<{ places: PlaceCandidate[]; source: 'google_maps' }> {
  const { latitude, longitude, radiusM, apiKey } = params;

  if (!apiKey?.trim()) {
    throw new IntegrationError(
      'GOOGLE_MAPS_API_KEY is required (mock data is disabled).',
      503,
    );
  }

  const radius = Math.min(50000, Math.max(1, radiusM));
  const body = {
    includedTypes: ['restaurant'],
    maxResultCount: 12,
    rankPreference: 'DISTANCE',
    locationRestriction: {
      circle: {
        center: { latitude, longitude },
        radius: radius,
      },
    },
  };

  let res: Response;
  try {
    res = await fetch(PLACES_NEW_NEARBY_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-Goog-Api-Key': apiKey.trim(),
        'X-Goog-FieldMask': FIELD_MASK,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(GOOGLE_FETCH_TIMEOUT_MS),
    });
  } catch (e) {
    if (isAbortOrTimeout(e)) {
      throw new IntegrationError(
        `Google Places (New) request timed out after ${GOOGLE_FETCH_TIMEOUT_MS / 1000}s.`,
        504,
      );
    }
    throw new IntegrationError(
      `Google Places (New) request failed: ${e instanceof Error ? e.message : String(e)}`,
      502,
    );
  }

  const rawText = await res.text();
  if (!res.ok) {
    throw new IntegrationError(
      `Google Places (New) ${formatGoogleHttpError(res.status, rawText)}. Common causes: API key restricted to mobile apps or websites (use an unrestricted or IP-based server key for this Node backend), Places API (New) not enabled, or billing disabled.`,
      502,
    );
  }

  let data: NewNearbyResponse;
  try {
    data = JSON.parse(rawText) as NewNearbyResponse;
  } catch {
    throw new IntegrationError('Google Places (New) returned invalid JSON.', 502);
  }

  if (data.error?.message) {
    throw new IntegrationError(
      `Google Places (New) error: ${data.error.status ?? 'ERROR'} — ${data.error.message}`,
      502,
    );
  }

  const rawPlaces = data.places ?? [];
  if (rawPlaces.length === 0) {
    return { places: [], source: 'google_maps' };
  }

  const places: PlaceCandidate[] = [];
  for (const p of rawPlaces) {
    const id = typeof p.id === 'string' ? p.id : '';
    const name = p.displayName?.text?.trim() || 'Unknown';
    const loc = p.location;
    if (!id || typeof loc?.latitude !== 'number' || typeof loc?.longitude !== 'number') {
      continue;
    }
    const vicinity = (p.shortFormattedAddress ?? p.formattedAddress)?.trim();
    places.push({
      id,
      name,
      vicinity: vicinity || undefined,
      latitude: loc.latitude,
      longitude: loc.longitude,
      distanceM: Math.round(haversineM(latitude, longitude, loc.latitude, loc.longitude)),
    });
  }

  if (rawPlaces.length > 0 && places.length === 0) {
    console.warn(
      '[googleMapsClient] Google returned rows but none had both id and location; response shape may have changed—check X-Goog-FieldMask and Places API (New) docs.',
    );
  }

  places.sort((a, b) => a.distanceM - b.distanceM);
  return { places, source: 'google_maps' };
}
