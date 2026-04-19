import { isAbortOrTimeout } from '../utils/isAbortOrTimeout.js';
import { IntegrationError } from './integrationError.js';

const OPEN_METEO_TIMEOUT_MS = 15_000;
const OPEN_METEO_FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';

type OpenMeteoCurrent = {
  temperature_2m?: number;
  apparent_temperature?: number;
  precipitation?: number;
  weather_code?: number;
  wind_speed_10m?: number;
  is_day?: number;
};

type OpenMeteoResponse = {
  current?: OpenMeteoCurrent;
};

export type WeatherSnapshot = {
  temperatureC: number | null;
  apparentTemperatureC: number | null;
  precipitationMm: number | null;
  weatherCode: number | null;
  windSpeedKmh: number | null;
  isDay: boolean | null;
};

export async function fetchWeatherSnapshot(params: {
  latitude: number;
  longitude: number;
}): Promise<{ weather: WeatherSnapshot; source: 'open_meteo' }> {
  const { latitude, longitude } = params;
  const url = new URL(OPEN_METEO_FORECAST_URL);
  url.searchParams.set('latitude', String(latitude));
  url.searchParams.set('longitude', String(longitude));
  url.searchParams.set(
    'current',
    'temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,is_day',
  );
  url.searchParams.set('timezone', 'auto');

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      method: 'GET',
      signal: AbortSignal.timeout(OPEN_METEO_TIMEOUT_MS),
    });
  } catch (e) {
    if (isAbortOrTimeout(e)) {
      throw new IntegrationError(
        `Open-Meteo request timed out after ${OPEN_METEO_TIMEOUT_MS / 1000}s.`,
        504,
      );
    }
    throw new IntegrationError(
      `Open-Meteo request failed: ${e instanceof Error ? e.message : String(e)}`,
      502,
    );
  }

  const rawText = await res.text();
  if (!res.ok) {
    throw new IntegrationError(`Open-Meteo HTTP ${res.status}: ${rawText.slice(0, 400)}`, 502);
  }

  let data: OpenMeteoResponse;
  try {
    data = JSON.parse(rawText) as OpenMeteoResponse;
  } catch {
    throw new IntegrationError('Open-Meteo returned invalid JSON.', 502);
  }

  const c = data.current ?? {};
  const weather: WeatherSnapshot = {
    temperatureC: typeof c.temperature_2m === 'number' ? c.temperature_2m : null,
    apparentTemperatureC: typeof c.apparent_temperature === 'number' ? c.apparent_temperature : null,
    precipitationMm: typeof c.precipitation === 'number' ? c.precipitation : null,
    weatherCode: typeof c.weather_code === 'number' ? c.weather_code : null,
    windSpeedKmh: typeof c.wind_speed_10m === 'number' ? c.wind_speed_10m : null,
    isDay: typeof c.is_day === 'number' ? c.is_day === 1 : null,
  };

  return { weather, source: 'open_meteo' };
}
