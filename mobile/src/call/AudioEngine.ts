import { Platform, PermissionsAndroid } from 'react-native';
import {
  RTCPeerConnection,
  RTCIceCandidate,
  RTCSessionDescription,
  mediaDevices,
  MediaStream,
} from 'react-native-webrtc';
import InCallManager from 'react-native-incall-manager';

/**
 * AudioEngine Interface
 * Abstracts WebRTC media, peer connection lifecycle, and audio routing
 * so UI screens interact exclusively with a clean contract.
 */

export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface SessionDescription {
  type: 'offer' | 'answer' | 'pranswer' | 'rollback';
  sdp: string;
}

export interface AudioEngine {
  /**
   * Request / verify microphone permission
   */
  requestPermissions(): Promise<boolean>;

  /**
   * Initializes the audio engine, acquires microphone track,
   * configures InCallManager (earpiece by default), and creates RTCPeerConnection.
   */
  initialize(iceServers: IceServer[]): Promise<void>;

  /**
   * Generates a local WebRTC SDP offer (caller)
   */
  createOffer(): Promise<SessionDescription | null>;

  /**
   * Generates a local WebRTC SDP answer in response to a remote offer (callee)
   */
  createAnswer(remoteOffer?: SessionDescription): Promise<SessionDescription | null>;

  /**
   * Applies the remote peer's session description and drains queued ICE candidates
   */
  setRemoteDescription(description: SessionDescription): Promise<void>;

  /**
   * Adds an ICE candidate, queuing it if remote description is not yet set
   */
  addIceCandidate(candidate: any): Promise<void>;

  /**
   * Toggles microphone audio mute on local media stream tracks
   */
  setMuted(muted: boolean): Promise<void>;

  /**
   * Toggles audio output between earpiece and loudspeaker
   */
  setSpeaker(speakerOn: boolean): Promise<void>;

  /**
   * Releases local audio tracks, closes peer connection, and releases audio focus
   */
  cleanup(): Promise<void>;

  /**
   * Register listener for ICE candidate generation
   */
  onIceCandidate(callback: (candidate: any) => void): void;

  /**
   * Register listener for connection state changes
   */
  onConnectionStateChange(callback: (state: string) => void): void;
}

/**
 * RealAudioEngine
 * Production WebRTC audio engine using react-native-webrtc and react-native-incall-manager.
 */
export class RealAudioEngine implements AudioEngine {
  private peerConnection: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private isMuted: boolean = false;
  private isSpeaker: boolean = false;
  private iceCandidateQueue: any[] = [];
  private remoteDescriptionSet: boolean = false;
  private initPromise: Promise<void> | null = null;

  private iceCandidateCallback: ((candidate: any) => void) | null = null;
  private stateChangeCallback: ((state: string) => void) | null = null;

  /**
   * Request microphone permission from the operating system
   */
  async requestPermissions(): Promise<boolean> {
    if (Platform.OS === 'android') {
      try {
        const hasPermission = await PermissionsAndroid.check(
          PermissionsAndroid.PERMISSIONS.RECORD_AUDIO
        );
        if (hasPermission) {
          return true;
        }
        const status = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
          {
            title: 'Microphone Permission Required',
            message:
              'Anonymous Audio Calling requires microphone access to connect audio calls.',
            buttonPositive: 'Allow',
            buttonNegative: 'Deny',
          }
        );
        return status === PermissionsAndroid.RESULTS.GRANTED;
      } catch (err) {
        console.warn('[AudioEngine] Microphone permission request error:', err);
        return false;
      }
    }
    // On iOS, mediaDevices.getUserMedia automatically requests permission per Info.plist
    return true;
  }

  /**
   * Initialize local media stream, InCallManager audio routing, and RTCPeerConnection
   */
  async initialize(iceServers: IceServer[]): Promise<void> {
    this.initPromise = this._doInitialize(iceServers);
    await this.initPromise;
  }

  private async _doInitialize(iceServers: IceServer[]): Promise<void> {
    // Clean up any stale connection or tracks first
    await this.cleanup();

    // 1. Verify microphone permission
    const hasPermission = await this.requestPermissions();
    if (!hasPermission) {
      throw new Error('Microphone permission was denied.');
    }

    // 2. Start InCallManager on earpiece (default) and activate proximity sensor
    try {
      InCallManager.start({ media: 'audio', auto: false });
      InCallManager.setForceSpeakerphoneOn(false); // start on earpiece
      InCallManager.setSpeakerphoneOn(false);
      InCallManager.startProximitySensor();
    } catch (err) {
      console.warn('[AudioEngine] InCallManager start warning:', err);
    }

    // 3. Acquire local audio-only MediaStream
    try {
      this.localStream = await mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });
      // Ensure all local audio tracks are active
      this.localStream.getAudioTracks().forEach((track) => {
        track.enabled = !this.isMuted;
      });
    } catch (err) {
      console.error('[AudioEngine] getUserMedia error:', err);
      throw new Error('Failed to access microphone hardware.');
    }

    // 4. Configure ICE servers & relay policy
    const hasRealTurn = iceServers.some((s) => {
      const urls = Array.isArray(s.urls) ? s.urls : [s.urls];
      return urls.some(
        (u) => typeof u === 'string' && u.startsWith('turn:') && !u.includes('example.com')
      );
    });

    const configuration: any = {
      iceServers:
        iceServers && iceServers.length > 0
          ? iceServers
          : [{ urls: 'stun:stun.l.google.com:19302' }],
      iceTransportPolicy: hasRealTurn ? 'relay' : 'all',
    };

    // 5. Create RTCPeerConnection
    this.peerConnection = new RTCPeerConnection(configuration);

    // 6. Attach local audio tracks to peer connection
    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => {
        this.peerConnection?.addTrack(track, this.localStream!);
      });
    }

    // 7. Handle local ICE candidate generation (emit to signaling without logging sensitive IP)
    this.peerConnection.onicecandidate = (event: any) => {
      if (event.candidate && this.iceCandidateCallback) {
        const candidateData = event.candidate.toJSON
          ? event.candidate.toJSON()
          : event.candidate;
        this.iceCandidateCallback(candidateData);
      }
    };

    // 8. Handle connection state changes
    this.peerConnection.onconnectionstatechange = () => {
      const state = this.peerConnection?.connectionState || 'new';
      this.stateChangeCallback?.(state);
    };

    this.peerConnection.oniceconnectionstatechange = () => {
      const iceState = this.peerConnection?.iceConnectionState;
      if (iceState === 'connected' || iceState === 'completed') {
        this.stateChangeCallback?.('connected');
      } else if (iceState === 'failed') {
        this.stateChangeCallback?.('failed');
      } else if (iceState === 'disconnected') {
        this.stateChangeCallback?.('disconnected');
      }
    };
  }

  /**
   * Generates local SDP offer
   */
  async createOffer(): Promise<SessionDescription | null> {
    if (this.initPromise) await this.initPromise;
    if (!this.peerConnection) return null;

    try {
      const offer = await this.peerConnection.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: false,
      });
      await this.peerConnection.setLocalDescription(offer);
      return {
        type: offer.type as any,
        sdp: offer.sdp,
      };
    } catch (err) {
      console.error('[AudioEngine] createOffer error:', err);
      return null;
    }
  }

  /**
   * Generates local SDP answer
   */
  async createAnswer(remoteOffer?: SessionDescription): Promise<SessionDescription | null> {
    if (this.initPromise) await this.initPromise;
    if (!this.peerConnection) return null;

    try {
      if (remoteOffer && !this.remoteDescriptionSet) {
        await this.setRemoteDescription(remoteOffer);
      }
      const answer = await this.peerConnection.createAnswer();
      await this.peerConnection.setLocalDescription(answer);
      return {
        type: answer.type as any,
        sdp: answer.sdp,
      };
    } catch (err) {
      console.error('[AudioEngine] createAnswer error:', err);
      return null;
    }
  }

  /**
   * Sets remote session description and flushes queued ICE candidates
   */
  async setRemoteDescription(description: SessionDescription): Promise<void> {
    if (this.initPromise) await this.initPromise;
    if (!this.peerConnection) return;

    try {
      const desc = new RTCSessionDescription(description);
      await this.peerConnection.setRemoteDescription(desc);
      this.remoteDescriptionSet = true;

      // Drain queued ICE candidates
      while (this.iceCandidateQueue.length > 0) {
        const queued = this.iceCandidateQueue.shift();
        try {
          await this.peerConnection.addIceCandidate(new RTCIceCandidate(queued));
        } catch (err) {
          console.warn('[AudioEngine] Failed to add queued ICE candidate:', err);
        }
      }
    } catch (err) {
      console.error('[AudioEngine] setRemoteDescription error:', err);
    }
  }

  /**
   * Adds remote ICE candidate or queues if remote description is not set yet
   */
  async addIceCandidate(candidate: any): Promise<void> {
    if (!candidate) return;

    if (this.initPromise) await this.initPromise;

    if (this.peerConnection && this.remoteDescriptionSet) {
      try {
        await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.warn('[AudioEngine] Failed to add ICE candidate:', err);
      }
    } else {
      this.iceCandidateQueue.push(candidate);
    }
  }

  /**
   * Toggles microphone audio mute on local media tracks
   */
  async setMuted(muted: boolean): Promise<void> {
    this.isMuted = muted;
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach((track) => {
        track.enabled = !muted;
      });
    }
    try {
      InCallManager.setMicrophoneMute(muted);
    } catch (err) {
      console.warn('[AudioEngine] setMicrophoneMute error:', err);
    }
  }

  /**
   * Toggles between earpiece and loudspeaker
   */
  async setSpeaker(speakerOn: boolean): Promise<void> {
    this.isSpeaker = speakerOn;
    try {
      InCallManager.setForceSpeakerphoneOn(speakerOn);
      InCallManager.setSpeakerphoneOn(speakerOn);
    } catch (err) {
      console.warn('[AudioEngine] setSpeaker error:', err);
    }
  }

  /**
   * Cleans up all tracks, closes peer connection, and releases audio focus & proximity sensor
   */
  async cleanup(): Promise<void> {
    this.initPromise = null;
    this.remoteDescriptionSet = false;
    this.iceCandidateQueue = [];
    this.isMuted = false;
    this.isSpeaker = false;

    // Stop and release local audio tracks
    if (this.localStream) {
      try {
        this.localStream.getTracks().forEach((track) => {
          try {
            track.stop();
            track.enabled = false;
          } catch (e) {}
        });
      } catch (e) {}
      this.localStream = null;
    }

    // Close peer connection
    if (this.peerConnection) {
      try {
        this.peerConnection.close();
      } catch (e) {}
      this.peerConnection = null;
    }

    // Stop InCallManager and release audio focus & proximity sensor
    try {
      InCallManager.stopProximitySensor();
      InCallManager.setForceSpeakerphoneOn(false);
      InCallManager.setSpeakerphoneOn(false);
      InCallManager.stop();
    } catch (err) {
      console.warn('[AudioEngine] InCallManager stop error:', err);
    }

    this.stateChangeCallback?.('closed');
  }

  onIceCandidate(callback: (candidate: any) => void): void {
    this.iceCandidateCallback = callback;
  }

  onConnectionStateChange(callback: (state: string) => void): void {
    this.stateChangeCallback = callback;
  }
}

/**
 * Stub AudioEngine for unit tests or fallback environments
 */
export class StubAudioEngine implements AudioEngine {
  private isMuted: boolean = false;
  private isSpeaker: boolean = false;
  private connectionState: string = 'new';
  private iceCandidateCallback: ((candidate: any) => void) | null = null;
  private stateChangeCallback: ((state: string) => void) | null = null;

  async requestPermissions(): Promise<boolean> {
    return true;
  }

  async initialize(_iceServers: IceServer[]): Promise<void> {
    this.connectionState = 'connecting';
    this.stateChangeCallback?.(this.connectionState);

    await new Promise((resolve) => setTimeout(resolve, 50));

    this.connectionState = 'connected';
    this.stateChangeCallback?.(this.connectionState);
  }

  async createOffer(): Promise<SessionDescription | null> {
    return {
      type: 'offer',
      sdp: 'v=0\r\no=- 0 0 IN IP4 0.0.0.0\r\ns=StubAudioEngineOffer\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n',
    };
  }

  async createAnswer(_remoteOffer?: SessionDescription): Promise<SessionDescription | null> {
    return {
      type: 'answer',
      sdp: 'v=0\r\no=- 0 0 IN IP4 0.0.0.0\r\ns=StubAudioEngineAnswer\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n',
    };
  }

  async setRemoteDescription(_description: SessionDescription): Promise<void> {}

  async addIceCandidate(_candidate: any): Promise<void> {}

  async setMuted(muted: boolean): Promise<void> {
    this.isMuted = muted;
  }

  async setSpeaker(speakerOn: boolean): Promise<void> {
    this.isSpeaker = speakerOn;
  }

  async cleanup(): Promise<void> {
    this.connectionState = 'closed';
    this.stateChangeCallback?.(this.connectionState);
    this.isMuted = false;
    this.isSpeaker = false;
  }

  onIceCandidate(callback: (candidate: any) => void): void {
    this.iceCandidateCallback = callback;
  }

  onConnectionStateChange(callback: (state: string) => void): void {
    this.stateChangeCallback = callback;
  }
}

// Global singleton instance of AudioEngine
let engineInstance: AudioEngine | null = null;

export function getAudioEngine(): AudioEngine {
  if (!engineInstance) {
    engineInstance = new RealAudioEngine();
  }
  return engineInstance;
}
