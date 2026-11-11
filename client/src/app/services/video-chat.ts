import { inject, Injectable } from '@angular/core';
import { HubConnection, HubConnectionBuilder, HubConnectionState } from '@microsoft/signalr';
import { BehaviorSubject, Subject } from 'rxjs';
import { AuthService } from './auth-service';

export interface OfferPayload {
  senderId: string;
  offer: RTCSessionDescriptionInit;
}

export interface AnswerPayload {
  senderId: string;
  answer: RTCSessionDescriptionInit;
}

export interface IceCandidatePayload {
  senderId: string;
  candidate: RTCIceCandidateInit;
}

export interface MediaStatePayload {
  senderId: string;
  isVideoOn: boolean;
  isAudioOn: boolean;
}

@Injectable({
  providedIn: 'root',
})
export class VideoChatService {
  private hubUrl = 'http://localhost:5000/hubs/video';
  private authService = inject(AuthService);

  public hubconnection!: HubConnection;
  public offerReceived = new BehaviorSubject<OfferPayload | null>(null);
  public answerReceived = new BehaviorSubject<AnswerPayload | null>(null);
  public iceCandidateReceived = new BehaviorSubject<IceCandidatePayload | null>(null);
  public mediaStateReceived = new Subject<MediaStatePayload>();
  public callEnded = new Subject<string>();
  public userOffline = new Subject<string>();

  public incomingCall = false;
  public isCallActive = false;
  public isDialogOpen = false;
  public isRemoteUserOnline = true;
  public remoteUserId = '';
  public remoteUserName = '';
  public remoteUserAvatar = '';

  public preConnection!: RTCPeerConnection;

  private activeToken: string | null = null;
  private startPromise: Promise<void> | null = null;
  private bufferedIceCandidates: IceCandidatePayload[] = [];

  private readonly incomingCallSoundUrl = '/assecc/WhatsApp_-_Incoming_Call-646860-mobiles24.mp3';
  private audioContext: AudioContext | null = null;
  private incomingCallBuffer: AudioBuffer | null = null;
  private incomingCallBlobUrl: string | null = null;
  private audioPreloadPromise: Promise<void> | null = null;
  private activeBufferSource: AudioBufferSourceNode | null = null;
  private activeAudioElement: HTMLAudioElement | null = null;
  private isRingtoneActive = false;
  private pendingRingtoneUnlock = false;

  constructor() {
    this.registerAudioUnlock();
  }

  /** Unlocks browser audio playback on user interaction and preloads the incoming ringtone. */
  unlockAudio(): void {
    if (typeof window === 'undefined') return;
    const ctx = this.ensureAudioContext();
    if (ctx?.state === 'suspended') {
      void ctx.resume().catch(() => {});
    }
    void this.preloadIncomingCallSound();
  }

  /** Starts the SignalR connection to the VideoHub using the current JWT access token. */
  async startConnection(): Promise<void> {
    const token = this.authService.getToken();
    if (!token) {
      return;
    }

    void this.preloadIncomingCallSound();

    if (this.startPromise && this.activeToken === token) {
      return this.startPromise;
    }

    if (
      this.hubconnection &&
      this.activeToken === token &&
      this.hubconnection.state !== HubConnectionState.Disconnected
    ) {
      return;
    }

    this.activeToken = token;

    const task = (async () => {
      if (this.hubconnection) {
        await this.stopConnection();
        this.activeToken = token;
      }

      const connection = new HubConnectionBuilder()
        .withUrl(this.hubUrl, {
          accessTokenFactory: () => this.authService.getToken() || token,
        })
        .withAutomaticReconnect()
        .build();

      this.hubconnection = connection;
      this.registerHubEvents(connection);

      try {
        await connection.start();
        if (this.hubconnection !== connection) {
          await connection.stop().catch(() => {});
        }
      } catch (err) {
        console.error('Error while starting VideoHub connection:', err);
      }
    })().finally(() => {
      if (this.startPromise === task) {
        this.startPromise = null;
      }
    });

    this.startPromise = task;
    return task;
  }

  /** Stops the SignalR VideoHub connection and halts any active incoming ringtone. */
  async stopConnection(): Promise<void> {
    const connection = this.hubconnection;
    this.activeToken = null;
    this.startPromise = null;
    this.stopIncomingCallSound();

    if (connection && connection.state !== HubConnectionState.Disconnected) {
      try {
        await connection.stop();
      } catch (err) {
        console.error('Error while stopping VideoHub connection:', err);
      }
    }
  }

  async sendOffer(receiverId: string, offer: RTCSessionDescriptionInit): Promise<void> {
    if (!receiverId || !(await this.ensureConnected())) return;
    try {
      await this.hubconnection.invoke('SendOffer', receiverId, JSON.stringify(offer));
    } catch (err) {
      console.error('Error while sending offer:', err);
    }
  }

  async sendAnswer(receiverId: string, answer: RTCSessionDescriptionInit): Promise<void> {
    if (!receiverId || !(await this.ensureConnected())) return;
    try {
      await this.hubconnection.invoke('SendAnswer', receiverId, JSON.stringify(answer));
    } catch (err) {
      console.error('Error while sending answer:', err);
    }
  }

  async sendIceCandidate(receiverId: string, candidate: RTCIceCandidateInit): Promise<void> {
    if (!receiverId || !(await this.ensureConnected())) return;
    try {
      await this.hubconnection.invoke('SendIceCandidate', receiverId, JSON.stringify(candidate));
    } catch (err) {
      console.error('Error while sending ice candidate:', err);
    }
  }

  async sendMediaState(receiverId: string, isVideoOn: boolean, isAudioOn: boolean): Promise<void> {
    if (!receiverId || !(await this.ensureConnected())) return;
    try {
      await this.hubconnection.invoke('SendMediaState', receiverId, isVideoOn, isAudioOn);
    } catch (err) {
      console.error('Error while sending media state:', err);
    }
  }

  async sendEndCall(receiverId: string): Promise<void> {
    if (!receiverId || !(await this.ensureConnected())) return;
    try {
      await this.hubconnection.invoke('EndCall', receiverId);
    } catch (err) {
      console.error('Error while sending end call:', err);
    }
  }

  /** Plays the looping WhatsApp incoming call audio when a call starts ringing. */
  playIncomingCallSound(): void {
    if (typeof window === 'undefined') return;
    if (this.isRingtoneActive) return;

    this.isRingtoneActive = true;
    this.pendingRingtoneUnlock = false;

    const ctx = this.ensureAudioContext();
    if (ctx && this.incomingCallBuffer && ctx.state === 'running') {
      if (this.startBufferLoop(ctx, this.incomingCallBuffer)) {
        return;
      }
    }

    if (typeof Audio === 'undefined') return;
    try {
      const audio = new Audio(this.incomingCallBlobUrl || this.incomingCallSoundUrl);
      audio.loop = true;
      this.activeAudioElement = audio;
      const playResult = audio.play();
      if (playResult && typeof playResult.catch === 'function') {
        void playResult.catch(() => {
          // If autoplay was blocked prior to user interaction, retry once on next gesture.
          if (this.isRingtoneActive) {
            this.pendingRingtoneUnlock = true;
          }
        });
      }
      void this.preloadIncomingCallSound();
    } catch (err) {
      console.warn('Incoming call audio playback failed:', err);
    }
  }

  /** Stops and resets any active incoming call ringtone immediately. */
  stopIncomingCallSound(): void {
    this.isRingtoneActive = false;
    this.pendingRingtoneUnlock = false;

    if (this.activeBufferSource) {
      try {
        this.activeBufferSource.stop();
        this.activeBufferSource.disconnect();
      } catch {}
      this.activeBufferSource = null;
    }

    if (this.activeAudioElement) {
      try {
        this.activeAudioElement.pause();
        this.activeAudioElement.currentTime = 0;
      } catch {}
      this.activeAudioElement = null;
    }
  }

  /** Returns and clears ICE candidates buffered prior to PeerConnection initialization. */
  drainBufferedIceCandidates(senderId?: string): IceCandidatePayload[] {
    const matched = senderId
      ? this.bufferedIceCandidates.filter((c) => c.senderId === senderId)
      : [...this.bufferedIceCandidates];
    this.bufferedIceCandidates = senderId
      ? this.bufferedIceCandidates.filter((c) => c.senderId !== senderId)
      : [];
    this.iceCandidateReceived.next(null);
    return matched;
  }

  /** Clears transient call signaling state so subsequent calls start cleanly. */
  resetCallState(): void {
    this.stopIncomingCallSound();
    this.incomingCall = false;
    this.isCallActive = false;
    this.isRemoteUserOnline = true;
    this.remoteUserId = '';
    this.remoteUserName = '';
    this.remoteUserAvatar = '';
    this.bufferedIceCandidates = [];
    this.offerReceived.next(null);
    this.answerReceived.next(null);
    this.iceCandidateReceived.next(null);
  }

  private async ensureConnected(): Promise<boolean> {
    if (this.startPromise) {
      await this.startPromise;
    }
    if (!this.hubconnection || this.hubconnection.state === HubConnectionState.Disconnected) {
      await this.startConnection();
    }
    return this.hubconnection?.state === HubConnectionState.Connected;
  }

  private registerHubEvents(connection: HubConnection): void {
    connection.on('ReceiveOffer', (senderId: string, offer: string | RTCSessionDescriptionInit) => {
      if (this.hubconnection !== connection) return;
      const parsed = typeof offer === 'string' ? JSON.parse(offer) : offer;
      this.offerReceived.next({ senderId, offer: parsed });
    });

    connection.on('ReceiveAnswer', (senderId: string, answer: string | RTCSessionDescriptionInit) => {
      if (this.hubconnection !== connection) return;
      const parsed = typeof answer === 'string' ? JSON.parse(answer) : answer;
      this.answerReceived.next({ senderId, answer: parsed });
    });

    connection.on('ReceiveIceCandidate', (senderId: string, candidate: string | RTCIceCandidateInit) => {
      if (this.hubconnection !== connection) return;
      const parsed = typeof candidate === 'string' ? JSON.parse(candidate) : candidate;
      const payload: IceCandidatePayload = { senderId, candidate: parsed };
      if (!this.isCallActive) {
        this.bufferedIceCandidates.push(payload);
      }
      this.iceCandidateReceived.next(payload);
    });

    connection.on('ReceiveMediaState', (senderId: string, isVideoOn: boolean, isAudioOn: boolean) => {
      if (this.hubconnection !== connection) return;
      this.mediaStateReceived.next({ senderId, isVideoOn, isAudioOn });
    });

    connection.on('CallEnded', (senderId: string) => {
      if (this.hubconnection !== connection) return;
      this.stopIncomingCallSound();
      this.callEnded.next(senderId);
    });

    connection.on('UserOffline', (receiverId: string) => {
      if (this.hubconnection !== connection) return;
      this.isRemoteUserOnline = false;
      this.userOffline.next(receiverId);
    });
  }

  private registerAudioUnlock(): void {
    if (typeof window === 'undefined') return;
    const unlock = () => {
      this.unlockAudio();
      if (this.pendingRingtoneUnlock && this.isRingtoneActive) {
        this.pendingRingtoneUnlock = false;
        this.isRingtoneActive = false;
        this.playIncomingCallSound();
      }
    };
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock, { passive: true });
  }

  private ensureAudioContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.audioContext) {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctx) {
        this.audioContext = new Ctx();
      }
    }
    return this.audioContext;
  }

  private preloadIncomingCallSound(): Promise<void> {
    if (
      typeof window === 'undefined' ||
      typeof fetch === 'undefined' ||
      !window.location?.origin?.startsWith('http')
    ) {
      return Promise.resolve();
    }
    if (this.incomingCallBuffer || this.audioPreloadPromise) {
      return this.audioPreloadPromise ?? Promise.resolve();
    }

    const resolvedUrl = new URL(this.incomingCallSoundUrl, window.location.origin).toString();
    this.audioPreloadPromise = fetch(resolvedUrl)
      .then(async (res) => {
        if (!res.ok) return;
        const arrayBuffer = await res.arrayBuffer();
        if (!this.incomingCallBlobUrl && typeof URL !== 'undefined' && typeof Blob !== 'undefined') {
          this.incomingCallBlobUrl = URL.createObjectURL(new Blob([arrayBuffer], { type: 'audio/mpeg' }));
        }
        const ctx = this.ensureAudioContext();
        if (ctx) {
          this.incomingCallBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
        }
      })
      .catch((err) => {
        console.warn('Could not preload incoming call audio:', err);
      })
      .finally(() => {
        this.audioPreloadPromise = null;
      });

    return this.audioPreloadPromise;
  }

  private startBufferLoop(ctx: AudioContext, buffer: AudioBuffer): boolean {
    try {
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.connect(ctx.destination);
      source.start(0);
      this.activeBufferSource = source;
      return true;
    } catch {
      return false;
    }
  }
}
