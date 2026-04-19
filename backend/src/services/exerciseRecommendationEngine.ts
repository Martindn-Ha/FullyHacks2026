import type { Severity } from '../types.js';
import type { WeatherSnapshot } from './openMeteoClient.js';

export type ExerciseRecommendation = {
  title: string;
  minutes: number;
  intensity: 'low' | 'moderate';
  reason: string;
  indoorPreferred: boolean;
};

function weatherSummary(weather: WeatherSnapshot): string[] {
  const bits: string[] = [];
  if (typeof weather.apparentTemperatureC === 'number') {
    bits.push(`feels like ${Math.round(weather.apparentTemperatureC)}C`);
  } else if (typeof weather.temperatureC === 'number') {
    bits.push(`${Math.round(weather.temperatureC)}C`);
  }
  if (typeof weather.windSpeedKmh === 'number' && weather.windSpeedKmh >= 30) {
    bits.push('windy');
  }
  if (typeof weather.precipitationMm === 'number' && weather.precipitationMm > 0.2) {
    bits.push('wet');
  }
  return bits;
}

export function buildExerciseRecommendations(params: {
  severity: Severity;
  weather: WeatherSnapshot;
}): ExerciseRecommendation[] {
  const { severity, weather } = params;
  const t =
    typeof weather.apparentTemperatureC === 'number'
      ? weather.apparentTemperatureC
      : weather.temperatureC;
  const precip = typeof weather.precipitationMm === 'number' ? weather.precipitationMm : 0;
  const wind = typeof weather.windSpeedKmh === 'number' ? weather.windSpeedKmh : 0;
  const isStormyCode = weather.weatherCode != null && weather.weatherCode >= 95 && weather.weatherCode <= 99;
  const weatherRisky = isStormyCode || precip >= 2 || wind >= 35 || (typeof t === 'number' && (t >= 33 || t <= 0));
  const mostlyIndoor = weatherRisky || precip >= 0.6 || wind >= 25;
  const sevLowIntensity = severity === 'high';
  const summary = weatherSummary(weather).join(', ');

  const first: ExerciseRecommendation = mostlyIndoor
    ? {
        title: 'Indoor walk or easy cycling',
        minutes: sevLowIntensity ? 10 : 15,
        intensity: 'low',
        indoorPreferred: true,
        reason: `Conditions are less outdoor-friendly${summary ? ` (${summary})` : ''}; a short indoor cardio block is safer and consistent.`,
      }
    : {
        title: 'Outdoor brisk walk',
        minutes: sevLowIntensity ? 12 : 20,
        intensity: sevLowIntensity ? 'low' : 'moderate',
        indoorPreferred: false,
        reason: `Current weather supports an outdoor session${summary ? ` (${summary})` : ''}, which can help glucose uptake.`,
      };

  const second: ExerciseRecommendation = {
    title: sevLowIntensity ? 'Light mobility + breathing cooldown' : 'Bodyweight circuit (squats, wall push-ups, lunges)',
    minutes: sevLowIntensity ? 8 : 12,
    intensity: sevLowIntensity ? 'low' : 'moderate',
    indoorPreferred: true,
    reason:
      severity === 'high'
        ? 'Higher spike risk favors shorter, lower-intensity movement with symptom awareness.'
        : 'Moderate spike risk can benefit from a brief mixed movement block after a walk.',
  };

  return [first, second];
}
