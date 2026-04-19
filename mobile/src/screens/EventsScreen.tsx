import { StatusBar } from 'expo-status-bar';
import { Image, ImageBackground, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCgmSession } from '../context/CgmSessionContext';

const seafloorBackground = require('../../assets/seafloor.png');
const magikarpGif = require('../../assets/magikarp.gif');

function formatWhen(atMs: number): string {
  try {
    return new Date(atMs).toLocaleString();
  } catch {
    return String(atMs);
  }
}

export function EventsScreen() {
  const insets = useSafeAreaInsets();
  const { glucoseSpikeEvents } = useCgmSession();

  return (
    <ImageBackground
      source={seafloorBackground}
      style={[styles.screen, { paddingTop: insets.top }]}
      resizeMode="cover"
    >
      <StatusBar style="light" />
      <View pointerEvents="none" style={styles.gifDecorLayer} accessibilityElementsHidden>
        <Image source={magikarpGif} style={styles.gifMagikarp} resizeMode="contain" />
      </View>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.titleRow}>
          <View style={styles.titleBlock}>
            <Text style={[styles.title, styles.titleInRow]} numberOfLines={2}>
              Events
            </Text>
            <Text style={styles.subtitle}>Glucose above 180 mg/dL (actual reading)</Text>
          </View>
        </View>
        {glucoseSpikeEvents.length === 0 ? (
          <Text style={styles.empty}>
            No spikes logged yet. They appear when the CGM reading goes above 180 mg/dL.
          </Text>
        ) : (
          glucoseSpikeEvents.map((e) => (
            <View key={e.id} style={styles.card}>
              <Text style={styles.cardWhen}>{formatWhen(e.atMs)}</Text>
              <Text style={styles.cardLine}>Glucose: {e.glucoseMgDl} mg/dL</Text>
              {e.latitude != null && e.longitude != null ? (
                <Text style={styles.cardMeta}>
                  Location: {e.latitude.toFixed(5)}°, {e.longitude.toFixed(5)}°
                </Text>
              ) : (
                <Text style={styles.cardMeta}>Location: not set (use Home coordinates or device location)</Text>
              )}
            </View>
          ))
        )}
      </ScrollView>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  gifDecorLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1,
  },
  gifMagikarp: {
    position: 'absolute',
    bottom: '15%',
    left: 70,
    width: 50,
    height: 50,
    opacity: 0.82,
  },
  scroll: { flex: 1, backgroundColor: 'transparent', zIndex: 2 },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 24,
    gap: 10,
    flexGrow: 1,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  titleBlock: { flex: 1, minWidth: 0, gap: 6 },
  subtitle: {
    fontSize: 13,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.9)',
    textShadowColor: 'rgba(15, 23, 42, 0.45)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },
  empty: {
    marginTop: 8,
    fontSize: 14,
    fontWeight: '600',
    color: '#0b1f3a',
    lineHeight: 20,
    backgroundColor: 'rgba(255,255,255,0.88)',
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  card: {
    backgroundColor: 'rgba(255,255,255,0.92)',
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    gap: 4,
  },
  cardWhen: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0f172a',
  },
  cardLine: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0b1f3a',
  },
  cardMeta: {
    fontSize: 13,
    fontWeight: '600',
    color: '#334155',
    lineHeight: 18,
  },
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
});
