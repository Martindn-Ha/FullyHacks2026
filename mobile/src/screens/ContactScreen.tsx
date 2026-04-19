import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SMS from 'expo-sms';
import type { SMSResponse } from 'expo-sms';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
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
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCgmSession } from '../context/CgmSessionContext';
import PopBubbleSvg from '../../assets/popbubble.svg';

/** Debug: keep pop art visible instead of only while pressed. Set `false` before shipping. */
const DEBUG_STICKY_POPBUBBLE_SVG = false;

/** After MFMessageCompose returns, iOS still animates the sheet away — hold pop art through that fade. */
const IOS_SMS_DISMISS_HOLD_MS = 450;

/**
 * Android: brief delay after closing the symptom sheet before `SMS.sendSMSAsync` so layout settles.
 * iOS: prefer `Modal.onDismiss` instead of this timeout — the native modal can still be on-screen for
 * hundreds of ms after `visible={false}`; presenting MFMessageCompose too early hangs the UI.
 */
const SMS_AFTER_MODAL_MS = 320;

/** `SMS.isAvailableAsync()` can hang on some builds; do not leave the UI spinning with no feedback. */
const SMS_IS_AVAILABLE_TIMEOUT_MS = 15_000;

function withTimeout<T>(promise: Promise<T>, ms: number, timeoutMessage: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = setTimeout(() => reject(new Error(timeoutMessage)), ms);
    promise.then(
      (v) => {
        clearTimeout(id);
        resolve(v);
      },
      (e) => {
        clearTimeout(id);
        reject(e);
      },
    );
  });
}

/** AsyncStorage should be instant; if the bridge stalls, still show the screen. */
const HYDRATE_STORAGE_SAFETY_MS = 4000;

const SYMPTOM_OPTIONS = [
  'Shaky / sweating',
  'Nausea',
  'Headache',
  'Dizziness',
  'Very thirsty',
  'Confusion / brain fog',
  'Fatigue',
  'Stomach pain',
  'Short of breath',
] as const;

const seafloorBackground = require('../../assets/seafloor.png');
const seaTurtlePng = require('../../assets/seaturtle.png');
const bubblePng = require('../../assets/bubblr.png');

const STORAGE_PHONE = '@tideTogether/smsPresetPhone';
const STORAGE_TEMPLATE = '@tideTogether/smsPresetTemplate';
const STORAGE_LABEL = '@tideTogether/smsPresetLabel';

const DEFAULT_TEMPLATE = `This is an automated check-in from Tide Together.

Name on file:
{{name}}

Glucose (mg/dL):
{{glucose}}

Trend:
{{trend}}

Sent at:
{{time}}

Coordinates:
{{coordinates}}

If you are able to, please check in with me. Thank you.`;

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

/**
 * iOS native ExpoSMS allows only one MFMessageCompose at a time; overlapping `sendSMSAsync` rejects with
 * "SMS sending in progress…". Chain calls so each send waits for the previous composer to finish.
 */
let smsNativeSendTail: Promise<unknown> = Promise.resolve();

/**
 * One native composer at a time. Each call waits for the previous `sendSMSAsync` promise to settle (success,
 * cancel, error, or reject). Do not wrap the native call in a shorter `Promise.race` timeout — that can reject while
 * iOS still holds the composer open, which either deadlocks the queue (if you then `await` the native promise
 * forever) or surfaces “SMS sending in progress” on the next attempt.
 */
function enqueueSendSMSAsync(addresses: string[], message: string): Promise<SMSResponse> {
  const op: Promise<SMSResponse> = smsNativeSendTail.catch(() => {}).then(() =>
    SMS.sendSMSAsync(addresses, message),
  );
  smsNativeSendTail = op.then(
    () => undefined,
    () => undefined,
  );
  return op;
}

export function ContactScreen() {
  const insets = useSafeAreaInsets();
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  const { displayMgdl, trend, lat, lng } = useCgmSession();

  const [demoSettingsOpen, setDemoSettingsOpen] = useState(false);
  const [presetLabel, setPresetLabel] = useState('');
  const [presetPhone, setPresetPhone] = useState('');
  const [messageTemplate, setMessageTemplate] = useState(DEFAULT_TEMPLATE);
  const [hydrated, setHydrated] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [postIosSmsPop, setPostIosSmsPop] = useState(false);
  const postIosSmsPopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [symptomPickerOpen, setSymptomPickerOpen] = useState(false);
  const [selectedSymptoms, setSelectedSymptoms] = useState<string[]>([]);
  const selectedSymptomsRef = useRef<string[]>([]);
  /** Prevents double Done / Cancel while the symptom sheet is closing. */
  const symptomSheetActionRef = useRef(false);
  const smsAfterModalTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSmsSymptomsRef = useRef<string[] | null>(null);
  /** iOS: which follow-up to run in `Modal.onDismiss` after the symptom sheet fully unmounts. */
  const symptomPickerCloseKindRef = useRef<'sms' | 'cancel' | null>(null);

  const [smsWarmupAfterPicker, setSmsWarmupAfterPicker] = useState(false);

  useEffect(() => {
    selectedSymptomsRef.current = selectedSymptoms;
  }, [selectedSymptoms]);

  useEffect(() => {
    return () => {
      if (postIosSmsPopTimerRef.current) {
        clearTimeout(postIosSmsPopTimerRef.current);
      }
      if (smsAfterModalTimeoutRef.current) {
        clearTimeout(smsAfterModalTimeoutRef.current);
        smsAfterModalTimeoutRef.current = null;
      }
      setSmsWarmupAfterPicker(false);
    };
  }, []);

  const clearPendingSmsAfterModal = useCallback(() => {
    if (smsAfterModalTimeoutRef.current) {
      clearTimeout(smsAfterModalTimeoutRef.current);
      smsAfterModalTimeoutRef.current = null;
    }
    pendingSmsSymptomsRef.current = null;
    setSmsWarmupAfterPicker(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const safety = setTimeout(() => {
      if (!cancelled) setHydrated(true);
    }, HYDRATE_STORAGE_SAFETY_MS);
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
        clearTimeout(safety);
        if (!cancelled) setHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
      clearTimeout(safety);
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

  const sendAutomatedText = useCallback(
    async (extraSymptoms: string[] = []) => {
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
    const latStr = coordsOk ? la.toFixed(5) : 'unavailable';
    const lngStr = coordsOk ? lo.toFixed(5) : 'unavailable';
    const coordinates = coordsOk ? `${latStr}, ${lngStr}` : 'unavailable';
    const nameStr = presetLabel.trim() || 'not set';

    let body = applyTemplate(tpl, {
      name: nameStr,
      glucose: String(Math.round(displayMgdl)),
      trend: trend || '—',
      time: new Date().toLocaleString(),
      lat: latStr,
      lng: lngStr,
      coordinates,
    });
    const trimmed = extraSymptoms.map((s) => s.trim()).filter(Boolean);
    if (trimmed.length > 0) {
      body +=
        '\n\n---\nAdditional context (symptoms selected):\n' + trimmed.map((s) => `• ${s}`).join('\n');
    }

    let openedComposer = false;
    try {
      const available = await withTimeout(
        SMS.isAvailableAsync(),
        SMS_IS_AVAILABLE_TIMEOUT_MS,
        'SMS availability check timed out. Try again, or restart the app if this keeps happening.',
      );
      if (!available) {
        Alert.alert(
          'SMS not available',
          Platform.OS === 'ios'
            ? 'SMS does not work in the iOS Simulator. Use a physical iPhone, or try again on a device with the Messages app.'
            : 'This device cannot send SMS from the app.',
        );
        return;
      }

      if (postIosSmsPopTimerRef.current) {
        clearTimeout(postIosSmsPopTimerRef.current);
        postIosSmsPopTimerRef.current = null;
      }
      setPostIosSmsPop(false);
      setSending(true);
      openedComposer = true;
      let result: SMSResponse['result'];
      try {
        ({ result } = await enqueueSendSMSAsync([to], body));
      } catch (first) {
        const m = first instanceof Error ? first.message : String(first);
        if (/sending in progress|in progress/i.test(m)) {
          await new Promise((r) => setTimeout(r, 600));
          ({ result } = await enqueueSendSMSAsync([to], body));
        } else {
          throw first;
        }
      }
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
      if (postIosSmsPopTimerRef.current) {
        clearTimeout(postIosSmsPopTimerRef.current);
        postIosSmsPopTimerRef.current = null;
      }
      if (openedComposer && Platform.OS === 'ios') {
        setPostIosSmsPop(true);
        postIosSmsPopTimerRef.current = setTimeout(() => {
          postIosSmsPopTimerRef.current = null;
          setPostIosSmsPop(false);
        }, IOS_SMS_DISMISS_HOLD_MS);
      } else {
        setPostIosSmsPop(false);
      }
    }
  },
    [presetPhone, messageTemplate, presetLabel, displayMgdl, trend, lat, lng],
  );

  const handleSymptomPickerDismissed = useCallback(() => {
    const kind = symptomPickerCloseKindRef.current;
    symptomPickerCloseKindRef.current = null;
    if (kind === 'sms') {
      const payload = pendingSmsSymptomsRef.current;
      pendingSmsSymptomsRef.current = null;
      void (async () => {
        try {
          if (payload != null) {
            await sendAutomatedText(payload);
          }
        } finally {
          setSmsWarmupAfterPicker(false);
          symptomSheetActionRef.current = false;
        }
      })();
    } else if (kind === 'cancel') {
      symptomSheetActionRef.current = false;
    }
    /* kind === null: no-op — do not clear `symptomSheetActionRef` here; the `'sms'` path clears it in `finally`. */
  }, [sendAutomatedText]);

  const commitSymptomsAndSend = useCallback(() => {
    if (symptomSheetActionRef.current) return;
    symptomSheetActionRef.current = true;
    const symptoms = [...selectedSymptomsRef.current];
    clearPendingSmsAfterModal();
    pendingSmsSymptomsRef.current = symptoms;
    symptomPickerCloseKindRef.current = 'sms';
    setSmsWarmupAfterPicker(true);
    setSymptomPickerOpen(false);
    if (Platform.OS === 'android') {
      smsAfterModalTimeoutRef.current = setTimeout(() => {
        smsAfterModalTimeoutRef.current = null;
        handleSymptomPickerDismissed();
      }, SMS_AFTER_MODAL_MS);
    }
  }, [clearPendingSmsAfterModal, handleSymptomPickerDismissed]);

  const cancelSymptomPicker = useCallback(() => {
    if (symptomSheetActionRef.current) return;
    symptomSheetActionRef.current = true;
    clearPendingSmsAfterModal();
    if (Platform.OS === 'ios') {
      symptomPickerCloseKindRef.current = 'cancel';
    }
    setSymptomPickerOpen(false);
  }, [clearPendingSmsAfterModal]);

  const openSymptomPicker = useCallback(() => {
    const to = normalizePhoneForSms(presetPhone);
    if (!to || to.replace(/\D/g, '').length < 10) {
      Alert.alert(
        'Phone number',
        'Open Demo settings (top right), enter a valid number, and tap Save preset.',
      );
      return;
    }
    symptomSheetActionRef.current = false;
    setSelectedSymptoms([]);
    selectedSymptomsRef.current = [];
    symptomPickerCloseKindRef.current = null;
    clearPendingSmsAfterModal();
    setSymptomPickerOpen(true);
  }, [presetPhone, clearPendingSmsAfterModal]);

  const toggleSymptom = useCallback((label: string) => {
    setSelectedSymptoms((prev) => (prev.includes(label) ? prev.filter((x) => x !== label) : [...prev, label]));
  }, []);

  const presetSummary =
    presetPhone.trim().length > 0
      ? `${presetLabel.trim() || 'Contact'} · ${presetPhone.trim()}`
      : 'No preset number yet — open Demo settings.';

  const bubbleW = Math.min(320, Math.max(220, windowWidth - 56));
  const bubbleH = Math.round(bubbleW * 0.72);

  return (
    <ImageBackground
      source={seafloorBackground}
      style={[styles.screen, { paddingTop: insets.top }]}
      resizeMode="cover"
    >
      <StatusBar style="light" />
      <View pointerEvents="none" style={styles.gifDecorLayer} accessibilityElementsHidden>
        <Image source={seaTurtlePng} style={styles.seaTurtleDecor} resizeMode="contain" />
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
            Tap the bubble to optionally add symptoms, then tap Done on that sheet. Messages opens with your filled-in
            template so you can review and tap Send. Apps cannot send SMS in the background.
          </Text>

          {!hydrated ? (
            <ActivityIndicator color="#0ea5e9" style={styles.loader} />
          ) : (
            <>
              <View style={styles.card}>
                <Text style={styles.presetSummaryLabel}>Current preset</Text>
                <Text style={styles.presetSummaryText}>{presetSummary}</Text>
              </View>
              <View
                style={[
                  styles.sendCircleArea,
                  { minHeight: Math.max(200, Math.round(windowHeight * 0.36)) },
                ]}
              >
                <View style={styles.sendBubbleOuter}>
                  <Pressable
                    onPress={openSymptomPicker}
                    disabled={sending || postIosSmsPop || symptomPickerOpen || smsWarmupAfterPicker}
                    style={({ pressed }) => [
                      styles.sendBubblePress,
                      pressed && styles.btnPressed,
                      (sending || postIosSmsPop || symptomPickerOpen || smsWarmupAfterPicker) &&
                        styles.btnDisabled,
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel="Send alert SMS"
                  >
                    {({ pressed }) => (
                      <View style={[styles.sendBubbleFrame, { width: bubbleW, height: bubbleH }]}>
                        {DEBUG_STICKY_POPBUBBLE_SVG ||
                        pressed ||
                        sending ||
                        postIosSmsPop ||
                        symptomPickerOpen ||
                        smsWarmupAfterPicker ? (
                          <PopBubbleSvg
                            width={bubbleW}
                            height={bubbleH}
                            viewBox="0 0 640 560"
                            preserveAspectRatio="xMidYMid meet"
                            style={[styles.sendBubbleImage, { width: bubbleW, height: bubbleH }]}
                            accessibilityElementsHidden
                          />
                        ) : (
                          <Image
                            source={bubblePng}
                            style={[styles.sendBubbleImage, { width: bubbleW, height: bubbleH }]}
                            resizeMode="contain"
                            accessibilityElementsHidden
                          />
                        )}
                        <View style={styles.sendBubbleTextShell} pointerEvents="none">
                          {sending || smsWarmupAfterPicker ? (
                            <ActivityIndicator color="#0e7490" size="large" />
                          ) : symptomPickerOpen ? (
                            <Text style={styles.sendBubbleText}>Add context…</Text>
                          ) : (
                            <Text style={styles.sendBubbleText}>
                              Send alert{'\n'}SMS
                            </Text>
                          )}
                        </View>
                      </View>
                    )}
                  </Pressable>
                </View>
              </View>
            </>
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
                    {
                      'Short codes in double braces are filled in when you send. You can move or reword them anywhere in your message:'
                    }
                    {'\n\n'}
                    {'{{name}}\ncontact name from above\n'}
                    {'{{glucose}}\ncurrent reading (mg/dL)\n'}
                    {'{{trend}}\nup / down / steady\n'}
                    {'{{time}}\nwhen you tapped Send\n'}
                    {'{{coordinates}}\nlatitude and longitude together (decimal degrees)'}
                  </Text>
                  <Pressable
                    onPress={() => setMessageTemplate(DEFAULT_TEMPLATE)}
                    style={({ pressed }) => [styles.useDefaultLink, pressed && styles.useDefaultLinkPressed]}
                    accessibilityRole="button"
                    accessibilityLabel="Replace message with default multi-line template"
                  >
                    <Text style={styles.useDefaultLinkText}>Use default layout</Text>
                  </Pressable>
                  <TextInput
                    value={messageTemplate}
                    onChangeText={setMessageTemplate}
                    placeholder="Write your message here. Use {{glucose}} and other codes where you want live values."
                    placeholderTextColor="#94a3b8"
                    style={styles.modalMessageTemplateInput}
                    multiline
                    scrollEnabled
                    textAlignVertical="top"
                    autoCorrect
                    spellCheck
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

      <Modal
        visible={symptomPickerOpen}
        animationType="fade"
        transparent
        onRequestClose={cancelSymptomPicker}
        onDismiss={Platform.OS === 'ios' ? handleSymptomPickerDismissed : undefined}
      >
        <View style={[styles.symptomModalRoot, { paddingTop: insets.top + 12, paddingBottom: Math.max(insets.bottom, 16) }]}>
          <Pressable
            style={styles.modalBackdrop}
            onPress={cancelSymptomPicker}
            accessibilityRole="button"
            accessibilityLabel="Cancel and close symptom picker"
          />
          <View style={styles.symptomSheet}>
            <Text style={styles.symptomSheetTitle}>Add context?</Text>
            <Text style={styles.symptomSheetSubtitle}>
              Tap any symptoms that apply, then tap Done. The Messages sheet opens next so you can review and tap Send.
            </Text>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              style={styles.symptomChipScroll}
              contentContainerStyle={styles.symptomChipScrollContent}
            >
              <View style={styles.symptomChipWrap}>
                {SYMPTOM_OPTIONS.map((label) => {
                  const on = selectedSymptoms.includes(label);
                  return (
                    <Pressable
                      key={label}
                      onPress={() => toggleSymptom(label)}
                      style={({ pressed }) => [
                        styles.symptomChip,
                        on && styles.symptomChipOn,
                        pressed && styles.symptomChipPressed,
                      ]}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: on }}
                      accessibilityLabel={label}
                    >
                      <Text style={[styles.symptomChipText, on && styles.symptomChipTextOn]}>{label}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </ScrollView>
            <View style={styles.symptomActions}>
              <Pressable
                onPress={cancelSymptomPicker}
                style={({ pressed }) => [styles.symptomSecondaryBtn, pressed && styles.symptomSecondaryBtnPressed]}
                accessibilityRole="button"
                accessibilityLabel="Cancel send"
              >
                <Text style={styles.symptomSecondaryBtnText}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={commitSymptomsAndSend}
                style={({ pressed }) => [styles.symptomPrimaryBtn, pressed && styles.symptomPrimaryBtnPressed]}
                accessibilityRole="button"
                accessibilityLabel="Done and open Messages"
              >
                <Text style={styles.symptomPrimaryBtnText}>Done</Text>
              </Pressable>
            </View>
          </View>
        </View>
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
  seaTurtleDecor: {
    position: 'absolute',
    bottom: '14%',
    left: 70,
    width: 72,
    height: 72,
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
  /** Fills remaining scroll height so the send control sits centered on screen below the card. */
  sendCircleArea: {
    flexGrow: 1,
    alignSelf: 'stretch',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 16,
  },
  /** Negative margin nudges the bubble upward vs true vertical center of `sendCircleArea`. */
  sendBubbleOuter: {
    alignItems: 'center',
    marginTop: -150,
  },
  sendBubblePress: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBubbleFrame: {
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 14,
    elevation: 8,
  },
  sendBubbleImage: {
    position: 'absolute',
    left: 6,
    top: 0,
  },
  sendBubbleTextShell: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
    paddingVertical: 24,
  },
  sendBubbleText: {
    textAlign: 'center',
    fontSize: 17,
    fontWeight: '800',
    color: '#0f172a',
    lineHeight: 22,
    letterSpacing: -0.2,
    textShadowColor: 'rgba(255,255,255,0.75)',
    textShadowOffset: { width: 0, height: 0.5 },
    textShadowRadius: 6,
  },
  btnPressed: { opacity: 0.88 },
  btnDisabled: { opacity: 0.55 },
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
  /** Multiline: explicit lineHeight avoids lines drawing on top of each other (esp. iOS). */
  modalMessageTemplateInput: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 14,
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '500',
    color: '#0f172a',
    backgroundColor: '#fff',
    minHeight: 280,
    textAlignVertical: 'top',
    ...(Platform.OS === 'android' ? { includeFontPadding: false } : {}),
  },
  useDefaultLink: {
    alignSelf: 'flex-start',
    marginTop: 4,
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  useDefaultLinkPressed: { opacity: 0.75 },
  useDefaultLinkText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0284c7',
    textDecorationLine: 'underline',
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
  symptomModalRoot: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  symptomSheet: {
    width: '100%',
    maxWidth: 400,
    alignSelf: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.98)',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(226, 232, 240, 0.95)',
    maxHeight: '86%',
  },
  symptomSheetTitle: {
    fontSize: 19,
    fontWeight: '800',
    color: '#020617',
    letterSpacing: -0.3,
  },
  symptomSheetSubtitle: {
    marginTop: 8,
    fontSize: 13,
    fontWeight: '600',
    color: '#64748b',
    lineHeight: 19,
  },
  symptomChipScroll: { marginTop: 16, maxHeight: 280 },
  symptomChipScrollContent: { paddingBottom: 8 },
  symptomChipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  symptomChip: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  symptomChipOn: {
    backgroundColor: '#cffafe',
    borderColor: '#22d3ee',
  },
  symptomChipPressed: { opacity: 0.88 },
  symptomChipText: { fontSize: 14, fontWeight: '700', color: '#334155' },
  symptomChipTextOn: { color: '#0e7490' },
  symptomActions: {
    marginTop: 16,
    flexDirection: 'row',
    gap: 10,
    alignItems: 'stretch',
  },
  symptomSecondaryBtn: {
    flex: 1,
    paddingVertical: 14,
    alignItems: 'center',
    borderRadius: 14,
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  symptomSecondaryBtnPressed: { opacity: 0.9 },
  symptomSecondaryBtnText: { fontSize: 15, fontWeight: '800', color: '#475569' },
  symptomPrimaryBtn: {
    flex: 1,
    paddingVertical: 14,
    alignItems: 'center',
    borderRadius: 14,
    backgroundColor: '#0ea5e9',
  },
  symptomPrimaryBtnPressed: { opacity: 0.92 },
  symptomPrimaryBtnText: { fontSize: 15, fontWeight: '800', color: '#ffffff' },
});
