import { StatusBar } from 'expo-status-bar';
import { Image, ImageBackground, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const seafloorBackground = require('../../assets/seafloor.png');
const magikarpGif = require('../../assets/magikarp.gif');

export function EventsScreen() {
  const insets = useSafeAreaInsets();

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
            <Text style={styles.titleTagline}>Meetups, walks, and glucose-friendly outings</Text>
          </View>
        </View>
        <Text style={styles.body}>
          A place for meetups, walks, and glucose-friendly outings. For now, use the Home tab for the CGM strip, demo
          settings, and meal recommendations.
        </Text>
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
  body: {
    marginTop: 12,
    fontSize: 15,
    fontWeight: '600',
    color: '#0b1f3a',
    lineHeight: 22,
    backgroundColor: 'rgba(255,255,255,0.88)',
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
});
