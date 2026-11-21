import { logger } from '../utils/logger.js';

/**
 * Service to dispatch incoming call wake-up push notifications.
 * When FCM credentials and firebase-admin are integrated in a later phase,
 * this function will dispatch high-priority FCM data messages.
 * For now, in development/MVP, it logs to the server console.
 *
 * @param {string} pushToken - Callee device push token (e.g. FCM token)
 * @param {string} sessionId - Call session UUID / identifier
 * @returns {Promise<{success: boolean, pushToken?: string, sessionId?: string, reason?: string, payload?: object}>}
 */
export async function sendIncomingCallPush(pushToken, sessionId) {
  if (!pushToken) {
    logger.warn(`[Push Service] Cannot send push notification: missing pushToken for session ${sessionId}`);
    return { success: false, reason: 'missing_push_token' };
  }

  const payload = {
    message: {
      token: pushToken,
      android: {
        priority: 'high',
        ttl: '30s',
      },
      data: {
        type: 'incoming_call',
        sessionId: String(sessionId),
        ringSeconds: '30',
      },
    },
  };

  logger.info(
    `[FCM Push] Dispatched incoming call push notification for session ${sessionId} to token: ${pushToken}`
  );
  logger.info(`[FCM Push Payload]\n${JSON.stringify(payload, null, 2)}`);

  return {
    success: true,
    pushToken,
    sessionId,
    payload,
  };
}

export const pushService = {
  sendIncomingCallPush,
};
