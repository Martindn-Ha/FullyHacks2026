import type { FoodRecommendation, PlaceCandidate, Severity } from '../types.js';
import type { PlaceGuidanceRow } from './humanDeltaClient.js';
import { IntegrationError } from './integrationError.js';

/** When Gemini did not return llmPresentation: anchor the pick line to retrieved text, not invented menu patterns. */
function pickSuggestedItemFromPassages(passageText: string, placeName: string): string {
  const first =
    passageText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l.length > 0) ?? passageText.trim();
  if (first.length > 0) {
    return first.slice(0, 140).trim() + (first.length > 140 ? '…' : '');
  }
  return `No indexed menu text for ${placeName}`;
}

function scoreOption(params: {
  distanceM: number;
  severity: Severity;
  passageText: string;
}): number {
  const distanceScore = 1 / (1 + params.distanceM / 250);
  const carbPenalty =
    /\b(fries|soda|sweet|sugar|dessert|milkshake)\b/i.test(params.passageText) ? 0.12 : 0;
  const veggieBoost =
    /\b(vegetable|veggie|salad|grilled|broth)\b/i.test(params.passageText) ? 0.08 : 0;
  const severityWeight = params.severity === 'high' ? 1.15 : params.severity === 'moderate' ? 1.05 : 1;
  return severityWeight * (0.55 * distanceScore + 0.45 * (1 - carbPenalty + veggieBoost));
}

function buildExplanation(params: {
  severity: Severity;
  distanceM: number;
  passageText: string;
}): string {
  const sev =
    params.severity === 'high'
      ? 'Higher near-term spike risk'
      : params.severity === 'moderate'
        ? 'Moderate spike risk'
        : 'Lower spike risk';
  return `${sev}. This pick is a practical, lower-glycemic-style option near you (~${params.distanceM}m). Guidance excerpt: ${params.passageText.slice(0, 220)}${params.passageText.length > 220 ? '…' : ''}`;
}

export function rankFoodRecommendations(params: {
  places: PlaceCandidate[];
  guidance: PlaceGuidanceRow[];
  severity: Severity;
}): FoodRecommendation[] {
  const { places, guidance, severity } = params;
  const gMap = new Map(guidance.map((g) => [g.placeId, g]));

  const candidates: FoodRecommendation[] = [];

  for (const place of places) {
    const g = gMap.get(place.id);
    if (!g || !g.passages[0]?.text) {
      throw new IntegrationError(
        `Missing Human Delta guidance for place "${place.name}" (${place.id}).`,
        502,
      );
    }
    const passageText = g.passages.map((p) => p.text).join(' ').trim();
    const primary = g.passages[0].text;
    const suggestedItem =
      g.llmPresentation?.suggestedItem ?? pickSuggestedItemFromPassages(passageText, place.name);
    const src = g.passages[0].source;
    const passageTextForScore =
      [
        passageText,
        g.llmPresentation?.explanation ?? '',
        g.llmPresentation?.nutritionInfo ?? '',
      ]
        .join(' ')
        .trim() || primary;
    const groundedNote = g.llmPresentation
      ? undefined
      : src === 'human_delta'
        ? 'Grounded by indexed menu snippets when available.'
        : src === 'human_delta_empty'
          ? 'No indexed menu matches for this query; generic meal-pattern hints only.'
          : 'Generic meal-pattern hint only (no indexed menu data for this venue).';

    candidates.push({
      place,
      suggestedItem,
      explanation: g.llmPresentation
        ? g.llmPresentation.explanation.trim()
        : buildExplanation({ severity, distanceM: place.distanceM, passageText: passageText || primary }),
      ...(g.llmPresentation?.nutritionInfo?.trim()
        ? { nutritionInfo: g.llmPresentation.nutritionInfo.trim() }
        : {}),
      ...(groundedNote ? { groundedNote } : {}),
      score: scoreOption({ distanceM: place.distanceM, severity, passageText: passageTextForScore }),
    });
  }

  return candidates
    .sort((a, b) => {
      const d = a.place.distanceM - b.place.distanceM;
      if (d !== 0) return d;
      return b.score - a.score;
    })
    .slice(0, 3);
}
