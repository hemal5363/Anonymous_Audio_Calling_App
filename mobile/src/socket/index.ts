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

type StatusListener = (connected: boolean) => void;
const statusListeners = new Set<StatusListener>();

let socketInstance: Socket | null = null;
let isSocketConnected = false;

function notifyListeners(connected: boolean) {
  isSocketConnected = connected;
  statusListeners.forEach((listener) => {
    try {
      listener(connected);
    } catch {
      // Ignore listener error
    }
  });
}

/**
 * Subscribe to socket connection state changes
 */
export function subscribeSocketStatus(listener: StatusListener): () => void {
  statusListeners.add(listener);
  // Immediately emit current state
  listener(isSocketConnected);
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
 * Establishes an authenticated WebSocket connection with the backend
 */
export async function connectSocket(): Promise<Socket> {
  if (socketInstance) {
    if (socketInstance.connected) {
      notifyListeners(true);
      return socketInstance;
    }
    const token = await tokenStorage.getAccessToken();
    if (token) {
      socketInstance.auth = {
        token: `Bearer ${token}`,
      };
    }
    socketInstance.connect();
    return socketInstance;
  }

  const accessToken = await tokenStorage.getAccessToken();

  socketInstance = io(API_URL, {
    transports: ['websocket'],
    autoConnect: false,
    auth: {
      token: accessToken ? `Bearer ${accessToken}` : '',
    },
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 20000,
  });

  socketInstance.on('connect', () => {
    notifyListeners(true);
    // Send presence handshake upon connecting
    socketInstance?.emit(SOCKET_EVENTS.PRESENCE_HELLO);
  });

  socketInstance.on('reconnect_attempt', async () => {
    // Refresh auth token before reconnecting
    const freshToken = await tokenStorage.getAccessToken();
    if (socketInstance) {
      socketInstance.auth = {
        token: freshToken ? `Bearer ${freshToken}` : '',
      };
    }
  });

  socketInstance.on('disconnect', () => {
    notifyListeners(false);
  });

  socketInstance.on('connect_error', () => {
    notifyListeners(false);
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
    socketInstance.removeAllListeners();
    socketInstance.disconnect();
    socketInstance = null;
  }
  notifyListeners(false);
}
