import { ImageBackground, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const seafloorBackground = require('../../assets/seafloor.png');

export function EventsScreen() {
  const insets = useSafeAreaInsets();

  return (
    <ImageBackground
      source={seafloorBackground}
      style={[styles.screen, { paddingTop: insets.top }]}
      resizeMode="cover"
    >
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>Events</Text>
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
  scroll: { flex: 1, backgroundColor: 'transparent' },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 24,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: '#000000',
    letterSpacing: -0.4,
    marginBottom: 12,
  },
  body: {
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
