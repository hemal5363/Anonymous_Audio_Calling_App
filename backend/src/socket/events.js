/**
 * Socket.IO Real-Time Event Names
 * Exactly as defined in docs/API_SPEC.md and docs/CALL_FLOW.md
 */
export const SOCKET_EVENTS = {
  // Presence & Setup
  PRESENCE_HELLO: 'presence:hello',

  // Call Negotiation & Signaling
  CALL_FIND: 'call:find',
  CALL_REQUEST: 'call:request',
  CALL_RINGING: 'call:ringing',
  CALL_INCOMING: 'call:incoming',
  CALL_ACCEPT: 'call:accept',
  CALL_DECLINE: 'call:decline',
  CALL_REJECT: 'call:reject',
  CALL_NONE_AVAILABLE: 'call:none-available',
  NO_USERS_AVAILABLE: 'no_users_available',
  CALL_MATCHED: 'call:matched',
  CALL_ERROR: 'call:error',

  // WebRTC Signaling Relays
  SIGNAL_OFFER: 'signal:offer',
  SIGNAL_ANSWER: 'signal:answer',
  SIGNAL_ICE: 'signal:ice',

  // In-Call Lifecycle & In-Call Actions
  CALL_CONNECTED: 'call:connected',
  CALL_SKIP: 'call:skip',
  CALL_MUTE: 'call:mute',
  PEER_MUTE: 'peer:mute',
  CALL_REPORT: 'call:report',
  CALL_BLOCK: 'call:block',
  BILLING_WARNING: 'billing:warning',
  BILLING_BALANCE: 'billing:balance',
  CALL_END: 'call:end',
  CALL_ENDED: 'call:ended',
};
