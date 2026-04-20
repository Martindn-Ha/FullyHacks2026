import type { MenuPassage, PlaceCandidate } from '../types.js';
import { isAbortOrTimeout } from '../utils/isAbortOrTimeout.js';
import { IntegrationError } from './integrationError.js';

const HUMAN_DELTA_FETCH_TIMEOUT_MS = 90_000;

/**
 * Optional fields for official `POST /v1/search` (see repo `Human_delta_rest_api.txt`):
 * `top_k`, `sources`, `index_id`. Gemini is not called by Human Delta — you retrieve here, then pass
 * chunks into Vertex/Gemini in `synthesizeGuidanceWithGemini`.
 */
/**
 * Human Delta `POST /v1/search`: `sources` selects corpora; `index_id` scopes a **website crawl** index
 * (see Human_delta_rest_api.txt). Sending `index_id` while also searching `documents` can pin or dilute
 * results against an empty crawl — omit `index_id` whenever `documents` is in `sources`.
 */
function officialSearchBodyFromEnv(): {
  top_k: number;
  sources: string[];
  index_id?: string;
} {
  const out: { top_k: number; sources: string[]; index_id?: string } = {
    top_k: 10,
    /** Explicit default: both corpora (API says omit = both; explicit avoids “web-only” misconfig). */
    sources: ['documents', 'web'],
  };
  const tk = process.env.HUMAN_DELTA_TOP_K?.trim();
  if (tk) {
    const n = Number(tk);
    if (Number.isFinite(n)) {
      out.top_k = Math.min(20, Math.max(1, Math.round(n)));
    }
  }

  const src = process.env.HUMAN_DELTA_SOURCES?.trim();
  if (src) {
    let parsed: string[] | null = null;
    if (src.startsWith('[')) {
      try {
        const j = JSON.parse(src) as unknown;
        if (Array.isArray(j) && j.every((x) => typeof x === 'string')) {
          parsed = (j as string[]).map((s) => s.trim()).filter(Boolean);
        }
      } catch {
        /* ignore invalid JSON */
      }
    }
    if (!parsed?.length) {
      parsed = src.split(',').map((s) => s.trim()).filter(Boolean);
    }
    if (parsed.length) {
      out.sources = parsed;
    }
  }

  const iid = process.env.HUMAN_DELTA_INDEX_ID?.trim();
  const srcLower = out.sources.map((s) => s.toLowerCase());
  const wantsWeb = srcLower.includes('web');
  const wantsDocuments = srcLower.includes('documents');
  /** Crawl index id only when searching web alone (uploads-only / docs+web should not bind to a crawl index). */
  if (iid && wantsWeb && !wantsDocuments) {
    out.index_id = iid;
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
  /** Calories/macros from CONTEXT only when present; otherwise omitted or “No Nutritional Info Found.” */
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
        sources: hdSearch.sources,
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
    if (res.status === 401 || res.status === 403) {
      console.warn(
        `[humanDeltaClient] Human Delta HTTP ${res.status} (auth). ${rawText.slice(0, 200)} — using generic venue guidance. Fix HUMAN_DELTA_API_KEY or clear HUMAN_DELTA_API_URL to skip Human Delta.`,
      );
      return buildInvalidHumanDeltaKeyFallback(places);
    }
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
      parsed = buildRowsFromGenericSnippets(places, snippets);
      const withHd = parsed.filter((r) => r.passages.some((x) => x.source === 'human_delta')).length;
      if (withHd < places.length) {
        console.warn(
          `[humanDeltaClient] Generic HD response: bound snippets to ${withHd}/${places.length} venues by name match; others use venue-specific empty guidance (no cross-venue menu reuse).`,
        );
      }
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

/**
 * One pooled Human Delta response often contains multiple paragraphs; split so we can route
 * "Juice It Up" text to that venue only instead of pasting the whole pool onto every `place_id`.
 */
const SNIPPET_PART_MIN = 4;
const LONG_SNIPPET_SPLIT = 900;

function splitPooledSearchSnippets(snippets: string[]): string[] {
  const out: string[] = [];
  for (const sn of snippets) {
    const raw = sn.trim();
    if (!raw.length) continue;

    const parts = raw
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .filter((p) => p.length > SNIPPET_PART_MIN);
    if (parts.length > 1) {
      for (const p of parts) out.push(p);
      continue;
    }

    if (raw.length > LONG_SNIPPET_SPLIT) {
      const lines = raw
        .split(/\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > SNIPPET_PART_MIN);
      if (lines.length >= 4) {
        for (const line of lines) out.push(line);
        continue;
      }
    }
    out.push(raw);
  }
  return [...new Set(out)];
}

/**
 * True if this chunk plausibly refers to the same brand as `place` (Google `name` / vicinity).
 * Prevents one chain's nutrition PDF from becoming CONTEXT for unrelated nearby results.
 */
/** Normalize quotes so "Carl's" / Carls / PDF unicode apostrophes still align. */
function normalizeForBrandMatch(t: string): string {
  return t
    .toLowerCase()
    .replace(/[''’`´]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extra tokens / regexes for chains where Google `displayName` and nutrition PDF headings differ.
 */
function snippetBrandSignals(placeName: string): { needles: string[]; regexes: RegExp[] } {
  const needles: string[] = [];
  const regexes: RegExp[] = [];
  const n = placeName.toLowerCase();

  const looksCarls =
    /\bcarl'?s?\b/i.test(placeName) || /\bcarls\b/i.test(placeName) || /\bcarl\s+j/i.test(placeName);
  if (looksCarls) {
    needles.push('carls');
    regexes.push(/\bcarls?\b/i, /\bcarl\s*'?s?\s*j/i, /\bcke\b/i);
  }
  if (n.includes('in-n-out') || n.includes('in n out')) {
    needles.push('in-n-out', 'innout', 'in n out');
    regexes.push(/\bin-?n-?out\b/i);
  }

  return { needles, regexes };
}

function snippetMentionsVenue(snippet: string, place: PlaceCandidate): boolean {
  const s = snippet.toLowerCase();
  const normalizedSnippet = normalizeForBrandMatch(snippet);
  const brand = normalizeForBrandMatch(place.name);
  if (brand.length >= 5 && normalizedSnippet.includes(brand)) return true;

  const tokens = brand.split(/[^a-z0-9]+/).filter((t) => t.length > 0);
  for (const t of tokens) {
    if (t.length >= 4 && s.includes(t)) return true;
  }

  const { needles, regexes } = snippetBrandSignals(place.name);
  for (const nd of needles) {
    if (nd.length >= 4 && s.includes(nd)) return true;
  }
  for (const re of regexes) {
    if (re.test(snippet)) return true;
  }

  const vic = place.vicinity?.toLowerCase().replace(/[''’`]/g, '').trim();
  if (vic && vic.length >= 5 && s.includes(vic)) {
    for (const t of tokens) {
      if (t.length >= 4 && s.includes(t)) return true;
    }
    for (const nd of needles) {
      if (nd.length >= 4 && s.includes(nd)) return true;
    }
  }
  return false;
}

/** Strength of association between one chunk and a venue (0 = no signal). */
function scoreChunkForPlace(chunk: string, place: PlaceCandidate): number {
  const s = chunk.toLowerCase();
  let score = 0;
  const brand = normalizeForBrandMatch(place.name);
  if (brand.length >= 5 && normalizeForBrandMatch(chunk).includes(brand)) score += 50;

  const tokens = brand.split(/[^a-z0-9]+/).filter((t) => t.length >= 4);
  for (const t of tokens) {
    if (s.includes(t)) score += Math.min(24, t.length + 4);
  }
  const { needles, regexes } = snippetBrandSignals(place.name);
  for (const nd of needles) {
    if (nd.length >= 4 && s.includes(nd)) score += 18;
  }
  for (const re of regexes) {
    if (re.test(chunk)) score += 18;
  }
  return score;
}

function buildRowsFromGenericSnippets(places: PlaceCandidate[], snippets: string[]): PlaceGuidanceRow[] {
  const pooled = snippets.join('\n\n').trim();
  const chunks = splitPooledSearchSnippets(snippets);
  const workChunks = chunks.length ? chunks : pooled ? [pooled] : [];

  const strictRows = places.map((p) => {
    let rel = workChunks.filter((c) => snippetMentionsVenue(c, p));
    if (!rel.length && pooled.length > 0 && snippetMentionsVenue(pooled, p)) {
      rel = [pooled];
    }
    return { p, rel };
  });

  const anyStrict = strictRows.some(({ rel }) => rel.length > 0);
  if (!anyStrict && workChunks.length > 0) {
    console.warn(
      '[humanDeltaClient] No strict venue name match on any chunk; assigning each chunk to the strongest-scoring venue (nutrition tables often omit the brand on every line).',
    );
    const byId = new Map<string, string[]>(places.map((pl) => [pl.id, [] as string[]]));
    for (const ch of workChunks) {
      let best: { place: PlaceCandidate; score: number } | null = null;
      for (const pl of places) {
        const sc = scoreChunkForPlace(ch, pl);
        if (sc <= 0) continue;
        if (
          !best ||
          sc > best.score ||
          (sc === best.score && pl.distanceM < best.place.distanceM)
        ) {
          best = { place: pl, score: sc };
        }
      }
      if (best) byId.get(best.place.id)!.push(ch);
    }
    return places.map((p) => {
      const rel = byId.get(p.id) ?? [];
      if (rel.length) {
        return {
          placeId: p.id,
          placeName: p.name,
          passages: [{ text: rel.slice(0, 20).join('\n\n'), source: 'human_delta' as const }],
        };
      }
      return {
        placeId: p.id,
        placeName: p.name,
        passages: [
          {
            source: 'human_delta_empty' as const,
            text: `Human Delta returned search text, but no chunk clearly matched "${p.name}" (place_id ${p.id}). Another venue's menu text was not reused. Add or improve indexed content that names this brand so vector search can bind chunks to this location.`,
          },
        ],
      };
    });
  }

  return strictRows.map(({ p, rel }) => {
    if (rel.length) {
      return {
        placeId: p.id,
        placeName: p.name,
        passages: [{ text: rel.slice(0, 20).join('\n\n'), source: 'human_delta' as const }],
      };
    }
    return {
      placeId: p.id,
      placeName: p.name,
      passages: [
        {
          source: 'human_delta_empty' as const,
          text: `Human Delta returned search text, but no chunk clearly matched "${p.name}" (place_id ${p.id}). Another venue's menu text was not reused. Add or improve indexed content that names this brand so vector search can bind chunks to this location.`,
        },
      ],
    };
  });
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

/** When Human Delta rejects the key: same shape as placeholder so Gemini + ranking still run. */
export function buildInvalidHumanDeltaKeyFallback(places: PlaceCandidate[]): PlaceGuidanceRow[] {
  return places.map((p) => ({
    placeId: p.id,
    placeName: p.name,
    passages: [
      {
        source: 'human_delta_key_invalid',
        text:
          `Human Delta rejected the API key (invalid or revoked). For "${p.name}", prefer grilled protein, salads with dressing on the side, vegetables, and unsweetened drinks; limit sugary sauces and large refined-starch portions.`,
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

/**
 * Vector search without Google `places` binding — for example ADA / diabetes.org content indexed under
 * `HUMAN_DELTA_INDEX_ID` when `HUMAN_DELTA_SOURCES` is web-only (same env as `retrieveMenuGuidance`).
 */
export async function searchHumanDeltaTextPassages(params: {
  query: string;
  apiUrl?: string;
  apiKey?: string;
}): Promise<string[]> {
  const { query, apiUrl, apiKey } = params;
  const q = query.trim();
  if (!q || !apiUrl?.trim()) {
    return [];
  }

  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (apiKey?.trim()) {
    headers.authorization = `Bearer ${apiKey.trim()}`;
  }

  const url = apiUrl.trim();
  if (!isHumanDeltaOfficialSearchUrl(url)) {
    console.warn(
      '[humanDeltaClient] searchHumanDeltaTextPassages: URL is not official POST /v1/search; skipping retrieval.',
    );
    return [];
  }

  const hdSearch = officialSearchBodyFromEnv();
  const crawlIndexId = process.env.HUMAN_DELTA_INDEX_ID?.trim();
  const srcLower = hdSearch.sources.map((s) => s.toLowerCase());
  const wantsWeb = srcLower.includes('web');
  let sources = [...hdSearch.sources];
  let index_id = hdSearch.index_id;
  /**
   * `officialSearchBodyFromEnv` only sets `index_id` for web-only `sources` (see comment there: avoids
   * menu-search pitfalls when `documents` is included). SMS check-in retrieval still needs the crawled
   * website index when `HUMAN_DELTA_INDEX_ID` is set — otherwise passages never come from that index.
   */
  if (crawlIndexId && wantsWeb && !index_id) {
    sources = ['web'];
    index_id = crawlIndexId;
    console.info(
      '[humanDeltaClient] searchHumanDeltaTextPassages: using web + HUMAN_DELTA_INDEX_ID for SMS retrieval (documents corpus omitted on this request).',
    );
  }

  const body = {
    query: q,
    top_k: Math.min(20, Math.max(4, hdSearch.top_k + 4)),
    sources,
    ...(index_id ? { index_id } : {}),
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
      console.warn(
        `[humanDeltaClient] searchHumanDeltaTextPassages: timed out after ${HUMAN_DELTA_FETCH_TIMEOUT_MS / 1000}s.`,
      );
      return [];
    }
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[humanDeltaClient] searchHumanDeltaTextPassages: request failed: ${msg}`);
    return [];
  }

  const rawText = await res.text();
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      console.warn(
        `[humanDeltaClient] searchHumanDeltaTextPassages: HTTP ${res.status} (auth). ${rawText.slice(0, 200)}`,
      );
      return [];
    }
    console.warn(`[humanDeltaClient] searchHumanDeltaTextPassages: HTTP ${res.status}: ${rawText.slice(0, 400)}`);
    return [];
  }

  let json: unknown;
  try {
    json = JSON.parse(rawText) as unknown;
  } catch {
    return [];
  }

  const snippets = extractSnippetsFromSearchJson(json);
  const out = [...new Set(snippets.map((s) => s.trim()).filter(Boolean))];
  return out.slice(0, 14);
}
