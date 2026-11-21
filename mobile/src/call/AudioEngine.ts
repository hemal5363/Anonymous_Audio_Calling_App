/**
 * AudioEngine Interface
 * Abstracts WebRTC media and peer connection operations so the UI screens
 * interact with a clean contract.
 *
 * In this Expo Go MVP phase, StubAudioEngine provides a mock implementation.
 * In the development build phase (with react-native-webrtc), RealAudioEngine
 * will implement this exact interface with zero screen code changes.
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
   * Initializes the audio engine and creates local peer connection with ICE servers
   */
  initialize(iceServers: IceServer[]): Promise<void>;

  /**
   * Generates a local WebRTC SDP offer
   */
  createOffer(): Promise<SessionDescription | null>;

  /**
   * Generates a local WebRTC SDP answer in response to a remote offer
   */
  createAnswer(remoteOffer: SessionDescription): Promise<SessionDescription | null>;

  /**
   * Applies the remote peer's session description
   */
  setRemoteDescription(description: SessionDescription): Promise<void>;

  /**
   * Adds an ICE candidate received from signaling relay
   */
  addIceCandidate(candidate: any): Promise<void>;

  /**
   * Toggles microphone audio mute
   */
  setMuted(muted: boolean): Promise<void>;

  /**
   * Toggles audio output between earpiece and speakerphone
   */
  setSpeaker(speakerOn: boolean): Promise<void>;

  /**
   * Releases local audio tracks and closes peer connection
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
 * Stub AudioEngine Implementation for Expo Go
 * Performs state tracking without requiring native WebRTC binaries.
 */
export class StubAudioEngine implements AudioEngine {
  private isMuted: boolean = false;
  private isSpeaker: boolean = false;
  private connectionState: string = 'new';
  private iceCandidateCallback: ((candidate: any) => void) | null = null;
  private stateChangeCallback: ((state: string) => void) | null = null;

  async initialize(iceServers: IceServer[]): Promise<void> {
    this.connectionState = 'connecting';
    this.stateChangeCallback?.(this.connectionState);

    // Simulate async initialization
    await new Promise((resolve) => setTimeout(resolve, 100));

    this.connectionState = 'connected';
    this.stateChangeCallback?.(this.connectionState);
  }

  async createOffer(): Promise<SessionDescription | null> {
    return {
      type: 'offer',
      sdp: 'v=0\r\no=- 0 0 IN IP4 0.0.0.0\r\ns=StubAudioEngineOffer\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n',
    };
  }

  async createAnswer(remoteOffer: SessionDescription): Promise<SessionDescription | null> {
    return {
      type: 'answer',
      sdp: 'v=0\r\no=- 0 0 IN IP4 0.0.0.0\r\ns=StubAudioEngineAnswer\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n',
    };
  }

  async setRemoteDescription(description: SessionDescription): Promise<void> {
    // Stub description handling
  }

  async addIceCandidate(candidate: any): Promise<void> {
    // Stub ICE handling
  }

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
    engineInstance = new StubAudioEngine();
  }
  return engineInstance;
}
