import { Expo } from 'expo-server-sdk';
import { pool } from '../db/index.js';
import { logger } from '../utils/logger.js';

// Initialize Expo SDK client
export const expo = new Expo();

/**
 * Removes an invalid or unregistered push token from the database.
 * Never logs the token itself to protect user privacy.
 *
 * @param {string} pushToken
 */
export async function clearPushToken(pushToken) {
  if (!pushToken) return;

  try {
    await pool.query(
      `UPDATE users
       SET push_token = NULL, updated_at = CURRENT_TIMESTAMP
       WHERE push_token = $1;`,
      [pushToken]
    );
    logger.info('[Push Service] Cleared unregistered push token from database');
  } catch (err) {
    logger.error('[Push Service] Failed to clear push token from database:', err.message);
  }
}

/**
 * Checks push notification receipts and removes any tokens that returned DeviceNotRegistered.
 *
 * @param {string} receiptId - The receipt ID from a successful push ticket
 * @param {string} pushToken - The token associated with this ticket
 */
export async function checkReceipt(receiptId, pushToken) {
  try {
    const receiptIdChunks = expo.chunkPushNotificationReceiptIds([receiptId]);
    for (const chunk of receiptIdChunks) {
      const receipts = await expo.getPushNotificationReceiptsAsync(chunk);
      for (const id in receipts) {
        const receipt = receipts[id];
        if (receipt.status === 'error') {
          if (receipt.details?.error === 'DeviceNotRegistered') {
            logger.warn('[Push Service] Receipt status error DeviceNotRegistered. Removing token.');
            await clearPushToken(pushToken);
          } else {
            logger.warn('[Push Service] Receipt error:', receipt.message || receipt.details?.error);
          }
        }
      }
    }
  } catch (err) {
    logger.error('[Push Service] Error checking push notification receipt:', err.message);
  }
}

/**
 * Schedules a push notification receipt check a minute later.
 * Uses timer.unref() so background timers do not hang server or test runners.
 *
 * @param {string} receiptId
 * @param {string} pushToken
 * @param {number} delayMs (defaults to 60000ms / 1 minute)
 */
export function scheduleReceiptCheck(receiptId, pushToken, delayMs = 60000) {
  const timer = setTimeout(async () => {
    await checkReceipt(receiptId, pushToken);
  }, delayMs);

  if (timer && typeof timer.unref === 'function') {
    timer.unref();
  }
  return timer;
}

/**
 * Sends a high-priority incoming call wake-up push notification via Expo Push Service.
 *
 * Requirements:
 * - Validates with Expo.isExpoPushToken.
 * - Message: title "Incoming call", body "Someone wants to talk", sound "default",
 *   priority "high", channelId "incoming_calls", ttl 30 seconds (matching ring timeout),
 *   data { type: "incoming_call", sessionId }.
 * - Sent in a try/catch; never lets a push failure break call matching.
 * - Handles tickets: if ticket error is DeviceNotRegistered, clears token in DB.
 * - Schedules receipt check ~1 minute later and removes token if DeviceNotRegistered.
 * - Never logs tokens.
 *
 * @param {string} pushToken - Callee device push token
 * @param {string} sessionId - Call session UUID / identifier
 * @returns {Promise<{success: boolean, reason?: string, error?: string, tickets?: any[]}>}
 */
export async function sendIncomingCallPush(pushToken, sessionId) {
  if (!pushToken) {
    logger.warn(`[Push Service] Cannot send push notification: missing pushToken for session: ${sessionId}`);
    return { success: false, reason: 'missing_push_token' };
  }

  // 1. Validate push token with Expo.isExpoPushToken
  if (!Expo.isExpoPushToken(pushToken)) {
    logger.warn(`[Push Service] Invalid Expo push token format for session: ${sessionId}. Removing token.`);
    await clearPushToken(pushToken);
    return { success: false, reason: 'invalid_push_token' };
  }

  const message = {
    to: pushToken,
    sound: 'default',
    title: 'Incoming call',
    body: 'Someone wants to talk',
    priority: 'high',
    channelId: 'incoming_calls',
    ttl: 30, // 30 seconds matching ring timeout
    data: {
      type: 'incoming_call',
      sessionId: String(sessionId),
    },
  };

  try {
    const chunks = expo.chunkPushNotifications([message]);
    const tickets = [];

    for (const chunk of chunks) {
      try {
        const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
        tickets.push(...ticketChunk);

        for (const ticket of ticketChunk) {
          if (ticket.status === 'error') {
            if (ticket.details?.error === 'DeviceNotRegistered') {
              logger.warn(`[Push Service] Ticket error DeviceNotRegistered for session: ${sessionId}`);
              await clearPushToken(pushToken);
            } else {
              logger.warn(`[Push Service] Ticket error for session: ${sessionId}: ${ticket.message || ticket.details?.error}`);
            }
          } else if (ticket.status === 'ok' && ticket.id) {
            scheduleReceiptCheck(ticket.id, pushToken, 60000);
          }
        }
      } catch (chunkErr) {
        logger.error(`[Push Service] Error sending push chunk for session: ${sessionId}: ${chunkErr.message}`);
        return {
          success: false,
          error: chunkErr.message,
        };
      }
    }

    logger.info(`[Push Service] Dispatched incoming call push notification for session: ${sessionId}`);

    return {
      success: true,
      sessionId,
      tickets,
    };
  } catch (err) {
    logger.error(`[Push Service] Push failure for session: ${sessionId}: ${err.message}`);
    return {
      success: false,
      error: err.message,
    };
  }
}

export const pushService = {
  sendIncomingCallPush,
  clearPushToken,
  checkReceipt,
  scheduleReceiptCheck,
};
