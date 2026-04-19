import type { MenuPassage, PlaceCandidate } from '../types.js';
import { isAbortOrTimeout } from '../utils/isAbortOrTimeout.js';
import { IntegrationError } from './integrationError.js';

const HUMAN_DELTA_FETCH_TIMEOUT_MS = 90_000;

export type PlaceGuidanceRow = {
  placeId: string;
  placeName: string;
  passages: MenuPassage[];
};

export async function retrieveMenuGuidance(params: {
  places: PlaceCandidate[];
  queryHint: string;
  apiUrl?: string;
  apiKey?: string;
}): Promise<PlaceGuidanceRow[]> {
  const { places, queryHint, apiUrl, apiKey } = params;

  if (!places.length) {
    return [];
  }

  if (!apiUrl?.trim()) {
    throw new IntegrationError(
      'HUMAN_DELTA_API_URL is required (mock data is disabled).',
      503,
    );
  }

  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (apiKey?.trim()) {
    headers.authorization = `Bearer ${apiKey.trim()}`;
  }

  let res: Response;
  try {
    res = await fetch(apiUrl.trim(), {
      method: 'POST',
      headers,
      body: JSON.stringify({
        query: queryHint,
        places: places.map((p) => ({ id: p.id, name: p.name, vicinity: p.vicinity })),
      }),
      signal: AbortSignal.timeout(HUMAN_DELTA_FETCH_TIMEOUT_MS),
    });
  } catch (e) {
    if (isAbortOrTimeout(e)) {
      throw new IntegrationError(
        `Human Delta request timed out after ${HUMAN_DELTA_FETCH_TIMEOUT_MS / 1000}s. Check HUMAN_DELTA_API_URL and server load.`,
        504,
      );
    }
    const msg = e instanceof Error ? e.message : 'Unknown error';
    throw new IntegrationError(`Human Delta request failed: ${msg}`, 502);
  }

  const rawText = await res.text();
  if (!res.ok) {
    throw new IntegrationError(
      `Human Delta returned HTTP ${res.status}: ${rawText.slice(0, 800)}`,
      502,
    );
  }

  let json: unknown;
  try {
    json = JSON.parse(rawText) as unknown;
  } catch {
    throw new IntegrationError('Human Delta returned invalid JSON.', 502);
  }

  const parsed = parseHumanDeltaResponse(json);
  if (!parsed || parsed.length === 0) {
    throw new IntegrationError(
      'Human Delta response did not contain a non-empty `items` (or `results`) array with { placeId, passages: [{ text }] } entries.',
      502,
    );
  }

  const byId = new Map(parsed.map((r) => [r.placeId, r]));
  for (const p of places) {
    const row = byId.get(p.id);
    if (!row || row.passages.length === 0) {
      throw new IntegrationError(
        `Human Delta did not return at least one passage for place "${p.name}" (${p.id}).`,
        502,
      );
    }
    for (const passage of row.passages) {
      if (!passage.text.trim()) {
        throw new IntegrationError(
          `Human Delta returned an empty passage for place "${p.name}" (${p.id}).`,
          502,
        );
      }
    }
  }

  return places.map((p) => byId.get(p.id)!);
}

function parseHumanDeltaResponse(json: unknown): PlaceGuidanceRow[] | null {
  if (!json || typeof json !== 'object') return null;
  const root = json as Record<string, unknown>;
  const items = root.items ?? root.results;
  if (!Array.isArray(items)) return null;

  const rows: PlaceGuidanceRow[] = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const placeId = typeof rec.placeId === 'string' ? rec.placeId : undefined;
    const placeName = typeof rec.placeName === 'string' ? rec.placeName : undefined;
    const passagesRaw = rec.passages;
    if (!placeId || !Array.isArray(passagesRaw)) continue;

    const passages: MenuPassage[] = [];
    for (const p of passagesRaw) {
      if (!p || typeof p !== 'object') continue;
      const pr = p as Record<string, unknown>;
      const text = typeof pr.text === 'string' ? pr.text : null;
      if (!text?.trim()) continue;
      passages.push({ text, source: 'human_delta' });
    }

    if (!passages.length) continue;

    rows.push({
      placeId,
      placeName: placeName ?? 'Unknown',
      passages,
    });
  }

  return rows.length ? rows : null;
}

/** When `HUMAN_DELTA_API_URL` is unset: generic text so Google-only flows can rank and demo. */
export function buildPlaceholderGuidance(places: PlaceCandidate[]): PlaceGuidanceRow[] {
  return places.map((p) => ({
    placeId: p.id,
    placeName: p.name,
    passages: [
      {
        source: 'google_test_placeholder',
        text:
          `Human Delta is not configured. Generic pattern for "${p.name}": prefer grilled protein, salads with dressing on the side, vegetables, and water or unsweetened drinks; limit sugary sauces and large refined-starch portions.`,
      },
    ],
  }));
}
