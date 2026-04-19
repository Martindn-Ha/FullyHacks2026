import type { Severity, UserContext } from '../types.js';

export type RiskAssessment = {
  riskScore: number;
  severity: Severity;
  factors: string[];
};

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

export function assessSpikeRisk(context: UserContext): RiskAssessment {
  let score = 0.18;
  const factors: string[] = [];

  if (typeof context.recentGlucoseMgDl === 'number') {
    if (context.recentGlucoseMgDl >= 250) {
      score += 0.28;
      factors.push('Glucose is very high relative to typical post-meal targets.');
    } else if (context.recentGlucoseMgDl >= 180) {
      score += 0.18;
      factors.push('Glucose is elevated, which can increase post-meal variability.');
    } else if (context.recentGlucoseMgDl <= 70) {
      score += 0.12;
      factors.push('Glucose is on the low side; food choices may need extra caution.');
    }
  }

  if (context.glucoseTrend === 'rising') {
    score += 0.14;
    factors.push('Rising glucose trend increases near-term spike risk.');
  } else if (context.glucoseTrend === 'falling') {
    score -= 0.05;
    factors.push('Falling trend slightly reduces spike risk.');
  }

  if (typeof context.minutesSinceLastMeal === 'number') {
    if (context.minutesSinceLastMeal < 45) {
      score += 0.08;
      factors.push('Recent meal timing can overlap with absorption.');
    }
  }

  if (typeof context.lastMealCarbsG === 'number') {
    if (context.lastMealCarbsG >= 80) {
      score += 0.16;
      factors.push('A higher-carb recent meal increases spike risk.');
    } else if (context.lastMealCarbsG >= 45) {
      score += 0.08;
      factors.push('Moderate recent carbs add some spike risk.');
    }
  }

  if (context.medicationOnSchedule === false) {
    score += 0.1;
    factors.push('Medication timing adherence is uncertain, which can affect glucose stability.');
  }

  if (context.activityLevel === 'low') {
    score += 0.05;
    factors.push('Lower recent activity can reduce glucose uptake.');
  } else if (context.activityLevel === 'high') {
    score -= 0.04;
    factors.push('Higher activity can help blunt spikes.');
  }

  score = clamp01(score);

  let severity: Severity = 'low';
  if (score >= 0.62) severity = 'high';
  else if (score >= 0.38) severity = 'moderate';

  return { riskScore: score, severity, factors };
}
