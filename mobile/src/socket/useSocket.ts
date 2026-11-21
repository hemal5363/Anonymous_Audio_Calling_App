import { useEffect, useState } from 'react';
import { Socket } from 'socket.io-client';
import { getSocket, getIsSocketConnected, subscribeSocketStatus } from './index';

export function useSocket(): {
  socket: Socket | null;
  isConnected: boolean;
} {
  const [isConnected, setIsConnected] = useState<boolean>(getIsSocketConnected());

  useEffect(() => {
    const unsubscribe = subscribeSocketStatus((connected) => {
      setIsConnected(connected);
    });
    return unsubscribe;
  }, []);

  return {
    socket: getSocket(),
    isConnected,
  };
}
