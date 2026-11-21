import { useEffect, useState } from 'react';
import { Socket } from 'socket.io-client';
import { getSocket, getIsSocketConnected, getSocketError, subscribeSocketStatus } from './index';

export function useSocket(): {
  socket: Socket | null;
  isConnected: boolean;
  socketError: string | null;
} {
  const [isConnected, setIsConnected] = useState<boolean>(getIsSocketConnected());
  const [socketError, setSocketError] = useState<string | null>(getSocketError());

  useEffect(() => {
    const unsubscribe = subscribeSocketStatus((connected, error) => {
      setIsConnected(connected);
      setSocketError(error);
    });
    return unsubscribe;
  }, []);

  return {
    socket: getSocket(),
    isConnected,
    socketError,
  };
}
