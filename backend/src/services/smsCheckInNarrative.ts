import { searchHumanDeltaTextPassages } from './humanDeltaClient.js';
import { synthesizeSmsCheckInNarrative } from './llmGuidanceSynthesis.js';

export type RecentSpikeEventInput = {
  atMs: number;
  glucoseMgDl: number;
  latitude: number | null;
  longitude: number | null;
};

export type ComposeSmsCheckInParams = {
  symptoms: string[];
  templateFields: Record<string, string>;
  messageTemplate?: string;
  recentSpikeEvents: RecentSpikeEventInput[];
  humanDeltaApiUrl?: string;
  humanDeltaApiKey?: string;
  vertexGeminiApiKey: string;
  geminiModel?: string;
  geminiUseVertex: boolean;
  vertexProjectId?: string;
  vertexLocation?: string;
};

function buildHumanDeltaQuery(symptoms: string[], templateFields: Record<string, string>): string {
  const glucose = templateFields.glucose?.trim() ?? '';
  const trend = templateFields.trend?.trim() ?? '';
  const parts: string[] = [
    ...symptoms.map((s) => s.trim()).filter(Boolean),
    glucose ? `blood glucose ${glucose} mg/dL` : '',
    trend ? `glucose trend ${trend}` : '',
    'diabetes hypoglycemia hyperglycemia symptoms emergency when to get help',
  ];
  return parts.filter(Boolean).join('. ').slice(0, 900);
}

/**
 * Human Delta (often ADA / diabetes.org web index) + Gemini → one SMS body.
 */
export async function composeSmsCheckInMessage(p: ComposeSmsCheckInParams): Promise<{
  message: string;
  humanDeltaPassageCount: number;
}> {
  const hdQuery = buildHumanDeltaQuery(p.symptoms, p.templateFields);
  const passages = await searchHumanDeltaTextPassages({
    query: hdQuery,
    apiUrl: p.humanDeltaApiUrl,
    apiKey: p.humanDeltaApiKey,
  });
  const retrieval = passages.join('\n\n---\n\n');

  const recentLines =
    p.recentSpikeEvents.length === 0
      ? '(none)'
      : p.recentSpikeEvents
          .slice(0, 8)
          .map((e, i) => {
            const t = new Date(e.atMs).toISOString();
            const loc =
              e.latitude != null && e.longitude != null
                ? ` @ ${Number(e.latitude).toFixed(4)},${Number(e.longitude).toFixed(4)}`
                : '';
            return `${i + 1}. ${t}: ${e.glucoseMgDl} mg/dL${loc}`;
          })
          .join('\n');

  const tpl = (p.messageTemplate ?? '').trim();
  const userBlock = [
    'Preset message template (reference only — rewrite as one cohesive SMS; do not echo raw placeholder syntax):',
    tpl ? tpl.slice(0, 4000) : '(default Tide Together template on device)',
    '',
    'Structured fields (must be reflected in natural language):',
    ...Object.entries(p.templateFields).map(([k, v]) => `- ${k}: ${v}`),
    '',
    'Reported symptoms (may be empty):',
    p.symptoms.length ? p.symptoms.map((s) => `- ${s}`).join('\n') : '(none selected)',
    '',
    'Recent glucose spike events (newest-first; may be empty):',
    recentLines,
  ].join('\n');

  const message = await synthesizeSmsCheckInNarrative({
    apiKey: p.vertexGeminiApiKey,
    model: p.geminiModel,
    useVertex: p.geminiUseVertex,
    vertexProjectId: p.vertexProjectId,
    vertexLocation: p.vertexLocation,
    retrievedContext: retrieval,
    userBlock,
  });

  return { message, humanDeltaPassageCount: passages.length };
}
