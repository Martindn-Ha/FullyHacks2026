import type { MenuPassage, PlaceCandidate } from '../types.js';
import { isAbortOrTimeout } from '../utils/isAbortOrTimeout.js';
import { IntegrationError } from './integrationError.js';

const HUMAN_DELTA_FETCH_TIMEOUT_MS = 90_000;

/**
 * Optional fields for official `POST /v1/search` (see repo `Human_delta_rest_api.txt`):
 * `top_k`, `sources`, `index_id`. Gemini is not called by Human Delta — you retrieve here, then pass
 * chunks into Vertex/Gemini in `synthesizeGuidanceWithGemini`.
 */
function officialSearchBodyFromEnv(): {
  top_k: number;
  sources?: string[];
  index_id?: string;
} {
  const out: { top_k: number; sources?: string[]; index_id?: string } = { top_k: 10 };
  const tk = process.env.HUMAN_DELTA_TOP_K?.trim();
  if (tk) {
    const n = Number(tk);
    if (Number.isFinite(n)) {
      out.top_k = Math.min(20, Math.max(1, Math.round(n)));
    }
  }
  const iid = process.env.HUMAN_DELTA_INDEX_ID?.trim();
  if (iid) {
    out.index_id = iid;
  }
  const src = process.env.HUMAN_DELTA_SOURCES?.trim();
  if (src) {
    if (src.startsWith('[')) {
      try {
        const j = JSON.parse(src) as unknown;
        if (Array.isArray(j) && j.every((x) => typeof x === 'string')) {
          out.sources = j as string[];
        }
      } catch {
        /* ignore invalid JSON */
      }
    }
    if (!out.sources) {
      out.sources = src.split(',').map((s) => s.trim()).filter(Boolean);
    }
  }
  return out;
}

/** Official Human Delta REST search from their API reference (Base: https://api.humandelta.ai). */
function isHumanDeltaOfficialSearchUrl(apiUrl: string): boolean {
  try {
    const u = new URL(apiUrl.trim());
    return u.hostname === 'api.humandelta.ai' && /^\/v1\/search\/?$/i.test(u.pathname);
  } catch {
    return false;
  }
}

/** When set, `rankFoodRecommendations` prefers these strings over raw retrieval + keyword templates. */
export type LlmGuidancePresentation = {
  suggestedItem: string;
  /** One short sentence from Gemini (spike-risk rationale). */
  explanation: string;
  /** Calories/macros from CONTEXT only when present; otherwise omitted or “not in snippet”. */
  nutritionInfo?: string;
};

export type PlaceGuidanceRow = {
  placeId: string;
  placeName: string;
  passages: MenuPassage[];
  llmPresentation?: LlmGuidancePresentation;
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

  const url = apiUrl.trim();
  const useOfficialSearch = isHumanDeltaOfficialSearchUrl(url);
  const hdSearch = officialSearchBodyFromEnv();
  const body = useOfficialSearch
    ? {
        query: [
          queryHint,
          '',
          'Nearby venues (Google place_id → name):',
          ...places.map((p) => `- ${p.id}: ${p.name}${p.vicinity ? ` — ${p.vicinity}` : ''}`),
        ].join('\n'),
        top_k: hdSearch.top_k,
        ...(hdSearch.sources?.length ? { sources: hdSearch.sources } : {}),
        ...(hdSearch.index_id ? { index_id: hdSearch.index_id } : {}),
      }
    : {
        query: queryHint,
        places: places.map((p) => ({ id: p.id, name: p.name, vicinity: p.vicinity })),
      };

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
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

  let parsed = parseHumanDeltaResponse(json);
  if (!parsed?.length && useOfficialSearch) {
    const snippets = extractSnippetsFromSearchJson(json);
    if (snippets.length) {
      const blob = snippets.slice(0, 20).join('\n\n');
      parsed = places.map((p) => ({
        placeId: p.id,
        placeName: p.name,
        passages: [{ text: blob, source: 'human_delta' }],
      }));
    }
  }
  if (!parsed || parsed.length === 0) {
    if (isEmptySearchResponseJson(json)) {
      console.warn(
        '[humanDeltaClient] Human Delta returned zero search hits (e.g. { results: [] }). Using generic guidance so Google recommendations still work — add menus to your Human Delta index to get grounded snippets.',
      );
      return buildHumanDeltaEmptyFallbackGuidance(places);
    }
    console.error('[humanDeltaClient] Could not parse Human Delta JSON. Top-level keys:', summarizeJsonKeys(json));
    console.error('[humanDeltaClient] Response body preview:', rawText.slice(0, 2000));
    throw new IntegrationError(
      'Human Delta response was not understood. Check the TWO log lines above in this terminal (keys + body preview). Common causes: empty search (nothing indexed yet), or JSON uses field names we do not map yet.',
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

/** True when the main hit list is present and empty (successful search, zero documents). */
function isEmptySearchResponseJson(json: unknown): boolean {
  if (!json || typeof json !== 'object') return false;
  const r = json as Record<string, unknown>;
  if ('results' in r && Array.isArray(r.results) && r.results.length === 0) return true;
  if ('items' in r && Array.isArray(r.items) && r.items.length === 0) return true;
  return false;
}

function summarizeJsonKeys(json: unknown): string {
  if (json === null || json === undefined) return String(json);
  if (typeof json !== 'object') return typeof json;
  const o = json as Record<string, unknown>;
  return Object.entries(o)
    .slice(0, 24)
    .map(([k, v]) => {
      if (v === null) return `${k}:null`;
      if (Array.isArray(v)) return `${k}:array(len=${v.length})`;
      if (typeof v === 'object') return `${k}:object`;
      return `${k}:${typeof v}`;
    })
    .join(', ');
}

function parseHumanDeltaResponse(json: unknown): PlaceGuidanceRow[] | null {
  if (!json || typeof json !== 'object') return null;
  const root = json as Record<string, unknown>;
  const itemsRaw = root.items ?? root.results;
  if (!Array.isArray(itemsRaw)) return null;
  const items = itemsRaw.filter((x) => x && typeof x === 'object');
  if (items.length === 0) return null;

  const rows: PlaceGuidanceRow[] = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const placeId =
      typeof rec.placeId === 'string'
        ? rec.placeId
        : typeof rec.place_id === 'string'
          ? rec.place_id
          : undefined;
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

function pickTextFromHit(o: Record<string, unknown>): string | null {
  for (const k of ['text', 'content', 'snippet', 'body', 'chunk_text', 'page_content', 'markdown', 'value']) {
    const v = o[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  for (const nest of ['chunk', 'document', 'match', 'source', 'metadata']) {
    const n = o[nest];
    if (n && typeof n === 'object') {
      const t = pickTextFromHit(n as Record<string, unknown>);
      if (t) return t;
    }
  }
  const msg = o.message;
  if (msg && typeof msg === 'object') {
    const inner = msg as Record<string, unknown>;
    const c = inner.content;
    if (typeof c === 'string' && c.trim()) return c.trim();
  }
  return null;
}

/** Best-effort extraction when `POST /v1/search` returns a generic RAG shape (not per-placeId rows). */
function extractSnippetsFromSearchJson(json: unknown, depth = 0): string[] {
  if (depth > 10) return [];
  if (json === null || json === undefined) return [];
  if (typeof json === 'string' && json.trim()) return [json.trim()];
  if (typeof json !== 'object') return [];

  const root = json as Record<string, unknown>;
  const out: string[] = [];

  for (const k of ['answer', 'text', 'content', 'snippet', 'output', 'message']) {
    const v = root[k];
    if (typeof v === 'string' && v.trim()) out.push(v.trim());
  }

  for (const arrKey of [
    'results',
    'hits',
    'chunks',
    'matches',
    'documents',
    'items',
    'data',
    'search_results',
    'records',
    'sources',
  ]) {
    const arr = root[arrKey];
    if (!Array.isArray(arr)) continue;
    for (const el of arr) {
      if (typeof el === 'string' && el.trim()) out.push(el.trim());
      else if (el && typeof el === 'object') {
        const t = pickTextFromHit(el as Record<string, unknown>);
        if (t) out.push(t);
      }
    }
    if (out.length) return [...new Set(out)];
  }

  for (const nest of ['data', 'result', 'response', 'search_result', 'search']) {
    const v = root[nest];
    if (Array.isArray(v)) {
      for (const el of v) {
        if (typeof el === 'string' && el.trim()) out.push(el.trim());
        else if (el && typeof el === 'object') {
          const t = pickTextFromHit(el as Record<string, unknown>);
          if (t) out.push(t);
        }
      }
      if (out.length) return [...new Set(out)];
    } else if (v && typeof v === 'object') {
      const inner = extractSnippetsFromSearchJson(v, depth + 1);
      if (inner.length) return inner;
    }
  }

  const choices = root.choices;
  if (Array.isArray(choices)) {
    for (const ch of choices) {
      if (!ch || typeof ch !== 'object') continue;
      const msg = (ch as Record<string, unknown>).message;
      if (msg && typeof msg === 'object') {
        const c = (msg as Record<string, unknown>).content;
        if (typeof c === 'string' && c.trim()) out.push(c.trim());
      }
    }
    if (out.length) return [...new Set(out)];
  }

  return out;
}

/** When Human Delta is configured but search returns no indexed hits (e.g. `{ "results": [] }`). */
export function buildHumanDeltaEmptyFallbackGuidance(places: PlaceCandidate[]): PlaceGuidanceRow[] {
  return places.map((p) => ({
    placeId: p.id,
    placeName: p.name,
    passages: [
      {
        source: 'human_delta_empty',
        text:
          `Human Delta search returned no indexed documents for "${p.name}" yet. Use Google place_id ${p.id} to find official menus or nutrition PDFs and add them to your Human Delta corpus. Until then: prefer grilled protein, salads with dressing on the side, vegetables, and water or unsweetened drinks; limit sugary sauces and large refined-starch portions.`,
      },
    ],
  }));
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
