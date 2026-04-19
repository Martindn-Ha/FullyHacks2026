import type { PlaceCandidate } from '../types.js';
import type { PlaceGuidanceRow } from './humanDeltaClient.js';
import { IntegrationError } from './integrationError.js';
import { isAbortOrTimeout } from '../utils/isAbortOrTimeout.js';

const GEMINI_TIMEOUT_MS = 60_000;
const MAX_CONTEXT_CHARS_PER_PLACE = 14_000;
/** Fewer venues per completion → model stays inside delimiter format and avoids MAX_TOKENS truncation. */
const DEFAULT_PLACES_PER_GEMINI_CALL = 4;
const MAX_OUTPUT_TOKENS = 8192;

function placesPerGeminiCall(): number {
  const raw = process.env.GEMINI_SYNTHESIS_PLACES_PER_CALL?.trim();
  if (!raw) return DEFAULT_PLACES_PER_GEMINI_CALL;
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_PLACES_PER_GEMINI_CALL;
  return Math.min(12, Math.max(1, Math.round(n)));
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** First line after PLACE_BEGIN may include quotes or a "place_id:" prefix from the model. */
function normalizePlaceIdLine(line: string): string {
  let s = line.trim().replace(/^["'`]+|["'`]+$/g, '');
  s = s.replace(/^[\[\]()]+|[\[\]()]+$/g, '');
  s = s.replace(/^place_?ids?\s*[:=]\s*/i, '').replace(/^id\s*[:=]\s*/i, '').trim();
  return s.replace(/[.,;:]+$/, '').trim();
}

/** Strip optional markdown fences if the model wraps the whole reply. */
function stripOuterCodeFence(text: string): string {
  const t = text.trim();
  if (t.startsWith('```')) {
    return t
      .replace(/^```[a-zA-Z0-9_-]*\s*/i, '')
      .replace(/\s*```$/s, '')
      .trim();
  }
  return t;
}

type ParsedBlock = { suggestedItem: string; explanation: string; nutritionInfo?: string };

/** Models sometimes echo "Line1 = …" from the prompt template; strip those labels. */
function stripPromptLineLabel(line: string, n: 1 | 2 | 3): string {
  return line.replace(new RegExp(`^line\\s*${n}\\s*=\\s*`, 'i'), '').trim();
}

function splitBlockBody(block: string): ParsedBlock | null {
  const lines = block.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const suggestedItem = stripPromptLineLabel(
    (lines[0] ?? block).replace(/^(order|pick)\s*:\s*/i, '').trim(),
    1,
  );
  if (!suggestedItem) return null;

  let nutritionInfo: string | undefined;
  let bodyLines = lines.slice(1);
  const line1Raw = bodyLines[0];
  const line1 = line1Raw ? stripPromptLineLabel(line1Raw, 2) : '';
  const nutMatch =
    line1.match(/^nutrition\s*[:—\-]\s*(.+)$/i) ??
    line1Raw?.match(/^line\s*2\s*=\s*nutrition\s*[:—\-]\s*(.+)$/i);
  if (nutMatch?.[1]) {
    nutritionInfo = nutMatch[1].trim();
    if (/^not\s+in\s+snippet\.?$/i.test(nutritionInfo)) {
      nutritionInfo = 'No Nutritional Info Found.';
    }
    bodyLines = bodyLines.slice(1);
  }

  if (bodyLines.length) {
    bodyLines[0] = stripPromptLineLabel(bodyLines[0], 3);
  }
  let explanation = bodyLines.join(' ').trim();
  if (!explanation) {
    if (nutritionInfo) {
      explanation = 'Concise pick for current spike risk; details above are only what appeared in CONTEXT.';
    } else {
      return null;
    }
  }

  const out: ParsedBlock = { suggestedItem, explanation };
  if (nutritionInfo) out.nutritionInfo = nutritionInfo;
  return out;
}

/**
 * Gemini returns plain prose per venue. Preferred shape:
 * PLACE_BEGIN
 * <place_id>
 * ...
 * PLACE_END
 * Also accepts PLACE_BEGIN <place_id> on one line (some models collapse newlines).
 */
/** When regex misses (wrong quotes, missing PLACE_END, merged lines), split on PLACE_BEGIN and read id from first line. */
function parseSegmentsForPlaceBlocks(text: string, wantIds: string[]): Map<string, ParsedBlock> {
  const want = new Set(wantIds);
  const out = new Map<string, ParsedBlock>();
  const parts = text.split(/\bPLACE_BEGIN\b/i);
  for (const part of parts) {
    let s = part.trim();
    if (!s) continue;
    s = s.replace(/\s*PLACE_END\s*$/i, '').trim();
    const lines = s.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2) continue;
    const idNorm = normalizePlaceIdLine(lines[0]);
    if (!want.has(idNorm)) continue;
    const body = lines.slice(1).join('\n');
    const parsed = splitBlockBody(body);
    if (parsed) out.set(idNorm, parsed);
  }
  return out;
}

function parsePlaceBlocks(raw: string, placeIds: string[]): Map<string, ParsedBlock> {
  const text = stripOuterCodeFence(raw);
  const out = new Map<string, ParsedBlock>();
  const esc = (id: string) => escapeRegExp(id);

  for (const id of placeIds) {
    const patterns: RegExp[] = [
      new RegExp(`PLACE_BEGIN\\s*\\r?\\n\\s*${esc(id)}\\s*\\r?\\n([\\s\\S]*?)\\s*PLACE_END`, 'i'),
      new RegExp(`PLACE_BEGIN\\s+${esc(id)}\\s*\\r?\\n([\\s\\S]*?)\\s*PLACE_END`, 'i'),
      new RegExp(`PLACE_BEGIN\\s*:\\s*${esc(id)}\\s*\\r?\\n([\\s\\S]*?)\\s*PLACE_END`, 'i'),
      new RegExp(
        `PLACE_BEGIN\\s*\\r?\\n\\s*place_id\\s*:\\s*${esc(id)}\\s*\\r?\\n([\\s\\S]*?)\\s*PLACE_END`,
        'i',
      ),
    ];
    for (const re of patterns) {
      const m = text.match(re);
      if (!m?.[1]) continue;
      const parsed = splitBlockBody(m[1].trim());
      if (parsed) {
        out.set(id, parsed);
        break;
      }
    }
  }

  const missing = placeIds.filter((id) => !out.has(id));
  if (missing.length) {
    for (const [id, block] of parseSegmentsForPlaceBlocks(text, missing)) {
      if (!out.has(id)) out.set(id, block);
    }
  }
  return out;
}

function fallbackPresentationFromRow(row: PlaceGuidanceRow): ParsedBlock {
  const primary = row.passages.map((p) => p.text).join('\n').trim();
  const firstLine =
    primary
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l.length > 0) ?? primary;
  const suggestedItem =
    firstLine.length > 0
      ? firstLine.slice(0, 140).trim() + (firstLine.length > 140 ? '…' : '')
      : 'No indexed menu text for this venue';
  return {
    suggestedItem,
    explanation:
      'Gemini did not return a parseable PLACE block; showing a verbatim excerpt from retrieved CONTEXT (not a generated menu item).',
    nutritionInfo: 'No Nutritional Info Found.',
  };
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

/**
 * Vertex Gemini `generateContent` — resource shape is
 * `projects/{project}/locations/{location}/publishers/google/models/{model}` (see
 * https://cloud.google.com/vertex-ai/generative-ai/docs/model-reference/inference ).
 *
 * REST hostname: `https://{location}-aiplatform.googleapis.com` for a region; for `global` use
 * `https://aiplatform.googleapis.com` (same pattern as Vertex client samples on that page).
 *
 * API key (express / dev): https://cloud.google.com/vertex-ai/generative-ai/docs/start/quickstart?usertype=apikey
 */
function vertexRestBaseUrl(locationRaw: string): string {
  const loc = locationRaw.trim().toLowerCase();
  if (!loc || loc === 'global') {
    return 'https://aiplatform.googleapis.com';
  }
  return `https://${encodeURIComponent(loc)}-aiplatform.googleapis.com`;
}

function buildGeminiGenerateContentUrl(params: {
  modelId: string;
  apiKey: string;
  useVertex: boolean;
  vertexProjectId?: string;
  vertexLocation?: string;
}): string {
  const { modelId, apiKey, useVertex, vertexProjectId, vertexLocation } = params;
  const key = encodeURIComponent(apiKey);
  const mid = encodeURIComponent(modelId);
  if (useVertex && vertexProjectId?.trim()) {
    const loc = (vertexLocation?.trim() || 'global').replace(/^\/+|\/+$/g, '');
    const base = vertexRestBaseUrl(loc);
    return `${base}/v1/projects/${encodeURIComponent(vertexProjectId.trim())}/locations/${encodeURIComponent(loc)}/publishers/google/models/${mid}:generateContent?key=${key}`;
  }
  if (useVertex) {
    return `https://aiplatform.googleapis.com/v1/publishers/google/models/${mid}:generateContent?key=${key}`;
  }
  return `https://generativelanguage.googleapis.com/v1beta/models/${mid}:generateContent?key=${key}`;
}

function buildSystemText(targetIds: string[]): string {
  return [
    'You help with a diabetes-hackathon demo. The user already has moderate or higher near-term post-meal spike risk.',
    'Be very concise. Recommend lower-glycemic-impact orders — not medical treatment.',
    'FOOD PICK RULE (per ### heading): If that heading’s CONTEXT is real retrieved menu or nutrition text (not the sentence that begins with "No indexed Human Delta"), the first line after place_id MUST name one specific food, beverage, side, or combo using wording that appears verbatim (or as a clear contiguous substring) in THAT heading’s CONTEXT only. Do not invent items, do not use generic patterns ("grilled protein", "large salad", "protein bowl") unless that exact phrase appears in that CONTEXT. If several items appear, choose the best lower-glycemic option that still satisfies the verbatim rule. If no discrete item name appears in CONTEXT (only headers/legal boilerplate), first line must be exactly: No named menu item in CONTEXT',
    'When CONTEXT is exactly the boilerplate that says there is no indexed Human Delta menu text for this venue, first line must be exactly: No indexed menu text for this venue',
    'When CONTEXT lists any nutrition numbers or labeled values (calories, carbohydrate/sugar/fiber/protein/fat/sodium/cholesterol, kcal, kJ, mg, g, %DV, or serving sizes), quote the most relevant ones briefly on the NUTRITION line. Never invent numbers; if CONTEXT truly has none of these, write exactly: NUTRITION: No Nutritional Info Found.',
    'Do not diagnose or prescribe.',
    'Plain text only (no JSON). One block per venue using PLACE_BEGIN and PLACE_END (all caps).',
    'Exact shape — three lines after place_id, no blank lines inside the block. Do NOT prefix lines with Line1, Line2, or Line3.',
    'PLACE_BEGIN',
    '<exact place_id from ### heading>',
    'First line: see FOOD PICK RULE above (max ~14 words unless the CONTEXT name is longer — then truncate with an ellipsis).',
    'Second line: NUTRITION: <brief facts from CONTEXT only, or "No Nutritional Info Found.">',
    'Third line: one sentence only (~25 words max) on why this order helps spike risk.',
    'PLACE_END',
    `Include one block per place_id: ${targetIds.join(', ')}.`,
  ].join(' ');
}

/** Dev-only placeholder when Human Delta URL is unset — not real retrieval. */
const SKIP_CONTEXT_SOURCES = new Set(['google_test_placeholder']);

function buildUserBlocks(placeById: Map<string, PlaceCandidate>, rows: PlaceGuidanceRow[]): {
  blocks: string[];
  targetIds: string[];
} {
  const blocks: string[] = [];
  const targetIds: string[] = [];
  for (const row of rows) {
    const contextPassages = row.passages.filter((p) => !SKIP_CONTEXT_SOURCES.has(p.source) && p.text.trim());
    const hasRetrievalContext = contextPassages.length > 0;
    const place = placeById.get(row.placeId);
    targetIds.push(row.placeId);
    if (hasRetrievalContext) {
      const retrieval = contextPassages
        .map((p) => p.text)
        .join('\n---\n')
        .slice(0, MAX_CONTEXT_CHARS_PER_PLACE);
      blocks.push(
        `### ${place?.name ?? row.placeName} (place_id: ${row.placeId})\nCONTEXT:\n${retrieval}`,
      );
    } else {
      blocks.push(
        `### ${place?.name ?? row.placeName} (place_id: ${row.placeId})\nCONTEXT:\n(No indexed Human Delta menu text for this venue. Do not invent menu items. Follow the system rule for this CONTEXT: use the required first-line boilerplate, NUTRITION: No Nutritional Info Found., then a short generic spike-risk rationale only.)`,
      );
    }
  }
  return { blocks, targetIds };
}

async function geminiGeneratePartText(params: {
  url: string;
  backend: string;
  systemText: string;
  userText: string;
  temperature?: number;
}): Promise<{ text: string; finishReason?: string }> {
  const { url, backend, systemText, userText, temperature } = params;
  const temp = typeof temperature === 'number' && Number.isFinite(temperature) ? temperature : 0.35;
  let rawText: string;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemText }] },
        contents: [{ role: 'user', parts: [{ text: userText }] }],
        generationConfig: {
          temperature: temp,
          maxOutputTokens: MAX_OUTPUT_TOKENS,
        },
      }),
      signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
    });
    rawText = await res.text();
    if (!res.ok) {
      throw new IntegrationError(
        `Gemini (${backend}) HTTP ${res.status}: ${rawText.slice(0, 900)}`,
        502,
      );
    }
  } catch (e) {
    if (e instanceof IntegrationError) throw e;
    if (isAbortOrTimeout(e)) {
      throw new IntegrationError(
        `Gemini (${backend}) timed out after ${GEMINI_TIMEOUT_MS / 1000}s.`,
        504,
      );
    }
    throw new IntegrationError(
      `Gemini (${backend}) request failed: ${e instanceof Error ? e.message : String(e)}`,
      502,
    );
  }

  try {
    const outer = JSON.parse(rawText) as {
      candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
      error?: { message?: string };
    };
    if (outer.error?.message) {
      throw new IntegrationError(`Gemini (${backend}) API error: ${outer.error.message}`, 502);
    }
    const cand = outer.candidates?.[0];
    const fr = cand?.finishReason;
    if (fr && fr !== 'STOP' && fr !== 'FINISH_REASON_STOP') {
      console.warn(`[llmGuidanceSynthesis] Gemini finishReason=${fr} (may be truncated)`);
    }
    const t = cand?.content?.parts?.[0]?.text;
    if (!t) {
      throw new IntegrationError(
        `Gemini (${backend}) returned no text (check model id, billing, and API enablement).`,
        502,
      );
    }
    return { text: t, finishReason: fr };
  } catch (e) {
    if (e instanceof IntegrationError) throw e;
    throw new IntegrationError(
      `Gemini (${backend}) response was not valid generateContent JSON: ${e instanceof Error ? e.message : String(e)}`,
      502,
    );
  }
}

async function synthesizeMapForRows(params: {
  url: string;
  backend: string;
  placeById: Map<string, PlaceCandidate>;
  rows: PlaceGuidanceRow[];
  riskLine: string;
  temperature?: number;
  userSuffix?: string;
}): Promise<Map<string, ParsedBlock>> {
  const { url, backend, placeById, rows, riskLine, temperature, userSuffix } = params;
  if (rows.length === 0) {
    return new Map();
  }
  const { blocks, targetIds } = buildUserBlocks(placeById, rows);
  const systemText = buildSystemText(targetIds);
  const baseUser = [
    `The user’s spike-risk estimate (for tone and prioritization): ${riskLine}`,
    'This request is only sent when the app’s rules flagged at least moderate near-term spike risk.',
    '',
    blocks.join('\n\n'),
  ].join('\n');
  const suf = (userSuffix ?? '').trim();
  const userText = suf ? `${baseUser}\n\n${suf}` : baseUser;

  const { text } = await geminiGeneratePartText({
    url,
    backend,
    systemText,
    userText,
    temperature,
  });
  return parsePlaceBlocks(text, targetIds);
}

/**
 * **Required** for `/api/recommendations` when spike risk is moderate+ and there are nearby places:
 * chunked `generateContent` calls so each venue gets `llmPresentation` from plain PLACE_BEGIN/PLACE_END blocks.
 * Large venue lists are sharded (default 4 per call) to avoid truncation and delimiter drift.
 */
export async function synthesizeGuidanceWithGemini(params: {
  apiKey: string;
  model?: string;
  useVertex?: boolean;
  vertexProjectId?: string;
  vertexLocation?: string;
  places: PlaceCandidate[];
  guidance: PlaceGuidanceRow[];
  riskLine: string;
}): Promise<PlaceGuidanceRow[]> {
  const { apiKey, model, useVertex, vertexProjectId, vertexLocation, places, guidance, riskLine } = params;
  const key = apiKey.trim();
  if (!key) {
    throw new IntegrationError(
      'VERTEX_GEMINI_API_KEY (or legacy GEMINI_API_KEY / GOOGLE_API_KEY) is required.',
      503,
    );
  }

  if (guidance.length === 0) {
    throw new IntegrationError('Guidance rows were empty; cannot call Gemini.', 502);
  }

  const placeById = new Map(places.map((p) => [p.id, p]));
  const modelId = (model?.trim() || 'gemini-2.5-flash').replace(/^models\//, '');
  const url = buildGeminiGenerateContentUrl({
    modelId,
    apiKey: key,
    useVertex: Boolean(useVertex),
    vertexProjectId,
    vertexLocation,
  });
  const backend = useVertex ? 'vertex' : 'google_ai';
  const shardSize = placesPerGeminiCall();
  const chunks = chunkArray(guidance, shardSize);

  const mergedMap = new Map<string, ParsedBlock>();
  const chunkResults = await Promise.all(
    chunks.map((rows) => synthesizeMapForRows({ url, backend, placeById, rows, riskLine })),
  );
  for (const m of chunkResults) {
    for (const [k, v] of m) {
      mergedMap.set(k, v);
    }
  }

  let missing = guidance.map((r) => r.placeId).filter((id) => !mergedMap.has(id));

  if (missing.length) {
    console.warn(
      `[llmGuidanceSynthesis] after ${chunks.length} shard(s) of up to ${shardSize}, missing ${missing.length} place(s); retrying one venue per request in parallel.`,
    );
    const retryRows = missing
      .map((placeId) => guidance.find((g) => g.placeId === placeId))
      .filter((r): r is PlaceGuidanceRow => Boolean(r));
    const retryMaps = await Promise.all(
      retryRows.map((row) =>
        synthesizeMapForRows({ url, backend, placeById, rows: [row], riskLine }),
      ),
    );
    for (const m of retryMaps) {
      for (const [k, v] of m) {
        mergedMap.set(k, v);
      }
    }
    missing = guidance.map((r) => r.placeId).filter((id) => !mergedMap.has(id));
  }

  if (missing.length) {
    console.warn(
      `[llmGuidanceSynthesis] still missing ${missing.length} place(s); sequential low-temperature retries with strict place_id line.`,
    );
    for (const placeId of missing) {
      const row = guidance.find((g) => g.placeId === placeId);
      if (!row) continue;
      const one = await synthesizeMapForRows({
        url,
        backend,
        placeById,
        rows: [row],
        riskLine,
        temperature: 0.1,
        userSuffix: `STRICT FORMAT: After PLACE_BEGIN, the next line must be EXACTLY this place_id and nothing else:\n${placeId}\nThen three lines: (1) first line must name a food using wording copied from that venue's CONTEXT only, (2) NUTRITION: ..., (3) one rationale sentence. Then PLACE_END.`,
      });
      for (const [k, v] of one) {
        mergedMap.set(k, v);
      }
    }
    missing = guidance.map((r) => r.placeId).filter((id) => !mergedMap.has(id));
  }

  if (missing.length) {
    console.warn(
      `[llmGuidanceSynthesis] applying keyword fallbacks for ${missing.length} place_id(s) (Gemini blocks still unparseable): ${missing.join(', ')}`,
    );
    for (const placeId of missing) {
      const row = guidance.find((g) => g.placeId === placeId);
      if (row) mergedMap.set(placeId, fallbackPresentationFromRow(row));
    }
    missing = guidance.map((r) => r.placeId).filter((id) => !mergedMap.has(id));
  }

  if (missing.length) {
    throw new IntegrationError(
      `Gemini (${backend}) plain text was missing a valid PLACE_BEGIN … PLACE_END block for place_id(s): ${missing.join(', ')}.`,
      502,
    );
  }

  return guidance.map((row) => {
    const it = mergedMap.get(row.placeId)!;
    return {
      ...row,
      llmPresentation: {
        suggestedItem: it.suggestedItem,
        explanation: it.explanation,
        ...(it.nutritionInfo ? { nutritionInfo: it.nutritionInfo } : {}),
      },
    };
  });
}
