export type Severity = 'low' | 'moderate' | 'high';

export type GlucoseTrend = 'rising' | 'stable' | 'falling';

export type ActivityLevel = 'low' | 'moderate' | 'high';

export type UserContext = {
  symptoms: string[];
  recentGlucoseMgDl?: number;
  glucoseTrend?: GlucoseTrend;
  minutesSinceLastMeal?: number;
  lastMealCarbsG?: number;
  medicationOnSchedule?: boolean;
  activityLevel?: ActivityLevel;
  latitude: number;
  longitude: number;
};

export type PlaceCandidate = {
  id: string;
  name: string;
  vicinity?: string;
  latitude: number;
  longitude: number;
  distanceM: number;
};

export type MenuPassage = {
  text: string;
  /** `human_delta` from retrieval; `human_delta_empty` when search succeeded but returned no hits; `google_test_placeholder` when HD URL is unset (dev). */
  source: 'human_delta' | 'human_delta_empty' | 'google_test_placeholder';
};

export type PlaceGuidance = {
  placeId: string;
  placeName: string;
  passages: MenuPassage[];
};

export type FoodRecommendation = {
  place: PlaceCandidate;
  suggestedItem: string;
  explanation: string;
  /** From Gemini when CONTEXT had nutrition facts; omit if unknown. */
  nutritionInfo?: string;
  groundedNote?: string;
  score: number;
};
