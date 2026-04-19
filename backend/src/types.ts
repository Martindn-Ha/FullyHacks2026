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
  /** `human_delta` from retrieval API; `google_test_placeholder` when Human Delta URL is unset (dev only). */
  source: 'human_delta' | 'google_test_placeholder';
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
  groundedNote?: string;
  score: number;
};
