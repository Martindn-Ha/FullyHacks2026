import { StatusBar } from 'expo-status-bar';
import { useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Image,
  ImageBackground,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  useCgmSession,
  type ExerciseRecommendationVm,
  type RecommendationPickVm,
  type RecommendationResultsVm,
} from '../context/CgmSessionContext';

const seafloorBackground = require('../../assets/seafloor.png');
const fishOneGif = require('../../assets/fish1.gif');
const fishThreeGif = require('../../assets/fish3.gif');

function severityVisual(sev: string): { label: string; bg: string; fg: string; border: string } {
  const s = sev.toLowerCase();
  if (s === 'high') {
    return { label: 'High', bg: '#fff1f2', fg: '#9f1239', border: '#fecdd3' };
  }
  if (s === 'moderate') {
    return { label: 'Moderate', bg: '#fffbeb', fg: '#b45309', border: '#fde68a' };
  }
  return { label: 'Low', bg: '#f8fafc', fg: '#475569', border: '#e2e8f0' };
}

function RiskPanel({ risk }: { risk: RecommendationResultsVm['risk'] }) {
  if (!risk) {
    return (
      <Text style={styles.riskOneLine}>
        Spike radar — no score this time; open Demo settings and run a report.
      </Text>
    );
  }
  const sev = severityVisual(risk.severity);
  return (
    <Text style={styles.riskOneLine} accessibilityRole="text">
      Spike radar · score {risk.riskScore.toFixed(2)}/1.00 · {sev.label} near-term risk
    </Text>
  );
}

function PickCard({ pick, index }: { pick: RecommendationPickVm; index: number }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Pressable
      onPress={() => setExpanded((e) => !e)}
      style={({ pressed }) => [styles.pickCard, pressed && styles.pickCardPressed]}
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      accessibilityLabel={`${pick.placeName}, ${Math.round(pick.distanceM)} meters away. ${expanded ? 'Expanded' : 'Collapsed'}. Double tap to ${expanded ? 'collapse' : 'expand'}.`}
    >
      <View style={styles.pickCardSummaryRow}>
        <View style={styles.pickSummaryMain}>
          <View style={styles.pickNameWrap}>
            <Text style={styles.pickPlaceName} numberOfLines={2}>
              {pick.placeName}
            </Text>
          </View>
          <View style={styles.distanceChip}>
            <Text style={styles.distanceChipText}>{Math.round(pick.distanceM)} m</Text>
          </View>
        </View>
        <View style={styles.expandChevronWrap} accessibilityElementsHidden>
          <Text style={styles.expandChevron}>{expanded ? '▼' : '›'}</Text>
        </View>
      </View>

      {expanded ? (
        <View style={styles.pickCardExpanded}>
          <View style={styles.pickCardHeader}>
            <View style={styles.pickIndexWrap}>
              <Text style={styles.pickIndexText}>{index + 1}</Text>
            </View>
            <Text style={styles.expandedSectionHint}>Pick & reasoning</Text>
          </View>
          <View style={styles.suggestedBox}>
            <Text style={styles.suggestedLabel}>Pick</Text>
            <Text style={styles.suggestedItem}>{pick.suggestedItem}</Text>
            {pick.nutritionInfo ? (
              <Text style={styles.nutritionLine}>{pick.nutritionInfo}</Text>
            ) : null}
          </View>
          <View>
            <Text style={styles.reasoningLabel}>Reasoning</Text>
            <Text style={styles.explanation}>{pick.explanation}</Text>
          </View>
          {pick.groundedNote ? (
            <View style={styles.groundedBox}>
              <Text style={styles.groundedLabel}>From menus / index</Text>
              <Text style={styles.groundedText}>{pick.groundedNote}</Text>
            </View>
          ) : null}
        </View>
      ) : null}
    </Pressable>
  );
}

function WeatherSummary({ data }: { data: RecommendationResultsVm['weather'] }) {
  if (!data) return null;
  const temp =
    typeof data.apparentTemperatureC === 'number'
      ? `${Math.round(data.apparentTemperatureC)}C (feels like)`
      : typeof data.temperatureC === 'number'
        ? `${Math.round(data.temperatureC)}C`
        : null;
  const wind = typeof data.windSpeedKmh === 'number' ? `${Math.round(data.windSpeedKmh)} km/h wind` : null;
  const rain = typeof data.precipitationMm === 'number' ? `${data.precipitationMm.toFixed(1)} mm precip` : null;
  const parts = [temp, wind, rain].filter(Boolean);
  if (parts.length === 0) return null;
  return (
    <View style={styles.weatherBanner}>
      <Text style={styles.weatherEmoji} accessibilityElementsHidden>
        🌤️
      </Text>
      <View style={styles.weatherTextCol}>
        <Text style={styles.weatherLabel}>Surface conditions</Text>
        <Text style={styles.weatherLine}>{parts.join(' · ')}</Text>
      </View>
    </View>
  );
}

function CollapsibleSection({
  emoji,
  title,
  expanded,
  onToggle,
  accessibilityLabel,
  children,
}: {
  emoji: string;
  title: string;
  expanded: boolean;
  onToggle: () => void;
  accessibilityLabel: string;
  children: ReactNode;
}) {
  return (
    <View style={styles.collapsibleWrap}>
      <Pressable
        onPress={onToggle}
        style={({ pressed }) => [styles.sectionCardOuter, pressed && styles.sectionCardPressed]}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={accessibilityLabel}
      >
        <View style={styles.sectionCard}>
          <Text style={styles.sectionEmoji} accessibilityElementsHidden>
            {emoji}
          </Text>
          <View style={styles.sectionTextCol}>
            <Text style={styles.sectionCardTitle}>{title}</Text>
          </View>
          <Text style={styles.sectionChevronBig} accessibilityElementsHidden>
            {expanded ? '▼' : '›'}
          </Text>
        </View>
      </Pressable>
      {expanded ? <View style={styles.sectionBody}>{children}</View> : null}
    </View>
  );
}

function ExerciseCard({ item, index }: { item: ExerciseRecommendationVm; index: number }) {
  return (
    <View style={styles.exerciseCard}>
      <View style={styles.exerciseHeaderRow}>
        <Text style={styles.exerciseIndex}>{index + 1}</Text>
        <Text style={styles.exerciseTitle}>{item.title}</Text>
      </View>
      <Text style={styles.exerciseMeta}>
        {item.minutes} min · {item.intensity} intensity ·{' '}
        {item.indoorPreferred ? 'indoor preferred' : 'outdoor-friendly'}
      </Text>
      <Text style={styles.exerciseReason}>{item.reason}</Text>
    </View>
  );
}

function StructuredResults({ data }: { data: RecommendationResultsVm }) {
  const [mealExpanded, setMealExpanded] = useState(true);
  const [exerciseExpanded, setExerciseExpanded] = useState(true);

  return (
    <View style={styles.resultsBlock}>
      <View style={styles.diveLogChip}>
        <Text style={styles.diveLogChipLabel}>Dive log</Text>
        <Text style={styles.diveLogChipTime}>{data.updatedAt}</Text>
      </View>
      <RiskPanel risk={data.risk} />
      {data.note ? (
        <View style={styles.noteBanner}>
          <Text style={styles.noteBannerText}>{data.note}</Text>
        </View>
      ) : null}
      <CollapsibleSection
        emoji="🪸"
        title="Meal ideas"
        expanded={mealExpanded}
        onToggle={() => setMealExpanded((v) => !v)}
        accessibilityLabel={`${mealExpanded ? 'Collapse' : 'Expand'} meal ideas from nearby venues`}
      >
        {data.picks.length === 0 ? (
          <View style={styles.emptyInline}>
            <Text style={styles.emptyEmoji} accessibilityElementsHidden>
              🦑
            </Text>
            <Text style={styles.onSeaMuted}>
              The reef is quiet — spike risk was low, so we skipped restaurant picks this round.
            </Text>
          </View>
        ) : (
          <View style={styles.pickList}>
            {data.picks.map((p, i) => (
              <PickCard key={`${data.updatedAt}-${p.placeName}-${i}`} pick={p} index={i} />
            ))}
          </View>
        )}
      </CollapsibleSection>
      <CollapsibleSection
        emoji="🌊"
        title="Movement & weather"
        expanded={exerciseExpanded}
        onToggle={() => setExerciseExpanded((v) => !v)}
        accessibilityLabel={`${exerciseExpanded ? 'Collapse' : 'Expand'} movement and weather section`}
      >
        <WeatherSummary data={data.weather} />
        {data.exercise.length === 0 ? (
          <View style={styles.emptyInline}>
            <Text style={styles.emptyEmoji} accessibilityElementsHidden>
              🐚
            </Text>
            <Text style={styles.onSeaMuted}>
              No movement cues this run — try again when recommendations return fully.
            </Text>
          </View>
        ) : (
          <View style={styles.pickList}>
            {data.exercise.map((e, i) => (
              <ExerciseCard key={`${data.updatedAt}-exercise-${i}`} item={e} index={i} />
            ))}
          </View>
        )}
      </CollapsibleSection>
    </View>
  );
}

function FallbackResultCard({ text }: { text: string }) {
  const isErrorish = /could not reach|error|escalat|invalid|failed/i.test(text.slice(0, 80));
  return (
    <View style={[styles.panel, isErrorish ? styles.panelWarn : styles.panelMuted]}>
      <Text style={styles.panelTitle}>{isErrorish ? 'Drifted off course' : 'From the crow’s nest'}</Text>
      <Text style={styles.fallbackBody}>{text}</Text>
    </View>
  );
}

export function RecommendationsScreen() {
  const insets = useSafeAreaInsets();
  const [demoSettingsOpen, setDemoSettingsOpen] = useState(false);
  const {
    lat,
    lng,
    setLat,
    setLng,
    loading,
    resultText,
    recommendationResults,
    recommendationsScrollRef,
    useDeviceLocation,
    requestRecommendations,
  } = useCgmSession();

  const showStructured = recommendationResults != null;
  const showFallback = !showStructured && resultText != null;

  return (
    <ImageBackground
      source={seafloorBackground}
      style={[styles.screen, { paddingTop: insets.top }]}
      resizeMode="cover"
    >
      <StatusBar style="light" />
      <View pointerEvents="none" style={styles.gifDecorLayer} accessibilityElementsHidden>
        <Image source={fishOneGif} style={styles.gifFishOne} resizeMode="contain" />
        <Image source={fishThreeGif} style={styles.gifFishThree} resizeMode="contain" />
      </View>
      <ScrollView
        ref={recommendationsScrollRef}
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.titleRow}>
          <View style={styles.titleBlock}>
            <Text style={[styles.title, styles.titleInRow]} numberOfLines={2}>
              Reef report
            </Text>
            <Text style={styles.titleTagline}>Glucose-aware meal & movement ideas</Text>
          </View>
          <Pressable
            onPress={() => setDemoSettingsOpen(true)}
            style={({ pressed }) => [styles.demoSettingsBtn, pressed && styles.demoSettingsBtnPressed]}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Open demo settings"
          >
            <Text style={styles.demoSettingsBtnText}>Demo settings</Text>
          </Pressable>
        </View>

        {loading ? (
          <View style={styles.inlineFetchBanner} accessibilityLiveRegion="polite">
            <ActivityIndicator color="#0f766e" />
            <Text style={styles.inlineFetchBannerText}>
              Fetching meal and movement ideas… first run can take a couple of minutes (check Demo settings for
              errors).
            </Text>
          </View>
        ) : null}

        {showStructured ? <StructuredResults data={recommendationResults} /> : null}
        {showFallback ? <FallbackResultCard text={resultText} /> : null}
      </ScrollView>

      <Modal
        visible={demoSettingsOpen}
        animationType="fade"
        transparent
        onRequestClose={() => setDemoSettingsOpen(false)}
      >
        <KeyboardAvoidingView
          style={styles.modalRoot}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={[styles.modalOverlay, { paddingTop: insets.top + 12 }]}>
            <Pressable
              style={styles.modalBackdrop}
              onPress={() => setDemoSettingsOpen(false)}
              accessibilityRole="button"
              accessibilityLabel="Close demo settings"
            />
            <View style={[styles.modalSheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
              <ScrollView
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
                bounces={false}
                style={styles.modalScroll}
              >
                <Text style={styles.modalTitle}>Demo settings</Text>
                <Text style={styles.modalSubtitle}>Set your location below, then fetch meal and exercise ideas.</Text>

                <View style={[styles.controlsCard, styles.modalControlsCard]}>
                  <Text style={styles.controlsLabel}>Location</Text>
                  <View style={styles.locRow}>
                    <TextInput
                      value={lat}
                      onChangeText={setLat}
                      style={[styles.input, styles.locInput]}
                      keyboardType="numbers-and-punctuation"
                      placeholder="Lat"
                      placeholderTextColor="#94a3b8"
                    />
                    <TextInput
                      value={lng}
                      onChangeText={setLng}
                      style={[styles.input, styles.locInput]}
                      keyboardType="numbers-and-punctuation"
                      placeholder="Lng"
                      placeholderTextColor="#94a3b8"
                    />
                  </View>
                  <Pressable onPress={useDeviceLocation} style={styles.secondaryBtn}>
                    <Text style={styles.secondaryBtnText}>Use device location</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => void requestRecommendations()}
                    style={styles.primaryBtn}
                    disabled={loading}
                  >
                    {loading ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <Text style={styles.primaryBtnText}>Get recommendations</Text>
                    )}
                  </Pressable>
                  {loading ? (
                    <Text style={styles.loadingHint}>
                      Trawling menus and models… first cast can take a minute; your report surfaces below.
                    </Text>
                  ) : null}
                </View>

                <Pressable
                  onPress={() => setDemoSettingsOpen(false)}
                  style={({ pressed }) => [styles.modalDoneBtn, pressed && styles.modalDoneBtnPressed]}
                  accessibilityRole="button"
                  accessibilityLabel="Done"
                >
                  <Text style={styles.modalDoneText}>Done</Text>
                </Pressable>
              </ScrollView>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  scrollView: { flex: 1, backgroundColor: 'transparent', zIndex: 2 },
  gifDecorLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1,
  },
  gifFishOne: {
    position: 'absolute',
    bottom: '40%',
    right: '10%',
    width: 130,
    height: 86,
    opacity: 0.9,
  },
  gifFishThree: {
    position: 'absolute',
    bottom: '27%',
    left: 8,
    width: 108,
    height: 76,
    opacity: 0.86,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 32,
    gap: 0,
    flexGrow: 1,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  titleBlock: { flex: 1, minWidth: 0, gap: 4 },
  titleInRow: { flex: 1, minWidth: 0 },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: '#ffffff',
    letterSpacing: -0.6,
    textShadowColor: 'rgba(15, 23, 42, 0.55)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 10,
  },
  titleTagline: {
    fontSize: 13,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.92)',
    lineHeight: 18,
    textShadowColor: 'rgba(15, 23, 42, 0.45)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },
  demoSettingsBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderWidth: 1,
    borderColor: 'rgba(226,232,240,0.95)',
  },
  demoSettingsBtnPressed: { opacity: 0.88 },
  demoSettingsBtnText: { fontSize: 13, fontWeight: '800', color: '#0f766e' },
  modalRoot: { flex: 1 },
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.48)',
  },
  modalSheet: {
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
    backgroundColor: 'rgba(255,255,255,0.98)',
    borderRadius: 22,
    paddingHorizontal: 18,
    paddingTop: 18,
    borderWidth: 1,
    borderColor: 'rgba(226,232,240,0.95)',
    maxHeight: '88%',
  },
  modalScroll: { maxHeight: '100%' },
  modalTitle: { fontSize: 20, fontWeight: '800', color: '#020617', letterSpacing: -0.4 },
  modalSubtitle: { marginTop: 6, marginBottom: 4, fontSize: 13, fontWeight: '600', color: '#64748b', lineHeight: 18 },
  modalControlsCard: { marginTop: 12 },
  modalDoneBtn: {
    marginTop: 14,
    paddingVertical: 14,
    alignItems: 'center',
    borderRadius: 16,
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  modalDoneBtnPressed: { opacity: 0.9 },
  modalDoneText: { fontSize: 16, fontWeight: '800', color: '#0f172a' },
  controlsCard: {
    marginTop: 18,
    backgroundColor: 'rgba(255,255,255,0.94)',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(226,232,240,0.95)',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 2,
  },
  controlsLabel: { fontSize: 12, fontWeight: '700', color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.6 },
  input: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 15,
    color: '#0f172a',
  },
  locRow: { flexDirection: 'row', gap: 10 },
  locInput: { flex: 1 },
  secondaryBtn: {
    marginTop: 12,
    alignSelf: 'flex-start',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#f8fafc',
  },
  secondaryBtnText: { color: '#0f172a', fontWeight: '700', fontSize: 14 },
  primaryBtn: {
    marginTop: 12,
    backgroundColor: '#0d9488',
    borderRadius: 16,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  loadingHint: {
    marginTop: 12,
    fontSize: 13,
    color: '#64748b',
    lineHeight: 19,
  },
  inlineFetchBanner: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderWidth: 1,
    borderColor: 'rgba(226,232,240,0.95)',
  },
  inlineFetchBannerText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    color: '#334155',
    lineHeight: 18,
  },
  resultsBlock: { marginTop: 14, gap: 16 },
  diveLogChip: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(224, 242, 254, 0.72)',
    borderWidth: 1,
    borderColor: 'rgba(125, 211, 252, 0.65)',
  },
  diveLogChipLabel: { fontSize: 11, fontWeight: '800', color: '#0369a1', letterSpacing: 0.8, textTransform: 'uppercase' },
  diveLogChipTime: { fontSize: 12, fontWeight: '800', color: '#075985' },
  collapsibleWrap: { gap: 0 },
  sectionCardOuter: {
    width: '100%',
    borderRadius: 18,
    overflow: 'hidden',
  },
  sectionCardPressed: { opacity: 0.85 },
  sectionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: 'rgba(15, 23, 42, 0.38)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.22)',
    borderRadius: 18,
  },
  sectionEmoji: { fontSize: 28, lineHeight: 32 },
  sectionTextCol: { flex: 1, minWidth: 0, gap: 4 },
  sectionCardTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#ffffff',
    letterSpacing: -0.35,
    textShadowColor: 'rgba(15, 23, 42, 0.55)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 8,
  },
  sectionChevronBig: {
    fontSize: 22,
    fontWeight: '800',
    color: 'rgba(255, 255, 255, 0.95)',
    paddingLeft: 4,
    textShadowColor: 'rgba(15, 23, 42, 0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },
  sectionBody: { marginTop: 8, gap: 12 },
  emptyInline: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 4, paddingRight: 8 },
  emptyEmoji: { fontSize: 22 },
  onSeaMuted: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.92)',
    lineHeight: 22,
    textShadowColor: 'rgba(15, 23, 42, 0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },
  riskOneLine: {
    fontSize: 15,
    fontWeight: '700',
    color: 'rgba(255, 255, 255, 0.95)',
    lineHeight: 22,
    textShadowColor: 'rgba(15, 23, 42, 0.55)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 8,
    paddingRight: 8,
  },
  panel: {
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.76)',
    borderColor: 'rgba(226, 232, 240, 0.9)',
  },
  panelMuted: {
    borderColor: 'rgba(226, 232, 240, 0.9)',
    backgroundColor: 'rgba(248, 250, 252, 0.72)',
  },
  panelWarn: {
    borderColor: 'rgba(254, 202, 202, 0.9)',
    backgroundColor: 'rgba(254, 242, 242, 0.78)',
  },
  panelTitle: { fontSize: 16, fontWeight: '800', color: '#020617', letterSpacing: 0.2 },
  mutedLine: { marginTop: 8, fontSize: 15, fontWeight: '600', color: '#475569', lineHeight: 22 },
  fallbackBody: { marginTop: 8, fontSize: 15, fontWeight: '600', color: '#1e293b', lineHeight: 23 },
  noteBanner: {
    borderRadius: 14,
    padding: 14,
    backgroundColor: 'rgba(239, 246, 255, 0.7)',
    borderWidth: 1,
    borderColor: 'rgba(191, 219, 254, 0.75)',
  },
  noteBannerText: { fontSize: 15, color: '#1e3a8a', lineHeight: 22, fontWeight: '700' },
  weatherBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    borderRadius: 16,
    padding: 14,
    backgroundColor: 'rgba(224, 242, 254, 0.55)',
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.55)',
  },
  weatherEmoji: { fontSize: 26, lineHeight: 30 },
  weatherTextCol: { flex: 1, minWidth: 0, gap: 4 },
  weatherLabel: { fontSize: 11, fontWeight: '800', color: '#0369a1', letterSpacing: 0.6, textTransform: 'uppercase' },
  weatherLine: { fontSize: 15, color: '#0c4a6e', lineHeight: 22, fontWeight: '800' },
  pickCard: {
    borderRadius: 18,
    padding: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.68)',
    borderWidth: 1,
    borderColor: 'rgba(226, 232, 240, 0.85)',
    borderLeftWidth: 4,
    borderLeftColor: 'rgba(20, 184, 166, 0.85)',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 1,
    gap: 0,
  },
  pickCardPressed: { opacity: 0.94 },
  pickCardSummaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 28,
  },
  pickSummaryMain: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    minWidth: 0,
  },
  pickNameWrap: { flex: 1, minWidth: 0 },
  expandChevronWrap: { justifyContent: 'center', paddingLeft: 2 },
  expandChevron: { fontSize: 18, fontWeight: '800', color: '#475569', lineHeight: 22 },
  pickCardExpanded: {
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(226, 232, 240, 0.9)',
    gap: 12,
  },
  expandedSectionHint: {
    flex: 1,
    fontSize: 12,
    fontWeight: '800',
    color: '#475569',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingTop: 6,
  },
  reasoningLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#475569',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  pickList: { gap: 14 },
  pickCardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  pickIndexWrap: {
    width: 30,
    height: 30,
    borderRadius: 10,
    backgroundColor: '#0d9488',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickIndexText: { fontSize: 14, fontWeight: '800', color: '#fff' },
  pickPlaceName: { fontSize: 17, fontWeight: '800', color: '#020617', lineHeight: 22 },
  distanceChip: {
    backgroundColor: 'rgba(241, 245, 249, 0.82)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(226, 232, 240, 0.9)',
  },
  distanceChipText: { fontSize: 12, fontWeight: '800', color: '#334155' },
  suggestedBox: {
    borderRadius: 14,
    backgroundColor: 'rgba(240, 253, 250, 0.72)',
    borderWidth: 1,
    borderColor: 'rgba(153, 246, 228, 0.75)',
    padding: 12,
  },
  suggestedLabel: { fontSize: 11, fontWeight: '800', color: '#0f766e', textTransform: 'uppercase', letterSpacing: 0.5 },
  suggestedItem: { marginTop: 4, fontSize: 16, fontWeight: '700', color: '#134e4a', lineHeight: 22 },
  nutritionLine: { marginTop: 8, fontSize: 13, color: '#115e59', lineHeight: 18, fontWeight: '600' },
  explanation: { fontSize: 16, color: '#1e293b', lineHeight: 24, fontWeight: '600' },
  groundedBox: {
    borderRadius: 12,
    padding: 12,
    backgroundColor: 'rgba(238, 242, 255, 0.72)',
    borderWidth: 1,
    borderColor: 'rgba(199, 210, 254, 0.8)',
  },
  groundedLabel: { fontSize: 11, fontWeight: '800', color: '#4338ca', textTransform: 'uppercase', letterSpacing: 0.5 },
  groundedText: { marginTop: 6, fontSize: 14, color: '#312e81', lineHeight: 21, fontWeight: '600' },
  exerciseCard: {
    borderRadius: 20,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(186, 230, 253, 0.75)',
    backgroundColor: 'rgba(236, 254, 255, 0.58)',
    borderLeftWidth: 5,
    borderLeftColor: 'rgba(6, 182, 212, 0.75)',
    gap: 6,
  },
  exerciseHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  exerciseIndex: {
    width: 22,
    height: 22,
    borderRadius: 999,
    textAlign: 'center',
    lineHeight: 22,
    fontSize: 12,
    fontWeight: '800',
    color: '#1d4ed8',
    backgroundColor: 'rgba(219, 234, 254, 0.88)',
  },
  exerciseTitle: { flex: 1, fontSize: 15, fontWeight: '800', color: '#0f172a' },
  exerciseMeta: { fontSize: 13, fontWeight: '800', color: '#334155' },
  exerciseReason: { fontSize: 15, color: '#1e293b', lineHeight: 22, fontWeight: '600' },
});
