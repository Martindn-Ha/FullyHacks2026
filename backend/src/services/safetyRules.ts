const URGENT_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /\bfaint(ing|ed)?\b/i, label: 'fainting or near-fainting' },
  { pattern: /\bconfus(ed|ion)\b/i, label: 'confusion' },
  { pattern: /\bsevere\s+dizziness\b/i, label: 'severe dizziness' },
  { pattern: /\bloss of consciousness\b/i, label: 'loss of consciousness' },
  { pattern: /\bunresponsive\b/i, label: 'unresponsiveness' },
];

export type SafetyEvaluation = {
  escalate: boolean;
  suppressFoodRecommendations: boolean;
  message?: string;
  matchedSignals: string[];
};

export function evaluateSafety(symptoms: string[]): SafetyEvaluation {
  const text = symptoms.join(' ').toLowerCase();
  const matchedSignals = URGENT_PATTERNS.filter((u) => u.pattern.test(text)).map(
    (u) => u.label,
  );

  if (matchedSignals.length > 0) {
    return {
      escalate: true,
      suppressFoodRecommendations: true,
      message:
        'Urgent symptoms were reported. Skip meal planning for now and seek emergency care if symptoms are severe, sudden, or worsening. This app does not provide medical diagnosis.',
      matchedSignals,
    };
  }

  return {
    escalate: false,
    suppressFoodRecommendations: false,
    matchedSignals: [],
  };
}
