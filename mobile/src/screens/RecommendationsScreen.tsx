import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
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
const fishOne = require('../../assets/fish1.gif');
const fishTwo = require('../../assets/fish3.gif');

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
      <View style={[styles.panel, styles.panelMuted]}>
        <Text style={styles.panelTitle}>Risk</Text>
        <Text style={styles.mutedLine}>Not available for this response.</Text>
      </View>
    );
  }
  const sev = severityVisual(risk.severity);
  return (
    <View style={[styles.panel, styles.riskPanel]}>
      <View style={styles.riskHeaderRow}>
        <Text style={styles.panelTitle}>Spike radar</Text>
        <View style={[styles.severityPill, { backgroundColor: sev.bg, borderColor: sev.border }]}>
          <Text style={[styles.severityPillText, { color: sev.fg }]}>{sev.label}</Text>
        </View>
      </View>
      <Text style={styles.riskScoreLine}>
        <Text style={styles.riskScoreValue}>{risk.riskScore.toFixed(2)}</Text>
        <Text style={styles.riskScoreSuffix}> / 1.00</Text>
      </Text>
      {risk.factors?.length ? (
        <View style={styles.factorList}>
          {risk.factors.map((f, i) => (
            <View key={`f-${i}`} style={styles.factorRow}>
              <Text style={styles.factorBullet}>·</Text>
              <Text style={styles.factorText}>{f}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
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
    <View style={styles.noteBanner}>
      <Text style={styles.noteBannerText}>Surface weather: {parts.join(' · ')}</Text>
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
        {item.minutes} min · {item.intensity} intensity · {item.indoorPreferred ? 'indoor preferred' : 'outdoor-friendly'}
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
      <Text style={styles.updatedAt}>Dive log updated {data.updatedAt}</Text>
      <RiskPanel risk={data.risk} />
      {data.note ? (
        <View style={styles.noteBanner}>
          <Text style={styles.noteBannerText}>{data.note}</Text>
        </View>
      ) : null}
      <Pressable
        onPress={() => setMealExpanded((v) => !v)}
        style={({ pressed }) => [styles.sectionHeaderBtn, pressed && styles.pickCardPressed]}
        accessibilityRole="button"
        accessibilityState={{ expanded: mealExpanded }}
        accessibilityLabel={`${mealExpanded ? 'Collapse' : 'Expand'} reef meal picks`}
      >
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionHeading}>Reef meal picks</Text>
          <Text style={styles.sectionHeaderChevron}>{mealExpanded ? '▼' : '›'}</Text>
        </View>
      </Pressable>
      {mealExpanded
        ? data.picks.length === 0
          ? (
            <View style={[styles.panel, styles.panelMuted]}>
              <Text style={styles.mutedLine}>No restaurant picks for this run (e.g. low-risk gate).</Text>
            </View>
          )
          : (
            <View style={styles.pickList}>
              {data.picks.map((p, i) => (
                <PickCard key={`${data.updatedAt}-${p.placeName}-${i}`} pick={p} index={i} />
              ))}
            </View>
          )
        : null}
      <Pressable
        onPress={() => setExerciseExpanded((v) => !v)}
        style={({ pressed }) => [styles.sectionHeaderBtn, pressed && styles.pickCardPressed]}
        accessibilityRole="button"
        accessibilityState={{ expanded: exerciseExpanded }}
        accessibilityLabel={`${exerciseExpanded ? 'Collapse' : 'Expand'} current-guided movement`}
      >
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionHeading}>Current-guided movement</Text>
          <Text style={styles.sectionHeaderChevron}>{exerciseExpanded ? '▼' : '›'}</Text>
        </View>
      </Pressable>
      {exerciseExpanded ? (
        <>
          <WeatherSummary data={data.weather} />
          {data.exercise.length === 0 ? (
            <View style={[styles.panel, styles.panelMuted]}>
              <Text style={styles.mutedLine}>No exercise guidance was returned for this run.</Text>
            </View>
          ) : (
            <View style={styles.pickList}>
              {data.exercise.map((e, i) => (
                <ExerciseCard key={`${data.updatedAt}-exercise-${i}`} item={e} index={i} />
              ))}
            </View>
          )}
        </>
      ) : null}
    </View>
  );
}

function FallbackResultCard({ text }: { text: string }) {
  const isErrorish = /could not reach|error|escalat|invalid|failed/i.test(text.slice(0, 80));
  return (
    <View style={[styles.panel, isErrorish ? styles.panelWarn : styles.panelMuted]}>
      <Text style={styles.panelTitle}>{isErrorish ? 'Message' : 'Results'}</Text>
      <Text style={styles.fallbackBody}>{text}</Text>
    </View>
  );
}

export function RecommendationsScreen() {
  const insets = useSafeAreaInsets();
  const [demoSettingsOpen, setDemoSettingsOpen] = useState(false);
  const {
    displayMgdl,
    trend,
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
      <View pointerEvents="none" style={styles.fishLayer}>
        <Image source={fishOne} style={styles.fishOne} resizeMode="contain" />
        <Image source={fishTwo} style={styles.fishTwo} resizeMode="contain" />
      </View>
      <ScrollView
        ref={recommendationsScrollRef}
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.titleRow}>
          <Text style={[styles.title, styles.titleInRow]} numberOfLines={1}>
            Recommendations
          </Text>
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
        <Text style={styles.subtitle}>
          Live demo glucose <Text style={styles.subtitleStrong}>{displayMgdl}</Text> mg/dL · {trend}
        </Text>

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
                <Text style={styles.modalSubtitle}>Location and actions for this recommendations demo.</Text>

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
                      Nearby places + Gemini meal ideas. First run can take a minute — results appear below.
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
  fishLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1,
  },
  fishOne: {
    position: 'absolute',
    top: '56%',
    right: 100,
    width: 145,
    height: 92,
    opacity: 0.9,
  },
  fishTwo: {
    position: 'absolute',
    top: '63%',
    left: 10,
    width: 132,
    height: 88,
    opacity: 0.88,
  },
  scrollView: { flex: 1, backgroundColor: 'transparent', zIndex: 2 },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 8,
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
  titleInRow: { flex: 1, minWidth: 0 },
  title: { fontSize: 26, fontWeight: '800', color: '#020617', letterSpacing: -0.6 },
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
  subtitle: { marginTop: 6, fontSize: 14, fontWeight: '600', color: '#334155', lineHeight: 20 },
  subtitleStrong: { fontWeight: '800', color: '#0f172a' },
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
  resultsBlock: { marginTop: 22, gap: 16 },
  updatedAt: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0c4a6e',
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(224, 242, 254, 0.9)',
    borderWidth: 1,
    borderColor: '#bae6fd',
  },
  sectionHeading: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0c4a6e',
    textTransform: 'uppercase',
    letterSpacing: 0.7,
    marginTop: 4,
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(186, 230, 253, 0.75)',
    borderWidth: 1,
    borderColor: '#7dd3fc',
  },
  sectionHeaderBtn: { alignSelf: 'flex-start' },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionHeaderChevron: { fontSize: 15, fontWeight: '800', color: '#075985', marginTop: 1 },
  panel: {
    borderRadius: 22,
    padding: 16,
    borderWidth: 1,
    backgroundColor: 'rgba(255,255,255,0.95)',
  },
  panelMuted: {
    borderColor: '#e2e8f0',
    backgroundColor: '#f8fafc',
  },
  panelWarn: {
    borderColor: '#fecaca',
    backgroundColor: '#fef2f2',
  },
  riskPanel: {
    borderColor: '#e0f2f1',
    backgroundColor: '#f0fdfa',
  },
  panelTitle: { fontSize: 13, fontWeight: '800', color: '#0f172a', letterSpacing: 0.2 },
  mutedLine: { marginTop: 8, fontSize: 14, color: '#64748b', lineHeight: 20 },
  fallbackBody: { marginTop: 8, fontSize: 14, color: '#334155', lineHeight: 22 },
  riskHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  severityPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  severityPillText: { fontSize: 12, fontWeight: '800' },
  riskScoreLine: { marginTop: 12 },
  riskScoreValue: { fontSize: 36, fontWeight: '800', color: '#0f766e', letterSpacing: -1 },
  riskScoreSuffix: { fontSize: 16, fontWeight: '600', color: '#64748b' },
  factorList: { marginTop: 14, gap: 8 },
  factorRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  factorBullet: { fontSize: 16, color: '#14b8a6', fontWeight: '800', marginTop: -1 },
  factorText: { flex: 1, fontSize: 14, color: '#334155', lineHeight: 20, fontWeight: '500' },
  noteBanner: {
    borderRadius: 18,
    padding: 14,
    backgroundColor: 'rgba(224, 242, 254, 0.9)',
    borderWidth: 1,
    borderColor: '#7dd3fc',
  },
  noteBannerText: { fontSize: 14, color: '#075985', lineHeight: 20, fontWeight: '700' },
  pickCard: {
    borderRadius: 22,
    padding: 16,
    backgroundColor: 'rgba(255,255,255,0.97)',
    borderWidth: 1,
    borderColor: '#dbeafe',
    borderLeftWidth: 5,
    borderLeftColor: '#0ea5e9',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
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
  expandChevron: { fontSize: 18, fontWeight: '600', color: '#94a3b8', lineHeight: 22 },
  pickCardExpanded: {
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e2e8f0',
    gap: 12,
  },
  expandedSectionHint: {
    flex: 1,
    fontSize: 12,
    fontWeight: '700',
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingTop: 6,
  },
  reasoningLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#64748b',
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
  pickPlaceName: { fontSize: 17, fontWeight: '800', color: '#0f172a', lineHeight: 22 },
  distanceChip: {
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  distanceChipText: { fontSize: 12, fontWeight: '700', color: '#475569' },
  suggestedBox: {
    borderRadius: 14,
    backgroundColor: '#f0fdfa',
    borderWidth: 1,
    borderColor: '#99f6e4',
    padding: 12,
  },
  suggestedLabel: { fontSize: 11, fontWeight: '800', color: '#0f766e', textTransform: 'uppercase', letterSpacing: 0.5 },
  suggestedItem: { marginTop: 4, fontSize: 16, fontWeight: '700', color: '#134e4a', lineHeight: 22 },
  nutritionLine: { marginTop: 8, fontSize: 13, color: '#115e59', lineHeight: 18, fontWeight: '600' },
  explanation: { fontSize: 15, color: '#334155', lineHeight: 23, fontWeight: '500' },
  groundedBox: {
    borderRadius: 12,
    padding: 12,
    backgroundColor: '#eef2ff',
    borderWidth: 1,
    borderColor: '#c7d2fe',
  },
  groundedLabel: { fontSize: 11, fontWeight: '800', color: '#4338ca', textTransform: 'uppercase', letterSpacing: 0.5 },
  groundedText: { marginTop: 6, fontSize: 13, color: '#3730a3', lineHeight: 19, fontWeight: '500' },
  exerciseCard: {
    borderRadius: 20,
    padding: 14,
    borderWidth: 1,
    borderColor: '#bae6fd',
    backgroundColor: 'rgba(236, 254, 255, 0.95)',
    borderLeftWidth: 5,
    borderLeftColor: '#06b6d4',
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
    backgroundColor: '#dbeafe',
  },
  exerciseTitle: { flex: 1, fontSize: 15, fontWeight: '800', color: '#0f172a' },
  exerciseMeta: { fontSize: 12, fontWeight: '700', color: '#475569' },
  exerciseReason: { fontSize: 14, color: '#334155', lineHeight: 20, fontWeight: '500' },
});
