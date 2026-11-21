import { io, Socket } from 'socket.io-client';
import { API_URL } from '../config';
import { tokenStorage } from '../auth/tokenStorage';

/**
 * Socket.IO event names matching backend implementation and docs/CALL_FLOW.md
 */
export const SOCKET_EVENTS = {
  PRESENCE_HELLO: 'presence:hello',
  CALL_FIND: 'call:find',
  CALL_REQUEST: 'call:request',
  CALL_RINGING: 'call:ringing',
  CALL_INCOMING: 'call:incoming',
  CALL_ACCEPT: 'call:accept',
  CALL_DECLINE: 'call:decline',
  CALL_REJECT: 'call:reject',
  CALL_MATCHED: 'call:matched',
  CALL_CONNECTED: 'call:connected',
  CALL_ENDED: 'call:ended',
  CALL_END: 'call:end',
  CALL_SKIP: 'call:skip',
  CALL_NONE_AVAILABLE: 'call:none-available',
  CALL_ERROR: 'call:error',
  CALL_MUTE: 'call:mute',
  PEER_MUTE: 'peer:mute',
  CALL_BLOCK: 'call:block',
  CALL_REPORT: 'call:report',
  SIGNAL_OFFER: 'signal:offer',
  SIGNAL_ANSWER: 'signal:answer',
  SIGNAL_ICE: 'signal:ice',
  BILLING_BALANCE: 'billing:balance',
  BILLING_WARNING: 'billing:warning',
} as const;

type StatusListener = (connected: boolean, error: string | null) => void;
const statusListeners = new Set<StatusListener>();

let socketInstance: Socket | null = null;
let isSocketConnected = false;
let lastSocketError: string | null = null;

function notifyListeners(connected: boolean, error: string | null = null) {
  isSocketConnected = connected;
  if (connected) {
    lastSocketError = null;
  } else if (error !== null) {
    lastSocketError = error;
  }
  statusListeners.forEach((listener) => {
    try {
      listener(connected, lastSocketError);
    } catch {
      // Ignore listener error
    }
  });
}

/**
 * Subscribe to socket connection state changes and error messages
 */
export function subscribeSocketStatus(listener: StatusListener): () => void {
  statusListeners.add(listener);
  // Immediately emit current state
  listener(isSocketConnected, lastSocketError);
  return () => {
    statusListeners.delete(listener);
  };
}

/**
 * Current synchronous socket connection state
 */
export function getIsSocketConnected(): boolean {
  return isSocketConnected && Boolean(socketInstance?.connected);
}

/**
 * Current socket connection error message (if any)
 */
export function getSocketError(): string | null {
  return lastSocketError;
}

/**
 * Establishes an authenticated WebSocket connection with the backend
 */
export async function connectSocket(): Promise<Socket | null> {
  const socketPath = '/socket.io';

  // Read access token after login (ensure it exists before connecting)
  const accessToken = await tokenStorage.getAccessToken();
  if (!accessToken) {
    const errorMsg = 'No access token available. Please log in before connecting socket.';
    console.warn('[Socket]', errorMsg);
    notifyListeners(false, errorMsg);
    return null;
  }

  const formattedToken = accessToken.startsWith('Bearer ') ? accessToken : `Bearer ${accessToken}`;

  console.log('[Socket] Initializing connection to URL:', API_URL);
  console.log('[Socket] Path:', socketPath);
  console.log('[Socket] Transports: ["websocket", "polling"]');
  console.log('[Socket] Token present, length:', accessToken.length);

  if (socketInstance) {
    // Update auth and headers on existing socket instance
    socketInstance.auth = { token: formattedToken };
    if ((socketInstance.io as any)?.opts) {
      (socketInstance.io as any).opts.extraHeaders = { Authorization: formattedToken };
      (socketInstance.io as any).opts.query = { token: formattedToken };
    }
    if (socketInstance.connected) {
      console.log('[Socket] Already connected with socket ID:', socketInstance.id);
      notifyListeners(true, null);
      return socketInstance;
    }
    console.log('[Socket] Existing socket was disconnected. Calling socket.connect()...');
    socketInstance.connect();
    return socketInstance;
  }

  // Create Socket.io client instance supporting both websocket and polling transports
  socketInstance = io(API_URL, {
    path: socketPath,
    transports: ['websocket', 'polling'], // Allow both websocket and polling
    autoConnect: false,
    auth: {
      token: formattedToken,
    },
    extraHeaders: {
      Authorization: formattedToken,
    },
    query: {
      token: formattedToken,
    },
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 20000,
  });

  socketInstance.on('connect', () => {
    console.log('[Socket] CONNECTED successfully! Socket ID:', socketInstance?.id);
    notifyListeners(true, null);
    // Send presence handshake upon connecting
    socketInstance?.emit(SOCKET_EVENTS.PRESENCE_HELLO);
  });

  socketInstance.on('presence:ack', (payload) => {
    console.log('[Socket] Presence acknowledged by server:', payload);
  });

  socketInstance.on('connect_error', (err: Error) => {
    const errorMsg = err?.message || 'Connection error';
    console.error('[Socket] CONNECT_ERROR:', errorMsg, err);
    notifyListeners(false, errorMsg);
  });

  socketInstance.on('disconnect', (reason: string) => {
    console.log('[Socket] DISCONNECTED, reason:', reason);
    notifyListeners(false, reason === 'io client disconnect' ? null : `Disconnected: ${reason}`);
  });

  socketInstance.on('reconnect_attempt', async (attempt: number) => {
    console.log('[Socket] Reconnect attempt #', attempt);
    const freshToken = await tokenStorage.getAccessToken();
    if (freshToken && socketInstance) {
      const freshFormatted = freshToken.startsWith('Bearer ') ? freshToken : `Bearer ${freshToken}`;
      socketInstance.auth = { token: freshFormatted };
      if ((socketInstance.io as any)?.opts) {
        (socketInstance.io as any).opts.extraHeaders = { Authorization: freshFormatted };
        (socketInstance.io as any).opts.query = { token: freshFormatted };
      }
    }
  });

  socketInstance.connect();
  return socketInstance;
}

/**
 * Returns active socket instance or null if not initialized
 */
export function getSocket(): Socket | null {
  return socketInstance;
}

/**
 * Disconnects and resets socket instance cleanly
 */
export function disconnectSocket(): void {
  if (socketInstance) {
    console.log('[Socket] Disconnecting socket instance manually.');
    socketInstance.removeAllListeners();
    socketInstance.disconnect();
    socketInstance = null;
  }
  notifyListeners(false, null);
}
