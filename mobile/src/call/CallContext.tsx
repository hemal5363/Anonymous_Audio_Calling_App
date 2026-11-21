import React, { createContext, useContext, useState, useEffect, ReactNode, useRef } from 'react';
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
}

const CallContext = createContext<CallContextType | undefined>(undefined);

/**
 * Translates server end reason strings to human-friendly feedback messages
 */
export function getFriendlyEndMessage(reason?: string): string {
  switch (reason) {
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
  const { socket, isConnected } = useSocket();

  const [callStatus, setCallStatus] = useState<CallStatus>('idle');
  const [currentCall, setCurrentCall] = useState<ActiveCall | null>(null);
  const [incomingCall, setIncomingCall] = useState<IncomingCallAlert | null>(null);
  const [lastEndInfo, setLastEndInfo] = useState<CallEndInfo | null>(null);

  const [callDuration, setCallDuration] = useState<number>(0);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [isSpeaker, setIsSpeaker] = useState<boolean>(false);

  const timerRef = useRef<any>(null);
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

    // 3. Matched & Connected (Both peers)
    const handleMatched = async (payload: any) => {
      const active: ActiveCall = {
        callCode: payload.callCode,
        sessionId: payload.sessionId,
        role: payload.role || 'caller',
        iceServers: payload.iceServers || [],
      };

      setCurrentCall(active);
      setIncomingCall(null);
      setCallStatus('connected');
      startDurationTimer();

      // Initialize AudioEngine contract with ephemeral ICE servers
      await audioEngine.initialize(active.iceServers || []);

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

      // Notify server of WebRTC audio connection state
      socket.emit(SOCKET_EVENTS.CALL_CONNECTED, { callCode: active.callCode });
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
        durationSeconds: payload?.durationSeconds || callDuration,
      });

      setCurrentCall(null);
      setIncomingCall(null);
      setIsMuted(false);
      setIsSpeaker(false);
      setCallStatus('ended');
    };

    // 6. No Users Available
    const handleNoneAvailable = (payload: any) => {
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
  }, [socket, callDuration]);

  // Clean up if connection drops mid-call
  useEffect(() => {
    if (!isConnected && (callStatus === 'connected' || callStatus === 'ringing')) {
      stopDurationTimer();
      audioEngine.cleanup();
      setLastEndInfo({
        reason: 'disconnected',
        friendlyMessage: getFriendlyEndMessage('disconnected'),
      });
      setCurrentCall(null);
      setIncomingCall(null);
      setCallStatus('ended');
    }
  }, [isConnected, callStatus]);

  // -------------------------------------------------------------------------
  // Public Action Handlers
  // -------------------------------------------------------------------------

  const startFind = () => {
    if (!socket || !isConnected) return;
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
        reason: 'caller_hangup',
      });
    }
    stopDurationTimer();
    audioEngine.cleanup();
    setCurrentCall(null);
    setIncomingCall(null);
    setCallStatus('idle');
  };

  const acceptIncoming = () => {
    if (!incomingCall?.callCode || !socket) return;
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
