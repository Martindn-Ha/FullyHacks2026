import { StatusBar } from 'expo-status-bar';
import {
  ActivityIndicator,
  ImageBackground,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCgmSession } from '../context/CgmSessionContext';

const seafloorBackground = require('../../assets/seafloor.png');

export function RecommendationsScreen() {
  const insets = useSafeAreaInsets();
  const {
    displayMgdl,
    trend,
    lat,
    lng,
    setLat,
    setLng,
    loading,
    resultText,
    recommendationsScrollRef,
    useDeviceLocation,
    requestRecommendations,
  } = useCgmSession();

  return (
    <ImageBackground
      source={seafloorBackground}
      style={[styles.screen, { paddingTop: insets.top }]}
      resizeMode="cover"
    >
      <StatusBar style="light" />
      <ScrollView
        ref={recommendationsScrollRef}
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>Recommendations</Text>
        <Text style={styles.subtitle}>
          Uses live demo glucose: <Text style={styles.subtitleStrong}>{displayMgdl}</Text> mg/dL · {trend}
        </Text>

        <Text style={styles.label}>Location</Text>
        <View style={styles.locRow}>
          <TextInput
            value={lat}
            onChangeText={setLat}
            style={[styles.input, styles.locInput]}
            keyboardType="numbers-and-punctuation"
          />
          <TextInput
            value={lng}
            onChangeText={setLng}
            style={[styles.input, styles.locInput]}
            keyboardType="numbers-and-punctuation"
          />
        </View>
        <Pressable onPress={useDeviceLocation} style={styles.secondaryBtn}>
          <Text style={styles.secondaryBtnText}>Use device location</Text>
        </Pressable>

        <Pressable onPress={requestRecommendations} style={styles.primaryBtn} disabled={loading}>
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Get recommendations</Text>}
        </Pressable>
        {loading ? (
          <Text style={styles.loadingHint}>
            Calling your backend (nearby places and meal suggestions). This can take up to a couple of minutes the first
            time — scroll down for results when the spinner stops.
          </Text>
        ) : null}

        {resultText ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Results</Text>
            <Text style={styles.cardBody}>{resultText}</Text>
          </View>
        ) : null}
      </ScrollView>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  scrollView: { flex: 1, backgroundColor: 'transparent' },
  scrollContent: {
    paddingHorizontal: 14,
    paddingTop: 6,
    paddingBottom: 24,
    gap: 6,
    flexGrow: 1,
  },
  title: { fontSize: 20, fontWeight: '800', color: '#000000', letterSpacing: -0.3 },
  subtitle: { fontSize: 13, fontWeight: '600', color: '#0b1f3a', lineHeight: 18 },
  subtitleStrong: { fontWeight: '800' },
  label: { marginTop: 10, fontSize: 13, fontWeight: '600', color: '#000000' },
  input: {
    marginTop: 6,
    borderWidth: 1,
    borderColor: '#d7deea',
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: '#0b1f3a',
  },
  locRow: { flexDirection: 'row', gap: 8 },
  locInput: { flex: 1 },
  secondaryBtn: {
    marginTop: 8,
    alignSelf: 'flex-start',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#94a3b8',
    backgroundColor: '#f1f5f9',
  },
  secondaryBtnText: { color: '#000000', fontWeight: '700' },
  primaryBtn: {
    marginTop: 14,
    backgroundColor: '#1f6feb',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  loadingHint: {
    marginTop: 10,
    fontSize: 13,
    color: '#94a3b8',
    lineHeight: 18,
  },
  card: {
    marginTop: 16,
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e5eaf3',
    padding: 14,
  },
  cardTitle: { fontSize: 16, fontWeight: '800', color: '#0b1f3a', marginBottom: 8 },
  cardBody: { fontSize: 14, color: '#22324d', lineHeight: 20 },
});
