import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

const ANDROID_SPIKE_CHANNEL_ID = 'spike-prediction';

export async function ensureSpikeNotificationSetup(): Promise<boolean> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(ANDROID_SPIKE_CHANNEL_ID, {
      name: 'Spike alerts',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  const existing = await Notifications.getPermissionsAsync();
  if (existing.status === 'granted') return true;
  const requested = await Notifications.requestPermissionsAsync();
  return requested.status === 'granted';
}

export async function presentSpikePredictionNotification(params: {
  predictedMaxMgDl: number;
  horizonMinutes: number | null;
}): Promise<void> {
  const horizonLabel =
    params.horizonMinutes != null && Number.isFinite(params.horizonMinutes)
      ? `${Math.round(params.horizonMinutes)} minutes`
      : 'the forecast window';

  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Glucose spike predicted',
      body: `The model predicts a high near ${Math.round(params.predictedMaxMgDl)} mg/dL within about ${horizonLabel}. Open the app to review your recommendations.`,
      sound: true,
      ...(Platform.OS === 'android' ? { channelId: ANDROID_SPIKE_CHANNEL_ID } : {}),
    },
    trigger: null,
  });
}
