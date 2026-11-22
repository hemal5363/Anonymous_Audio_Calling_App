import React, { createContext, useContext, useState, useEffect, ReactNode, useRef } from 'react';
import { Alert } from 'react-native';
import { useSocket } from '../socket/useSocket';
import { SOCKET_EVENTS } from '../socket';
import { getAudioEngine } from './AudioEngine';
import { api } from '../api/client';

export type CallStatus =
  | 'idle'
  | 'searching'
  | 'ringing'
  | 'incoming'
  | 'connected'
  | 'ended';

export interface ActiveCall {
  callCode: string;
  sessionId?: string;
  role: 'caller' | 'callee';
  iceServers?: any[];
}

export interface IncomingCallAlert {
  callCode: string;
  sessionId?: string;
  ringSeconds: number;
}

export interface CallEndInfo {
  callCode?: string;
  reason: string;
  friendlyMessage: string;
  durationSeconds?: number;
}

interface CallContextType {
  callStatus: CallStatus;
  currentCall: ActiveCall | null;
  incomingCall: IncomingCallAlert | null;
  lastEndInfo: CallEndInfo | null;
  callDuration: number;
  isMuted: boolean;
  isSpeaker: boolean;
  startFind: () => void;
  cancelFind: () => void;
  acceptIncoming: () => void;
  rejectIncoming: () => void;
  endCall: (reason?: string) => void;
  skipCall: () => void;
  toggleMute: () => void;
  toggleSpeaker: () => void;
  reportPeer: (reason: string, note?: string) => Promise<void>;
  blockPeer: () => Promise<void>;
  clearEndInfo: () => void;
  triggerIncomingCall: (incoming: IncomingCallAlert) => void;
}

const CallContext = createContext<CallContextType | undefined>(undefined);

/**
 * Translates server end reason strings to human-friendly feedback messages
 */
export function getFriendlyEndMessage(reason?: string): string {
  switch (reason) {
    case 'caller_left':
      return 'The caller cancelled the call before you answered.';
    case 'caller_hangup':
    case 'callee_hangup':
    case 'ended':
      return 'The call has ended.';
    case 'declined':
    case 'rejected':
      return 'The call was declined by the user.';
    case 'ring_timeout':
    case 'missed':
      return 'Call timed out with no answer.';
    case 'no_users_available':
      return 'No available users right now. Please try again shortly.';
    case 'insufficient_balance':
      return 'Call failed: Your wallet balance is insufficient.';
    case 'subscription_required':
      return 'An active subscription plan is required to make calls.';
    case 'daily_cap_reached':
      return 'Your daily free talk time cap has been reached for today.';
    case 'balance_exhausted':
      return 'Call ended: Your balance has been exhausted.';
    case 'network_error':
    case 'disconnected':
      return 'Call ended due to a network disconnection.';
    case 'skipped':
      return 'Your partner skipped to another call.';
    default:
      return reason ? `Call ended: ${reason}` : 'The call has ended.';
  }
}

export function CallProvider({ children }: { children: ReactNode }) {
  const { socket, isConnected, socketError } = useSocket();

  const [callStatus, setCallStatus] = useState<CallStatus>('idle');
  const [currentCall, setCurrentCall] = useState<ActiveCall | null>(null);
  const [incomingCall, setIncomingCall] = useState<IncomingCallAlert | null>(null);
  const [lastEndInfo, setLastEndInfo] = useState<CallEndInfo | null>(null);

  const [callDuration, setCallDuration] = useState<number>(0);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [isSpeaker, setIsSpeaker] = useState<boolean>(false);

  const timerRef = useRef<any>(null);
  const callDurationRef = useRef<number>(0);
  callDurationRef.current = callDuration;

  const socketErrorRef = useRef<string | null>(socketError);
  socketErrorRef.current = socketError;

  const disconnectTimerRef = useRef<any>(null);
  const audioEngine = getAudioEngine();

  // Reset duration timer helper
  const stopDurationTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const startDurationTimer = () => {
    stopDurationTimer();
    setCallDuration(0);
    timerRef.current = setInterval(() => {
      setCallDuration((prev) => prev + 1);
    }, 1000);
  };

  // Bind Socket.IO Event Listeners
  useEffect(() => {
    if (!socket) return;

    // 1. Incoming Call (for Callee)
    const handleIncoming = (payload: any) => {
      setIncomingCall({
        callCode: payload.callCode,
        sessionId: payload.sessionId,
        ringSeconds: payload.ringSeconds || 30,
      });
      setCallStatus('incoming');
    };

    // 2. Caller Ringing
    const handleRinging = (payload: any) => {
      setCurrentCall({
        callCode: payload.callCode,
        sessionId: payload.sessionId,
        role: 'caller',
        iceServers: payload.iceServers,
      });
      setCallStatus('ringing');
    };

    // 3. Matched & Initiating PeerConnection (Both peers)
    const handleMatched = async (payload: any) => {
      const active: ActiveCall = {
        callCode: payload.callCode,
        sessionId: payload.sessionId,
        role: payload.role || 'caller',
        iceServers: payload.iceServers || [],
      };

      setCurrentCall(active);
      setIncomingCall(null);

      // Register listener for local ICE candidates to relay to peer via signaling
      audioEngine.onIceCandidate((candidate) => {
        if (socket && active.callCode) {
          socket.emit(SOCKET_EVENTS.SIGNAL_ICE, {
            callCode: active.callCode,
            candidate,
          });
        }
      });

      // Register connection state changes
      audioEngine.onConnectionStateChange((state) => {
        if (state === 'connected') {
          // Transition to connected and start timer ONLY when peer connection is connected
          setCallStatus('connected');
          startDurationTimer();
          // Notify server of active WebRTC audio connection state
          socket.emit(SOCKET_EVENTS.CALL_CONNECTED, { callCode: active.callCode });
        } else if (state === 'failed') {
          stopDurationTimer();
          audioEngine.cleanup();
          setLastEndInfo({
            callCode: active.callCode,
            reason: 'network_error',
            friendlyMessage: 'Call ended: Audio connection failed to establish.',
          });
          setCurrentCall(null);
          setIncomingCall(null);
          setCallStatus('ended');
          socket.emit(SOCKET_EVENTS.CALL_END, {
            callCode: active.callCode,
            reason: 'network_error',
          });
        } else if (state === 'disconnected') {
          console.warn('[CallContext] WebRTC audio connection disconnected');
        }
      });

      // Initialize AudioEngine with ephemeral ICE servers
      try {
        await audioEngine.initialize(active.iceServers || []);
      } catch (err: any) {
        console.error('[CallContext] AudioEngine initialize failed:', err);
        stopDurationTimer();
        audioEngine.cleanup();
        setLastEndInfo({
          callCode: active.callCode,
          reason: 'permission_denied',
          friendlyMessage: err?.message || 'Failed to initialize microphone or permission denied.',
        });
        setCurrentCall(null);
        setIncomingCall(null);
        setCallStatus('ended');
        socket.emit(SOCKET_EVENTS.CALL_END, {
          callCode: active.callCode,
          reason: 'caller_hangup',
        });
        return;
      }

      // If caller: generate and emit WebRTC offer
      if (active.role === 'caller') {
        const offer = await audioEngine.createOffer();
        if (offer) {
          socket.emit(SOCKET_EVENTS.SIGNAL_OFFER, {
            callCode: active.callCode,
            sdp: offer,
          });
        }
      }
    };

    // 4. WebRTC Signaling Relays
    const handleOffer = async (payload: any) => {
      if (payload?.sdp) {
        await audioEngine.setRemoteDescription(payload.sdp);
        const answer = await audioEngine.createAnswer(payload.sdp);
        if (answer) {
          socket.emit(SOCKET_EVENTS.SIGNAL_ANSWER, {
            callCode: payload.callCode,
            sdp: answer,
          });
        }
      }
    };

    const handleAnswer = async (payload: any) => {
      if (payload?.sdp) {
        await audioEngine.setRemoteDescription(payload.sdp);
      }
    };

    const handleIce = async (payload: any) => {
      if (payload?.candidate) {
        await audioEngine.addIceCandidate(payload.candidate);
      }
    };

    // 5. Call Ended & Clean Up
    const handleEnded = (payload: any) => {
      stopDurationTimer();
      audioEngine.cleanup();

      const reason = payload?.reason || 'ended';
      setLastEndInfo({
        callCode: payload?.callCode,
        reason,
        friendlyMessage: getFriendlyEndMessage(reason),
        durationSeconds: payload?.durationSeconds ?? callDurationRef.current,
      });

      setCurrentCall(null);
      setIncomingCall(null);
      setIsMuted(false);
      setIsSpeaker(false);
      setCallStatus('ended');
    };

    // 6. No Users Available
    const handleNoneAvailable = () => {
      stopDurationTimer();
      audioEngine.cleanup();

      const reason = 'no_users_available';
      setLastEndInfo({
        reason,
        friendlyMessage: getFriendlyEndMessage(reason),
      });

      setCurrentCall(null);
      setIncomingCall(null);
      setCallStatus('ended');
    };

    // 7. General Call Errors (Billing, daily cap, etc.)
    const handleError = (payload: any) => {
      console.error('[Socket Event] call:error received:', payload?.error || payload);
      stopDurationTimer();
      audioEngine.cleanup();

      const reason = payload?.error || 'error';
      setLastEndInfo({
        reason,
        friendlyMessage: payload?.message || getFriendlyEndMessage(reason),
      });

      setCurrentCall(null);
      setIncomingCall(null);
      setCallStatus('ended');
    };

    socket.on(SOCKET_EVENTS.CALL_INCOMING, handleIncoming);
    socket.on(SOCKET_EVENTS.CALL_RINGING, handleRinging);
    socket.on(SOCKET_EVENTS.CALL_MATCHED, handleMatched);
    socket.on(SOCKET_EVENTS.SIGNAL_OFFER, handleOffer);
    socket.on(SOCKET_EVENTS.SIGNAL_ANSWER, handleAnswer);
    socket.on(SOCKET_EVENTS.SIGNAL_ICE, handleIce);
    socket.on(SOCKET_EVENTS.CALL_ENDED, handleEnded);
    socket.on(SOCKET_EVENTS.CALL_NONE_AVAILABLE, handleNoneAvailable);
    socket.on('no_users_available', handleNoneAvailable);
    socket.on(SOCKET_EVENTS.CALL_ERROR, handleError);

    return () => {
      socket.off(SOCKET_EVENTS.CALL_INCOMING, handleIncoming);
      socket.off(SOCKET_EVENTS.CALL_RINGING, handleRinging);
      socket.off(SOCKET_EVENTS.CALL_MATCHED, handleMatched);
      socket.off(SOCKET_EVENTS.SIGNAL_OFFER, handleOffer);
      socket.off(SOCKET_EVENTS.SIGNAL_ANSWER, handleAnswer);
      socket.off(SOCKET_EVENTS.SIGNAL_ICE, handleIce);
      socket.off(SOCKET_EVENTS.CALL_ENDED, handleEnded);
      socket.off(SOCKET_EVENTS.CALL_NONE_AVAILABLE, handleNoneAvailable);
      socket.off('no_users_available', handleNoneAvailable);
      socket.off(SOCKET_EVENTS.CALL_ERROR, handleError);
    };
  }, [socket]);

  // Clean up if connection drops mid-call with ~5 second grace period
  useEffect(() => {
    if (!isConnected && (callStatus === 'connected' || callStatus === 'ringing')) {
      const realReason = socketError || 'transport close';
      console.warn(
        `[CallContext] Socket disconnected mid-call (status: ${callStatus}). Starting 5s grace period before ending call. Real reason / error: ${realReason}`
      );

      if (!disconnectTimerRef.current) {
        disconnectTimerRef.current = setTimeout(() => {
          console.error(
            `[CallContext] Disconnect grace period (5s) expired without reconnect. Ending call due to network disconnection. Reason: ${socketErrorRef.current || 'network error'}`
          );
          stopDurationTimer();
          audioEngine.cleanup();
          setLastEndInfo({
            reason: 'disconnected',
            friendlyMessage: `Call ended due to network disconnection (${socketErrorRef.current || 'network error'}).`,
          });
          setCurrentCall(null);
          setIncomingCall(null);
          setCallStatus('ended');
          disconnectTimerRef.current = null;
        }, 5000);
      }
    } else if (isConnected && disconnectTimerRef.current) {
      clearTimeout(disconnectTimerRef.current);
      disconnectTimerRef.current = null;
    }

    return () => {
      if (callStatus === 'idle' || callStatus === 'ended') {
        if (disconnectTimerRef.current) {
          clearTimeout(disconnectTimerRef.current);
          disconnectTimerRef.current = null;
        }
      }
    };
  }, [isConnected, callStatus, socketError]);

  // -------------------------------------------------------------------------
  // Public Action Handlers
  // -------------------------------------------------------------------------

  const startFind = async () => {
    if (!socket || !isConnected) {
      console.warn('[CallContext] startFind called but socket is not connected.');
      return;
    }

    // Request microphone permission before starting a call
    const hasPermission = await audioEngine.requestPermissions();
    if (!hasPermission) {
      Alert.alert(
        'Microphone Permission Required',
        'Microphone access is required to connect voice calls. Please allow microphone permission in your device settings.',
        [{ text: 'OK' }]
      );
      return;
    }

    setLastEndInfo(null);
    setCallStatus('searching');
    socket.emit(SOCKET_EVENTS.CALL_FIND, (ack: any) => {
      if (ack && !ack.success) {
        setCallStatus('ended');
        setLastEndInfo({
          reason: ack.error || 'call_failed',
          friendlyMessage: getFriendlyEndMessage(ack.error) || ack.message,
        });
      }
    });
  };

  const cancelFind = () => {
    if (currentCall?.callCode && socket) {
      socket.emit(SOCKET_EVENTS.CALL_END, {
        callCode: currentCall.callCode,
        reason: 'caller_left',
      });
      socket.emit('call:cancel', {
        callCode: currentCall.callCode,
        reason: 'caller_left',
      });
    }
    stopDurationTimer();
    audioEngine.cleanup();
    setCurrentCall(null);
    setIncomingCall(null);
    setCallStatus('idle');
  };

  const acceptIncoming = async () => {
    if (!incomingCall?.callCode || !socket) return;

    // Request microphone permission before accepting incoming call
    const hasPermission = await audioEngine.requestPermissions();
    if (!hasPermission) {
      Alert.alert(
        'Microphone Permission Required',
        'Microphone access is required to answer voice calls. Please allow microphone permission in your device settings.',
        [{ text: 'OK' }]
      );
      return;
    }

    socket.emit(SOCKET_EVENTS.CALL_ACCEPT, {
      callCode: incomingCall.callCode,
    });
  };

  const rejectIncoming = () => {
    if (!incomingCall?.callCode || !socket) return;
    socket.emit(SOCKET_EVENTS.CALL_DECLINE, {
      callCode: incomingCall.callCode,
      reason: 'declined',
    });
    setIncomingCall(null);
    setCallStatus('idle');
  };

  const endCall = (reason = 'caller_hangup') => {
    if (currentCall?.callCode && socket) {
      socket.emit(SOCKET_EVENTS.CALL_END, {
        callCode: currentCall.callCode,
        reason,
      });
    }
    stopDurationTimer();
    audioEngine.cleanup();
    setCurrentCall(null);
    setIncomingCall(null);
    setIsMuted(false);
    setIsSpeaker(false);
    setCallStatus('idle');
  };

  const skipCall = () => {
    if (currentCall?.callCode && socket) {
      socket.emit(SOCKET_EVENTS.CALL_SKIP, {
        callCode: currentCall.callCode,
      });
    }
    stopDurationTimer();
    audioEngine.cleanup();
    setCurrentCall(null);
    setIsMuted(false);
    setIsSpeaker(false);
    // Transition straight back to searching per docs/CALL_FLOW.md
    setCallStatus('searching');
  };

  const toggleMute = () => {
    const nextMute = !isMuted;
    setIsMuted(nextMute);
    audioEngine.setMuted(nextMute);
    if (currentCall?.callCode && socket) {
      socket.emit(SOCKET_EVENTS.CALL_MUTE, {
        callCode: currentCall.callCode,
        isMuted: nextMute,
      });
    }
  };

  const toggleSpeaker = () => {
    const nextSpeaker = !isSpeaker;
    setIsSpeaker(nextSpeaker);
    audioEngine.setSpeaker(nextSpeaker);
  };

  const reportPeer = async (reason: string, note?: string) => {
    if (!currentCall?.callCode) return;
    if (socket) {
      socket.emit(SOCKET_EVENTS.CALL_REPORT, {
        callCode: currentCall.callCode,
        reason,
        note,
      });
    }
    await api.post('/user/reports', {
      call_code: currentCall.callCode,
      reason,
      note,
    });
  };

  const blockPeer = async () => {
    if (!currentCall?.callCode) return;
    if (socket) {
      socket.emit(SOCKET_EVENTS.CALL_BLOCK, {
        callCode: currentCall.callCode,
      });
    }
    await api.post('/user/blocks', {
      call_code: currentCall.callCode,
    });
    // Immediately end call after blocking
    endCall('blocked');
  };

  const clearEndInfo = () => {
    setLastEndInfo(null);
    setCallStatus('idle');
  };

  const triggerIncomingCall = (incoming: IncomingCallAlert) => {
    setIncomingCall(incoming);
    setCallStatus('incoming');
  };

  return (
    <CallContext.Provider
      value={{
        callStatus,
        currentCall,
        incomingCall,
        lastEndInfo,
        callDuration,
        isMuted,
        isSpeaker,
        startFind,
        cancelFind,
        acceptIncoming,
        rejectIncoming,
        endCall,
        skipCall,
        toggleMute,
        toggleSpeaker,
        reportPeer,
        blockPeer,
        clearEndInfo,
        triggerIncomingCall,
      }}
    >
      {children}
    </CallContext.Provider>
  );
}

export function useCall(): CallContextType {
  const context = useContext(CallContext);
  if (!context) {
    throw new Error('useCall must be used within a CallProvider');
  }
  return context;
}
