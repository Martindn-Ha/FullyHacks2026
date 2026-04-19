import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SMS from 'expo-sms';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
import { useCgmSession } from '../context/CgmSessionContext';

const seafloorBackground = require('../../assets/seafloor.png');
const magikarpGif = require('../../assets/magikarp.gif');

const STORAGE_PHONE = '@tideTogether/smsPresetPhone';
const STORAGE_TEMPLATE = '@tideTogether/smsPresetTemplate';
const STORAGE_LABEL = '@tideTogether/smsPresetLabel';

const DEFAULT_TEMPLATE =
  'Tide Together — alert for {{name}}. CGM ~{{glucose}} mg/dL, trend {{trend}}, at {{time}}. Location {{coordinates}} (lat {{lat}}, lng {{lng}}). Please check in if you can.';

function applyTemplate(template: string, vars: Record<string, string>): string {
  let s = template;
  for (const [k, v] of Object.entries(vars)) {
    s = s.split(`{{${k}}}`).join(v);
  }
  return s;
}

function normalizePhoneForSms(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const digits = trimmed.replace(/\D/g, '');
  if (trimmed.startsWith('+')) {
    return `+${digits}`;
  }
  if (digits.length === 10) {
    return `+1${digits}`;
  }
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+${digits}`;
  }
  return trimmed;
}

export function ContactScreen() {
  const insets = useSafeAreaInsets();
  const { displayMgdl, trend, lat, lng } = useCgmSession();

  const [demoSettingsOpen, setDemoSettingsOpen] = useState(false);
  const [presetLabel, setPresetLabel] = useState('');
  const [presetPhone, setPresetPhone] = useState('');
  const [messageTemplate, setMessageTemplate] = useState(DEFAULT_TEMPLATE);
  const [hydrated, setHydrated] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [p, t, l] = await Promise.all([
          AsyncStorage.getItem(STORAGE_PHONE),
          AsyncStorage.getItem(STORAGE_TEMPLATE),
          AsyncStorage.getItem(STORAGE_LABEL),
        ]);
        if (cancelled) return;
        if (p != null) setPresetPhone(p);
        if (t != null && t.trim()) setMessageTemplate(t);
        if (l != null) setPresetLabel(l);
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const savePreset = useCallback(async () => {
    setSaving(true);
    try {
      await AsyncStorage.multiSet([
        [STORAGE_PHONE, presetPhone.trim()],
        [STORAGE_TEMPLATE, messageTemplate.trim() || DEFAULT_TEMPLATE],
        [STORAGE_LABEL, presetLabel.trim()],
      ]);
      Alert.alert('Saved', 'Preset contact and message are saved on this device.');
    } catch {
      Alert.alert('Save failed', 'Could not write to device storage.');
    } finally {
      setSaving(false);
    }
  }, [presetPhone, messageTemplate, presetLabel]);

  const sendAutomatedText = useCallback(async () => {
    const to = normalizePhoneForSms(presetPhone);
    if (!to || to.replace(/\D/g, '').length < 10) {
      Alert.alert(
        'Phone number',
        'Open Demo settings (top right), enter a valid number, and tap Save preset.',
      );
      return;
    }

    const tpl = messageTemplate.trim() || DEFAULT_TEMPLATE;
    const la = Number(lat);
    const lo = Number(lng);
    const coordsOk = Number.isFinite(la) && Number.isFinite(lo);
    const latStr = coordsOk ? la.toFixed(5) : '—';
    const lngStr = coordsOk ? lo.toFixed(5) : '—';
    const coordinates = coordsOk ? `${latStr}, ${lngStr}` : '—';
    const nameStr = presetLabel.trim() || '—';

    const body = applyTemplate(tpl, {
      name: nameStr,
      glucose: String(Math.round(displayMgdl)),
      trend: trend || '—',
      time: new Date().toLocaleString(),
      lat: latStr,
      lng: lngStr,
      coordinates,
    });

    try {
      const available = await SMS.isAvailableAsync();
      if (!available) {
        Alert.alert(
          'SMS not available',
          Platform.OS === 'ios'
            ? 'SMS does not work in the iOS Simulator. Use a physical iPhone, or try again on a device with the Messages app.'
            : 'This device cannot send SMS from the app.',
        );
        return;
      }

      setSending(true);
      const { result } = await SMS.sendSMSAsync([to], body);
      if (result === 'cancelled') {
        Alert.alert('Cancelled', 'Message was not sent.');
      } else if (result === 'sent' || result === 'unknown') {
        Alert.alert(
          'Done',
          result === 'unknown' ? 'SMS composer closed (Android cannot confirm send).' : 'Message was sent or queued.',
        );
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      Alert.alert('SMS error', msg);
    } finally {
      setSending(false);
    }
  }, [presetPhone, messageTemplate, presetLabel, displayMgdl, trend, lat, lng]);

  const presetSummary =
    presetPhone.trim().length > 0
      ? `${presetLabel.trim() || 'Contact'} · ${presetPhone.trim()}`
      : 'No preset number yet — open Demo settings.';

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
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={insets.top + 8}
      >
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.titleRow}>
            <View style={styles.titleBlock}>
              <Text style={[styles.title, styles.titleInRow]} numberOfLines={2}>
                Contact
              </Text>
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
          <Text style={styles.subtitle}>Preset SMS alert</Text>

          <Text style={styles.hint}>
            Send opens Messages with your template filled in — you tap Send. iOS/Android do not allow silent SMS from
            apps.
          </Text>

          {!hydrated ? (
            <ActivityIndicator color="#0ea5e9" style={styles.loader} />
          ) : (
            <View style={styles.card}>
              <Text style={styles.presetSummaryLabel}>Current preset</Text>
              <Text style={styles.presetSummaryText}>{presetSummary}</Text>

              <Pressable
                onPress={() => void sendAutomatedText()}
                disabled={sending}
                style={({ pressed }) => [styles.btnPrimary, pressed && styles.btnPressed, sending && styles.btnDisabled]}
              >
                {sending ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.btnPrimaryText}>Send alert SMS</Text>
                )}
              </Pressable>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

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
                showsVerticalScrollIndicator={true}
                bounces={false}
                style={styles.modalScroll}
                contentContainerStyle={styles.modalScrollContent}
              >
                <Text style={styles.modalTitle}>Demo settings</Text>
                <Text style={styles.modalSubtitle}>
                  Set the SMS preset: contact name, mobile number, and message template. Placeholders fill from live
                  glucose, session coordinates, and the name when you send.
                </Text>

                <View style={[styles.controlsCard, styles.modalControlsCard]}>
                  <Text style={styles.modalFieldLabel}>Contact name (optional)</Text>
                  <TextInput
                    value={presetLabel}
                    onChangeText={setPresetLabel}
                    placeholder="e.g. Mom"
                    placeholderTextColor="#94a3b8"
                    style={styles.modalInput}
                    autoCapitalize="words"
                  />

                  <Text style={styles.modalFieldLabelSpaced}>Mobile number</Text>
                  <TextInput
                    value={presetPhone}
                    onChangeText={setPresetPhone}
                    placeholder="+1 555 123 4567"
                    placeholderTextColor="#94a3b8"
                    style={styles.modalInput}
                    keyboardType="phone-pad"
                    autoComplete="tel"
                    textContentType="telephoneNumber"
                  />

                  <Text style={styles.modalFieldLabelSpaced}>Message template</Text>
                  <Text style={styles.modalPlaceholderHelp}>
                    {'Placeholders (copy into your text):'}
                    {'\n'}
                    {'{{name}}, {{glucose}}, {{trend}}, {{time}}'}
                    {'\n'}
                    {'{{lat}}, {{lng}}, {{coordinates}}'}
                  </Text>
                  <TextInput
                    value={messageTemplate}
                    onChangeText={setMessageTemplate}
                    placeholder={DEFAULT_TEMPLATE}
                    placeholderTextColor="#94a3b8"
                    style={[styles.modalInput, styles.modalTextArea]}
                    multiline
                  />

                  <Pressable
                    onPress={() => void savePreset()}
                    disabled={saving}
                    style={({ pressed }) => [
                      styles.modalSaveBtn,
                      pressed && styles.modalSaveBtnPressed,
                      saving && styles.btnDisabled,
                    ]}
                  >
                    {saving ? (
                      <ActivityIndicator color="#0f172a" />
                    ) : (
                      <Text style={styles.modalSaveBtnText}>Save preset</Text>
                    )}
                  </Pressable>
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
  flex: { flex: 1, zIndex: 2 },
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
  scroll: { flex: 1, backgroundColor: 'transparent' },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 32,
    flexGrow: 1,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  titleBlock: { flex: 1, minWidth: 0 },
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
  demoSettingsBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderWidth: 1,
    borderColor: 'rgba(226,232,240,0.95)',
  },
  demoSettingsBtnPressed: { opacity: 0.88 },
  demoSettingsBtnText: { fontSize: 13, fontWeight: '800', color: '#0f766e', textAlign: 'center' },
  subtitle: {
    marginTop: 6,
    fontSize: 13,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.9)',
    textShadowColor: 'rgba(15, 23, 42, 0.45)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },
  hint: {
    marginTop: 10,
    fontSize: 13,
    fontWeight: '600',
    color: '#e0f2fe',
    lineHeight: 18,
    textShadowColor: 'rgba(15, 23, 42, 0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  loader: { marginTop: 24 },
  card: {
    marginTop: 14,
    backgroundColor: 'rgba(255,255,255,0.92)',
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    gap: 10,
  },
  presetSummaryLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: '#475569',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  presetSummaryText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0f172a',
    lineHeight: 22,
  },
  btnPrimary: {
    marginTop: 4,
    backgroundColor: '#0284c7',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  btnPressed: { opacity: 0.88 },
  btnDisabled: { opacity: 0.55 },
  btnPrimaryText: { color: '#fff', fontSize: 16, fontWeight: '800' },
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
    backgroundColor: 'rgba(255, 255, 255, 0.98)',
    borderRadius: 22,
    paddingHorizontal: 18,
    paddingTop: 18,
    borderWidth: 1,
    borderColor: 'rgba(226, 232, 240, 0.95)',
    maxHeight: '88%',
  },
  modalScroll: { maxHeight: '100%' },
  modalScrollContent: {
    paddingBottom: 28,
    flexGrow: 1,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#020617',
    letterSpacing: -0.4,
    lineHeight: 26,
    flexShrink: 1,
  },
  modalSubtitle: {
    marginTop: 8,
    marginBottom: 2,
    fontSize: 13,
    fontWeight: '600',
    color: '#64748b',
    lineHeight: 20,
    flexShrink: 1,
    alignSelf: 'stretch',
  },
  controlsCard: {
    marginTop: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.94)',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(226, 232, 240, 0.95)',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 2,
  },
  modalControlsCard: { marginTop: 12 },
  modalFieldLabel: {
    marginTop: 2,
    fontSize: 13,
    fontWeight: '700',
    color: '#0f172a',
    lineHeight: 18,
    alignSelf: 'stretch',
  },
  modalFieldLabelSpaced: {
    marginTop: 14,
    fontSize: 13,
    fontWeight: '700',
    color: '#0f172a',
    lineHeight: 18,
    alignSelf: 'stretch',
  },
  modalPlaceholderHelp: {
    marginTop: 6,
    marginBottom: 8,
    fontSize: 12,
    fontWeight: '600',
    color: '#64748b',
    lineHeight: 18,
    alignSelf: 'stretch',
  },
  modalInput: {
    marginTop: 6,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    fontWeight: '600',
    color: '#0f172a',
    backgroundColor: '#fff',
  },
  modalTextArea: {
    minHeight: 100,
    textAlignVertical: 'top',
  },
  modalSaveBtn: {
    marginTop: 16,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    backgroundColor: '#e2e8f0',
  },
  modalSaveBtnPressed: { opacity: 0.9 },
  modalSaveBtnText: { fontSize: 15, fontWeight: '800', color: '#0f172a' },
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
});
