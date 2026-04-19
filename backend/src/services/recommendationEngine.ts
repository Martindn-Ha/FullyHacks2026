import type { FoodRecommendation, PlaceCandidate, Severity } from '../types.js';
import type { PlaceGuidanceRow } from './humanDeltaClient.js';
import { IntegrationError } from './integrationError.js';

function pickSuggestedItem(passageText: string, placeName: string): string {
  const t = passageText.toLowerCase();
  if (t.includes('bowl')) return 'Protein-forward bowl with extra vegetables (sauce on the side)';
  if (t.includes('salad')) return 'Large salad with grilled protein and dressing on the side';
  if (t.includes('grilled')) return 'Grilled protein plate with a non-starchy side';
  if (t.includes('soup')) return 'Broth-based soup with a side salad';
  return `A simpler plate at ${placeName} focused on protein and vegetables`;
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
    const suggestedItem = pickSuggestedItem(primary, place.name);
    const src = g.passages[0].source;
    const groundedNote =
      src === 'human_delta'
        ? 'Grounded by indexed menu guidance (Human Delta).'
        : 'Human Delta disabled: generic meal-pattern hint only (Google testing). Not indexed menu data.';

    candidates.push({
      place,
      suggestedItem,
      explanation: buildExplanation({ severity, distanceM: place.distanceM, passageText: passageText || primary }),
      groundedNote,
      score: scoreOption({ distanceM: place.distanceM, severity, passageText: passageText || primary }),
    });
  }

  return candidates.sort((a, b) => b.score - a.score).slice(0, 3);
}
