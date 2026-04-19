import express from 'express';
import type { Severity, UserContext } from '../types.js';
import { assessSpikeRisk } from '../services/riskEngine.js';
import { evaluateSafety } from '../services/safetyRules.js';
import { findNearbyRestaurants } from '../services/googleMapsClient.js';
import {
  buildPlaceholderGuidance,
  retrieveMenuGuidance,
} from '../services/humanDeltaClient.js';
import { synthesizeGuidanceWithGemini } from '../services/llmGuidanceSynthesis.js';
import { rankFoodRecommendations } from '../services/recommendationEngine.js';
import { IntegrationError } from '../services/integrationError.js';
import {
  tryReadClarityDemoCsv,
  type ClarityDemoDataset,
} from '../services/clarityDemoCsv.js';

export const apiRouter = express.Router();

function trimEnv(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  let v = value.trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1).trim();
  }
  return v || undefined;
}

function envTruthy(value: string | undefined): boolean {
  const v = (value ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

function readEnv() {
  return {
    googleMapsApiKey: trimEnv(process.env.GOOGLE_MAPS_API_KEY),
    humanDeltaApiUrl: trimEnv(process.env.HUMAN_DELTA_API_URL),
    humanDeltaApiKey: trimEnv(process.env.HUMAN_DELTA_API_KEY),
    /** Vertex / Cloud API key for Gemini HTTP calls; legacy: GEMINI_API_KEY, GOOGLE_API_KEY. */
    vertexGeminiApiKey: trimEnv(
      process.env.VERTEX_GEMINI_API_KEY || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY,
    ),
    geminiModel: trimEnv(process.env.GEMINI_MODEL),
    geminiUseVertex: envTruthy(process.env.GEMINI_USE_VERTEX),
    /** Prefer with Vertex API keys — avoids some us-central1-only 404s. Numeric or string project id from GCP. */
    vertexProjectId: trimEnv(
      process.env.GEMINI_VERTEX_PROJECT_ID ||
        process.env.GOOGLE_CLOUD_PROJECT ||
        process.env.GCLOUD_PROJECT,
    ),
    vertexLocation: trimEnv(process.env.GEMINI_VERTEX_LOCATION),
    /**
     * When true, `/api/recommendations` never short-circuits on low spike risk and the response risk
     * is bumped to moderate for UI/testing. Remove before demo/production.
     */
    devBypassLowRiskRecommendationsGate: envTruthy(process.env.DEV_BYPASS_LOW_RISK_RECOMMENDATIONS_GATE),
  };
}

function integrationResponse(res: express.Response, err: unknown, route: string) {
  if (err instanceof IntegrationError) {
    console.error(`[api ${route}] ${err.statusCode} ${err.message}`);
    return res.status(err.statusCode).json({ error: err.message });
  }
  const message = err instanceof Error ? err.message : 'Unknown error';
  console.error(`[api ${route}] 500 ${message}`);
  if (err instanceof Error && err.stack) {
    console.error(err.stack);
  }
  return res.status(500).json({ error: message });
}

/** Raw Clarity / Stelo-style CSV from repo `dummydata/` for the mobile simulator graph (optional). */
apiRouter.get('/clarity-demo', (req, res) => {
  const q = typeof req.query.dataset === 'string' ? req.query.dataset.trim().toLowerCase() : '';
  const dataset: ClarityDemoDataset = q === 'diabetic' ? 'diabetic' : 'nondiabetic';
  const raw = tryReadClarityDemoCsv(dataset);
  if (!raw) {
    return res
      .status(404)
      .type('text/plain')
      .send(`No demo CSV for dataset=${dataset} in dummydata/ (expected file for this mode).`);
  }
  res.type('text/csv; charset=utf-8').send(raw);
});

apiRouter.post('/risk-assessment', (req, res) => {
  const body = req.body as Partial<UserContext>;
  const symptoms = Array.isArray(body.symptoms) ? body.symptoms.map(String) : [];

  const context: UserContext = {
    symptoms,
    recentGlucoseMgDl: body.recentGlucoseMgDl,
    glucoseTrend: body.glucoseTrend,
    minutesSinceLastMeal: body.minutesSinceLastMeal,
    lastMealCarbsG: body.lastMealCarbsG,
    medicationOnSchedule: body.medicationOnSchedule,
    activityLevel: body.activityLevel,
    latitude: typeof body.latitude === 'number' ? body.latitude : 0,
    longitude: typeof body.longitude === 'number' ? body.longitude : 0,
  };

  const safety = evaluateSafety(context.symptoms);
  if (safety.suppressFoodRecommendations) {
    return res.json({
      safety,
      assessment: null,
      disclaimer:
        'This is a rules-based risk estimate for a hackathon MVP, not medical advice. It does not diagnose or treat diabetes.',
    });
  }

  const assessment = assessSpikeRisk(context);
  return res.json({
    safety,
    assessment,
    disclaimer:
      'This is a rules-based risk estimate for a hackathon MVP, not medical advice. It does not diagnose or treat diabetes.',
  });
});

apiRouter.post('/nearby-restaurants', async (req, res) => {
  try {
    const { latitude, longitude, radiusM } = req.body as {
      latitude?: number;
      longitude?: number;
      radiusM?: number;
    };

    if (typeof latitude !== 'number' || typeof longitude !== 'number') {
      console.warn('[api nearby-restaurants] 400 latitude and longitude are required numbers.');
      return res.status(400).json({ error: 'latitude and longitude are required numbers.' });
    }

    const env = readEnv();
    const result = await findNearbyRestaurants({
      latitude,
      longitude,
      radiusM: typeof radiusM === 'number' ? radiusM : 1200,
      apiKey: env.googleMapsApiKey,
    });

    return res.json({
      places: result.places,
      source: result.source,
      disclaimer: 'Places are for informational purposes only.',
    });
  } catch (err) {
    return integrationResponse(res, err, 'nearby-restaurants');
  }
});

apiRouter.post('/menu-guidance', async (req, res) => {
  try {
    const { places, queryHint } = req.body as {
      places?: { id: string; name: string; vicinity?: string; latitude: number; longitude: number; distanceM: number }[];
      queryHint?: string;
    };

    if (!Array.isArray(places) || places.length === 0) {
      console.warn('[api menu-guidance] 400 places[] is required.');
      return res.status(400).json({ error: 'places[] is required.' });
    }

    const env = readEnv();
    const normalized = places.map((p) => ({
      id: String(p.id),
      name: String(p.name),
      vicinity: p.vicinity,
      latitude: Number(p.latitude),
      longitude: Number(p.longitude),
      distanceM: Number(p.distanceM),
    }));

    const guidance = env.humanDeltaApiUrl?.trim()
      ? await retrieveMenuGuidance({
          places: normalized,
          queryHint: typeof queryHint === 'string' ? queryHint : 'diabetes-friendly nearby meal guidance',
          apiUrl: env.humanDeltaApiUrl,
          apiKey: env.humanDeltaApiKey,
        })
      : buildPlaceholderGuidance(normalized);

    return res.json({
      guidance,
      disclaimer: 'Menu guidance is retrieved context for explanation, not medical nutrition therapy.',
    });
  } catch (err) {
    return integrationResponse(res, err, 'menu-guidance');
  }
});

apiRouter.post('/recommendations', async (req, res) => {
  try {
    const body = req.body as Partial<UserContext> & { radiusM?: number };
    const symptoms = Array.isArray(body.symptoms) ? body.symptoms.map(String) : [];

    if (typeof body.latitude !== 'number' || typeof body.longitude !== 'number') {
      console.warn('[api recommendations] 400 latitude and longitude are required numbers.');
      return res.status(400).json({ error: 'latitude and longitude are required numbers.' });
    }

    const context: UserContext = {
      symptoms,
      recentGlucoseMgDl: body.recentGlucoseMgDl,
      glucoseTrend: body.glucoseTrend,
      minutesSinceLastMeal: body.minutesSinceLastMeal,
      lastMealCarbsG: body.lastMealCarbsG,
      medicationOnSchedule: body.medicationOnSchedule,
      activityLevel: body.activityLevel,
      latitude: body.latitude,
      longitude: body.longitude,
    };

    const safety = evaluateSafety(context.symptoms);
    if (safety.suppressFoodRecommendations) {
      return res.json({
        safety,
        risk: null,
        recommendations: [],
        sources: { places: 'none', guidance: 'none' },
        escalationMessage: safety.message,
        disclaimer:
          'Not medical advice. Food suggestions are hidden due to reported urgent symptoms.',
      });
    }

    let risk = assessSpikeRisk(context);
    const env = readEnv();

    if (env.devBypassLowRiskRecommendationsGate && risk.severity === 'low') {
      const sev: Severity = 'moderate';
      console.warn(
        '[api recommendations] DEV_BYPASS_LOW_RISK_RECOMMENDATIONS_GATE: forcing moderate severity for testing.',
      );
      risk = {
        riskScore: Math.max(risk.riskScore, 0.4),
        severity: sev,
        factors: [
          ...risk.factors,
          '(dev) Low-risk gate bypassed — unset DEV_BYPASS_LOW_RISK_RECOMMENDATIONS_GATE in backend/.env for real behavior.',
        ],
      };
    }

    if (risk.severity === 'low') {
      return res.json({
        safety,
        risk: {
          riskScore: risk.riskScore,
          severity: risk.severity,
          factors: risk.factors,
        },
        recommendations: [],
        sources: { places: 'none', guidance: 'none' },
        recommendationsNote:
          'Meal picks are only returned when near-term spike risk is moderate or higher. Your inputs look stable enough that we are not suggesting specific restaurants here.',
        disclaimer:
          'This MVP suggests practical meal patterns near you. It is not a diagnosis, not guaranteed treatment advice, and does not replace clinician guidance.',
      });
    }

    if (!env.googleMapsApiKey?.trim()) {
      const msg =
        'GOOGLE_MAPS_API_KEY is not set in backend/.env. Use the same key as in Google Cloud; enable Places API (New) and billing.';
      console.warn(`[api recommendations] 503 ${msg}`);
      return res.status(503).json({ error: msg });
    }

    const nearby = await findNearbyRestaurants({
      latitude: context.latitude,
      longitude: context.longitude,
      radiusM: typeof body.radiusM === 'number' ? body.radiusM : 1200,
      apiKey: env.googleMapsApiKey,
    });

    let guidanceSource: 'human_delta_llm' | 'none' = 'none';
    let guidance: Awaited<ReturnType<typeof retrieveMenuGuidance>> = [];
    if (nearby.places.length > 0) {
      if (!env.vertexGeminiApiKey?.trim()) {
        throw new IntegrationError(
          'VERTEX_GEMINI_API_KEY (or legacy GEMINI_API_KEY / GOOGLE_API_KEY) is required for recommendations — Gemini is not optional.',
          503,
        );
      }
      if (env.geminiUseVertex && !env.vertexProjectId?.trim()) {
        throw new IntegrationError(
          'GEMINI_VERTEX_PROJECT_ID or GOOGLE_CLOUD_PROJECT is required when GEMINI_USE_VERTEX=true (GCP project id or numeric project id from console / error logs).',
          503,
        );
      }

      if (env.humanDeltaApiUrl?.trim()) {
        guidance = await retrieveMenuGuidance({
          places: nearby.places,
          queryHint: `spike risk=${risk.riskScore.toFixed(2)} severity=${risk.severity}; prefer lower-glycemic-style items`,
          apiUrl: env.humanDeltaApiUrl,
          apiKey: env.humanDeltaApiKey,
        });
      } else {
        guidance = buildPlaceholderGuidance(nearby.places);
        console.log(
          '[api recommendations] HUMAN_DELTA_API_URL unset; Gemini still runs on placeholder + venue names.',
        );
      }

      guidance = await synthesizeGuidanceWithGemini({
        apiKey: env.vertexGeminiApiKey,
        model: env.geminiModel,
        useVertex: env.geminiUseVertex,
        vertexProjectId: env.vertexProjectId,
        vertexLocation: env.vertexLocation,
        places: nearby.places,
        guidance,
        riskLine: `spike risk=${risk.riskScore.toFixed(2)} severity=${risk.severity}; prefer lower-glycemic-style items`,
      });
      guidanceSource = 'human_delta_llm';
    }

    const recommendations = rankFoodRecommendations({
      places: nearby.places,
      guidance,
      severity: risk.severity,
    });

    console.log(
      `[api recommendations] ok places=${nearby.places.length} recs=${recommendations.length} severity=${risk.severity}`,
    );

    return res.json({
      safety,
      risk: {
        riskScore: risk.riskScore,
        severity: risk.severity,
        factors: risk.factors,
      },
      recommendations,
      sources: {
        places: nearby.source,
        guidance: guidanceSource,
      },
      disclaimer:
        'This MVP suggests practical meal patterns near you. It is not a diagnosis, not guaranteed treatment advice, and does not replace clinician guidance.',
    });
  } catch (err) {
    return integrationResponse(res, err, 'recommendations');
  }
});
