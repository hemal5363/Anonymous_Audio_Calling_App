import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';
import { Platform, Alert } from 'react-native';
import { api } from '../api/client';
import { isSocketConnectedState, connectSocket, getSocket } from '../socket';
import { tokenStorage } from '../auth/tokenStorage';
import { getLatestPublicConfig } from '../config/publicConfig';

const PUSH_TOKEN_CACHE_KEY = 'ANON_AUDIO_PUSH_TOKEN';
const CHANNEL_ID = 'incoming_calls';

// ---------------------------------------------------------------------------
// 1. Android Notification Channel Setup
// ---------------------------------------------------------------------------

/**
 * Creates the Android notification channel "incoming_calls" FIRST:
 * importance MAX, vibration, default sound, lockscreen visibility public.
 */
export async function setupNotificationChannel(): Promise<void> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: 'Incoming Calls',
      description: 'Alerts and rings for incoming audio calls',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      sound: 'default',
      enableVibrate: true,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      bypassDnd: true,
      showBadge: true,
    });
  }
}

// Ensure notification channel is configured immediately on load
setupNotificationChannel().catch(() => {});

// ---------------------------------------------------------------------------
// 2. Foreground Notification Handler
// ---------------------------------------------------------------------------

/**
 * Foreground notification behavior:
 * If the app is open and connected by socket, do NOT show a system notification
 * (the in-app incoming call screen already appears via socket).
 */
Notifications.setNotificationHandler({
  handleNotification: async () => {
    const isConnected = isSocketConnectedState();
    return {
      shouldShowAlert: !isConnected,
      shouldPlaySound: !isConnected,
      shouldSetBadge: false,
      shouldShowBanner: !isConnected,
      shouldShowList: !isConnected,
    };
  },
});

// ---------------------------------------------------------------------------
// 3. Permission & Token Management
// ---------------------------------------------------------------------------

/**
 * Checks current notification permission status without prompting
 */
export async function checkNotificationPermission(): Promise<boolean> {
  try {
    const settings = await Notifications.getPermissionsAsync();
    return Boolean(
      settings.granted || settings.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL
    );
  } catch {
    return false;
  }
}

/**
 * Prompts user for notification permission after login.
 * Explains why in a short message before presenting the system prompt.
 * If denied, the app still works, and caller can inspect the return boolean.
 */
export async function requestNotificationPermission(): Promise<boolean> {
  try {
    const existing = await Notifications.getPermissionsAsync();
    if (existing.granted || existing.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL) {
      return true;
    }

    // Explain why in a short message before the system prompt
    await new Promise<void>((resolve) => {
      Alert.alert(
        'Incoming Call Notifications',
        'Anonymous Audio Calling needs notification permission so your phone rings when someone calls you while the app is in the background or closed.',
        [
          {
            text: 'Continue',
            onPress: () => resolve(),
          },
        ],
        { cancelable: false }
      );
    });

    const requested = await Notifications.requestPermissionsAsync();
    return Boolean(
      requested.granted || requested.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL
    );
  } catch {
    return false;
  }
}

function getEasProjectId(): string | undefined {
  return (
    Constants.expoConfig?.extra?.eas?.projectId ??
    (Constants as any).easConfig?.projectId
  );
}

/**
 * Retrieves the Expo push token with the EAS projectId and saves it to the backend.
 * Re-sends it if it changed. Only executes on a real device.
 * Never logs the token to the console.
 */
export async function registerPushToken(): Promise<string | null> {
  if (!Device.isDevice) {
    return null;
  }

  const hasPermission = await checkNotificationPermission();
  if (!hasPermission) {
    return null;
  }

  const projectId = getEasProjectId();
  if (!projectId) {
    return null;
  }

  try {
    const tokenObj = await Notifications.getExpoPushTokenAsync({
      projectId,
    });
    const token = tokenObj?.data;
    if (!token) {
      return null;
    }

    const cachedToken = await SecureStore.getItemAsync(PUSH_TOKEN_CACHE_KEY);
    if (token !== cachedToken) {
      await api.post('/user/push-token', { push_token: token });
      await SecureStore.setItemAsync(PUSH_TOKEN_CACHE_KEY, token);
    }

    return token;
  } catch (err) {
    return null;
  }
}

/**
 * Removes the push token from backend and local cache upon logout.
 */
export async function unregisterPushToken(): Promise<void> {
  try {
    await api.delete('/user/push-token');
  } catch {
    // Ignore backend deletion errors during logout
  } finally {
    try {
      await SecureStore.deleteItemAsync(PUSH_TOKEN_CACHE_KEY);
    } catch {}
  }
}

// ---------------------------------------------------------------------------
// 4. Notification Response Handling (Tap & Cold Start)
// ---------------------------------------------------------------------------

export type IncomingCallCallback = (session: {
  callCode: string;
  sessionId: string;
  ringSeconds: number;
}) => void;

/**
 * Handles tapping an incoming call notification from background or cold start.
 * Reads data.sessionId and data.type == "incoming_call", waits for login and socket,
 * queries backend for that session, and opens incoming call screen if still ringing.
 * Otherwise alerts "Call already ended".
 */
export async function handleNotificationData(
  data: any,
  onIncomingCall: IncomingCallCallback
): Promise<void> {
  if (!data || data.type !== 'incoming_call' || !data.sessionId) {
    return;
  }

  const sessionId = String(data.sessionId);

  // 1. Wait for login / token to be ready
  let token = await tokenStorage.getAccessToken();
  let attempts = 0;
  while (!token && attempts < 10) {
    await new Promise((resolve) => setTimeout(resolve, 300));
    token = await tokenStorage.getAccessToken();
    attempts++;
  }

  if (!token) {
    Alert.alert('Call Unavailable', 'Call already ended', [{ text: 'OK' }]);
    return;
  }

  // 2. Ensure socket connection
  await connectSocket().catch(() => {});

  // 3. Ask backend for session state (returns only status field)
  try {
    const res = await api.get<{
      status: string;
      error?: string;
    }>(`/calls/session/${sessionId}`);

    if (res?.status === 'ringing') {
      const socket = getSocket();
      if (socket) {
        socket.emit('call:pending', (pendingRes: any) => {
          if (pendingRes?.hasPendingCall && pendingRes?.session) {
            onIncomingCall({
              callCode: pendingRes.session.callCode,
              sessionId: pendingRes.session.sessionId,
              ringSeconds:
                pendingRes.session.ringSeconds ||
                getLatestPublicConfig().calls.ring_timeout_seconds,
            });
          }
        });
      }
    } else {
      Alert.alert('Call Unavailable', 'Call already ended', [{ text: 'OK' }]);
    }
  } catch (err) {
    Alert.alert('Call Unavailable', 'Call already ended', [{ text: 'OK' }]);
  }
}
