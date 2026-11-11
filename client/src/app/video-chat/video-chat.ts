import { CommonModule } from '@angular/common';
import {
  AfterViewInit,
  Component,
  computed,
  ElementRef,
  HostListener,
  inject,
  OnDestroy,
  OnInit,
  signal,
  ViewChild,
} from '@angular/core';
import { MatDialogRef } from '@angular/material/dialog';
import { Subscription } from 'rxjs';
import { Chat } from '../services/chat';
import { VideoChatService } from '../services/video-chat';

@Component({
  imports: [CommonModule],
  selector: 'app-video-chat',
  templateUrl: './video-chat.html',
  styleUrl: './video-chat.css',
})
export class VideoChat implements OnInit, AfterViewInit, OnDestroy {
  private videoChatService = inject(VideoChatService);
  private chatService = inject(Chat, { optional: true });
  private dialogRef = inject(MatDialogRef<VideoChat>, { optional: true });
  private elementRef = inject(ElementRef<HTMLElement>);

  @ViewChild('localVideo') private localVideoRef?: ElementRef<HTMLVideoElement>;
  @ViewChild('remoteVideo') private remoteVideoRef?: ElementRef<HTMLVideoElement>;
  @ViewChild('videoStage') private videoStageRef?: ElementRef<HTMLElement>;
  @ViewChild('pipWindow') private pipWindowRef?: ElementRef<HTMLElement>;

  isCameraOn = signal<boolean>(true);
  isMicOn = signal<boolean>(true);
  isIncomingCall = signal<boolean>(false);
  isCallActive = signal<boolean>(false);
  isFullscreen = signal<boolean>(false);
  isModeMenuOpen = signal<boolean>(false);

  hasLocalVideoTrack = signal<boolean>(false);
  hasRemoteVideoTrack = signal<boolean>(false);
  remoteVideoEnabled = signal<boolean>(false);
  remoteAudioEnabled = signal<boolean>(true);
  remoteOfflineDetected = signal<boolean>(false);

  toastMessage = signal<string>('');
  elapsedSeconds = signal<number>(0);

  pipLeft = signal<number | null>(null);
  pipTop = signal<number | null>(null);

  isRemoteOnline = computed(() => {
    if (this.remoteOfflineDetected()) {
      return false;
    }
    const remoteId = this.videoChatService.remoteUserId;
    const users = this.chatService?.onlineUsers?.() ?? [];
    if (remoteId && users.length > 0) {
      const match = users.find((u) => u.id === remoteId);
      if (match && (match.isOnline !== undefined || match.IsOnline !== undefined)) {
        return Boolean(match.isOnline ?? match.IsOnline);
      }
    }
    return this.videoChatService.isRemoteUserOnline;
  });

  remoteDisplayName = computed(() => {
    if (this.videoChatService.remoteUserName) {
      return this.videoChatService.remoteUserName;
    }
    const remoteId = this.videoChatService.remoteUserId;
    if (remoteId && this.chatService) {
      const user = this.chatService.onlineUsers().find((u) => u.id === remoteId);
      if (user) {
        return user.fullName || user.userName || 'User';
      }
    }
    return this.isIncomingCall() ? 'Incoming Call' : 'User';
  });

  formattedDuration = computed(() => {
    const total = this.elapsedSeconds();
    const hrs = String(Math.floor(total / 3600)).padStart(2, '0');
    const mins = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
    const secs = String(total % 60).padStart(2, '0');
    return `${hrs}:${mins}:${secs}`;
  });

  showLocalPreview = computed(() => this.isCameraOn() && this.hasLocalVideoTrack());
  showRemoteVideo = computed(
    () => this.isCallActive() && this.hasRemoteVideoTrack() && this.remoteVideoEnabled()
  );

  private peerConnection: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private remoteStream: MediaStream | null = null;
  private videoSender: RTCRtpSender | null = null;
  private audioSender: RTCRtpSender | null = null;
  private pendingIceCandidates: RTCIceCandidateInit[] = [];
  private subscriptions = new Subscription();
  private timerInterval: ReturnType<typeof setInterval> | null = null;
  private toastTimeout: ReturnType<typeof setTimeout> | null = null;
  private hasEnded = false;
  private hasLoggedCall = false;
  private startedAsIncomingCall = false;
  private usedVideoDuringCall = false;
  private isNegotiating = false;

  private isDraggingPip = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private dragInitialLeft = 0;
  private dragInitialTop = 0;

  ngOnInit(): void {
    this.startedAsIncomingCall = this.videoChatService.incomingCall;
    this.isIncomingCall.set(this.videoChatService.incomingCall);
    this.isCallActive.set(this.videoChatService.isCallActive);
    const buffered =
      this.videoChatService.drainBufferedIceCandidates?.(this.videoChatService.remoteUserId) ?? [];
    for (const item of buffered) {
      this.pendingIceCandidates.push(item.candidate);
    }
    this.registerSignalListeners();

    if (this.videoChatService.incomingCall) {
      this.videoChatService.playIncomingCallSound();
    } else if (this.videoChatService.remoteUserId) {
      if (!this.isRemoteOnline()) {
        this.showToast(`${this.remoteDisplayName()} is offline right now`);
      }
      void this.startOutgoingCall();
    }
  }

  ngAfterViewInit(): void {
    this.attachStreamToElement(this.localVideoRef?.nativeElement, this.localStream, true);
    this.attachStreamToElement(this.remoteVideoRef?.nativeElement, this.remoteStream, false);
  }

  ngOnDestroy(): void {
    if (!this.hasEnded && this.videoChatService.remoteUserId) {
      this.recordCallLog(this.videoChatService.remoteUserId);
    }
    this.cleanupCallResources();
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.isModeMenuOpen()) return;
    const target = event.target as HTMLElement | null;
    if (!target) return;
    const leftControls = this.elementRef.nativeElement.querySelector('#caret-btn')?.parentElement;
    if (leftControls && !leftControls.contains(target)) {
      this.isModeMenuOpen.set(false);
    }
  }

  @HostListener('document:fullscreenchange')
  onFullscreenChange(): void {
    this.isFullscreen.set(Boolean(typeof document !== 'undefined' && document.fullscreenElement));
  }

  async acceptCall(): Promise<void> {
    this.videoChatService.stopIncomingCallSound();
    this.videoChatService.unlockAudio();

    const offerPayload = this.videoChatService.offerReceived.value;
    if (!offerPayload?.offer) {
      this.showToast('Offer unavailable');
      return;
    }

    if (!this.videoChatService.remoteUserId) {
      this.videoChatService.remoteUserId = offerPayload.senderId;
    }

    const pc = this.ensurePeerConnection();
    await this.prepareInitialLocalMedia(pc);

    if (!pc) {
      this.activateCallState();
      return;
    }

    try {
      await pc.setRemoteDescription(new RTCSessionDescription(offerPayload.offer));
      await this.flushPendingIceCandidates(pc);

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await this.videoChatService.sendAnswer(this.videoChatService.remoteUserId, answer);

      this.activateCallState();
      await this.videoChatService.sendMediaState(
        this.videoChatService.remoteUserId,
        this.isCameraOn(),
        this.isMicOn()
      );
    } catch (err) {
      console.error('Error accepting call:', err);
      this.showToast('Could not connect call');
    }
  }

  async toggleCamera(): Promise<void> {
    const nextCameraState = !this.isCameraOn();
    await this.applyCameraState(nextCameraState);
  }

  async toggleMic(): Promise<void> {
    const nextMicState = !this.isMicOn();
    this.isMicOn.set(nextMicState);

    if (this.localStream) {
      for (const track of this.localStream.getAudioTracks()) {
        track.enabled = nextMicState;
      }
    }

    if (nextMicState && this.peerConnection && (!this.localStream || this.localStream.getAudioTracks().length === 0)) {
      await this.acquireAndAttachAudioTrack();
    }

    if (this.videoChatService.remoteUserId) {
      void this.videoChatService.sendMediaState(
        this.videoChatService.remoteUserId,
        this.isCameraOn(),
        nextMicState
      );
    }

    this.showToast(nextMicState ? 'Microphone unmuted' : 'Microphone muted');
  }

  toggleModeMenu(event: MouseEvent): void {
    event.stopPropagation();
    this.isModeMenuOpen.update((open) => !open);
  }

  async setCallMode(mode: 'audio-video' | 'audio-only'): Promise<void> {
    this.isModeMenuOpen.set(false);
    const targetVideoOn = mode === 'audio-video';
    if (this.isCameraOn() !== targetVideoOn) {
      await this.applyCameraState(targetVideoOn);
    } else {
      this.showToast(targetVideoOn ? 'Audio & Video mode active' : 'Audio-only mode active');
    }
  }

  toggleFullscreen(): void {
    if (typeof document === 'undefined') return;
    if (!document.fullscreenElement) {
      const target = this.elementRef.nativeElement;
      const req = target.requestFullscreen?.bind(target) ?? document.documentElement.requestFullscreen?.bind(document.documentElement);
      if (req) {
        void Promise.resolve(req())
          .then(() => this.isFullscreen.set(true))
          .catch(() => {
            this.isFullscreen.update((v) => !v);
            this.showToast('Fullscreen toggled');
          });
      } else {
        this.isFullscreen.update((v) => !v);
      }
    } else {
      void Promise.resolve(document.exitFullscreen?.())
        .then(() => this.isFullscreen.set(false))
        .catch(() => this.isFullscreen.set(false));
    }
  }

  endCall(notifyRemote = true): void {
    if (this.hasEnded) return;
    this.hasEnded = true;

    const targetId = this.videoChatService.remoteUserId;
    this.videoChatService.stopIncomingCallSound();

    if (targetId) {
      this.recordCallLog(targetId);
    }

    if (notifyRemote && targetId) {
      void this.videoChatService.sendEndCall(targetId);
    }

    this.cleanupCallResources();
    this.videoChatService.resetCallState();
    this.videoChatService.isDialogOpen = false;
    this.dialogRef?.close();
  }

  private recordCallLog(targetUserId: string): void {
    if (this.hasLoggedCall || this.startedAsIncomingCall || !targetUserId) {
      return;
    }
    this.hasLoggedCall = true;

    const wasConnected = this.isCallActive();
    const durationSeconds = wasConnected ? this.elapsedSeconds() : 0;
    const status = wasConnected
      ? 'completed'
      : !this.isRemoteOnline()
        ? 'offline'
        : 'cancelled';
    const callType = this.usedVideoDuringCall ? 'video' : 'audio';

    void this.chatService?.sendCallLog?.(targetUserId, {
      callType,
      status,
      durationSeconds,
      endedAt: new Date().toISOString(),
    });
  }

  onPipPointerDown(event: PointerEvent): void {
    const pipEl = this.pipWindowRef?.nativeElement;
    const stageEl = this.videoStageRef?.nativeElement;
    if (!pipEl || !stageEl) return;

    this.isDraggingPip = true;
    pipEl.setPointerCapture?.(event.pointerId);

    const pipRect = pipEl.getBoundingClientRect();
    const stageRect = stageEl.getBoundingClientRect();

    this.dragStartX = event.clientX;
    this.dragStartY = event.clientY;
    this.dragInitialLeft = pipRect.left - stageRect.left;
    this.dragInitialTop = pipRect.top - stageRect.top;

    this.pipLeft.set(this.dragInitialLeft);
    this.pipTop.set(this.dragInitialTop);
  }

  onPipPointerMove(event: PointerEvent): void {
    if (!this.isDraggingPip) return;
    const pipEl = this.pipWindowRef?.nativeElement;
    const stageEl = this.videoStageRef?.nativeElement;
    if (!pipEl || !stageEl) return;

    const stageRect = stageEl.getBoundingClientRect();
    const pipRect = pipEl.getBoundingClientRect();
    const padding = 12;

    const maxLeft = Math.max(padding, stageRect.width - pipRect.width - padding);
    const maxTop = Math.max(padding, stageRect.height - pipRect.height - padding);

    const nextLeft = Math.max(padding, Math.min(this.dragInitialLeft + (event.clientX - this.dragStartX), maxLeft));
    const nextTop = Math.max(padding, Math.min(this.dragInitialTop + (event.clientY - this.dragStartY), maxTop));

    this.pipLeft.set(nextLeft);
    this.pipTop.set(nextTop);
  }

  onPipPointerUp(): void {
    this.isDraggingPip = false;
  }

  private async startOutgoingCall(): Promise<void> {
    const pc = this.ensurePeerConnection();
    await this.prepareInitialLocalMedia(pc);

    if (!pc || !this.videoChatService.remoteUserId) {
      return;
    }

    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await this.videoChatService.sendOffer(this.videoChatService.remoteUserId, offer);
      await this.videoChatService.sendMediaState(
        this.videoChatService.remoteUserId,
        this.isCameraOn(),
        this.isMicOn()
      );
    } catch (err) {
      console.error('Error creating outgoing offer:', err);
      this.showToast('Unable to start call');
    }
  }

  private registerSignalListeners(): void {
    this.subscriptions.add(
      this.videoChatService.offerReceived.subscribe(async (data) => {
        if (!data || !this.peerConnection || !this.isCallActive()) return;
        if (this.videoChatService.remoteUserId && data.senderId !== this.videoChatService.remoteUserId) {
          return;
        }
        try {
          await this.peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
          await this.flushPendingIceCandidates(this.peerConnection);
          const answer = await this.peerConnection.createAnswer();
          await this.peerConnection.setLocalDescription(answer);
          await this.videoChatService.sendAnswer(data.senderId, answer);
        } catch (err) {
          console.error('Error handling renegotiation offer:', err);
        }
      })
    );

    this.subscriptions.add(
      this.videoChatService.answerReceived.subscribe(async (data) => {
        if (!data || !this.peerConnection) return;
        if (this.videoChatService.remoteUserId && data.senderId !== this.videoChatService.remoteUserId) {
          return;
        }
        try {
          await this.peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
          await this.flushPendingIceCandidates(this.peerConnection);
          this.activateCallState();
          await this.videoChatService.sendMediaState(
            this.videoChatService.remoteUserId,
            this.isCameraOn(),
            this.isMicOn()
          );
        } catch (err) {
          console.error('Error applying answer:', err);
        }
      })
    );

    this.subscriptions.add(
      this.videoChatService.iceCandidateReceived.subscribe(async (data) => {
        if (!data?.candidate) return;
        if (this.videoChatService.remoteUserId && data.senderId !== this.videoChatService.remoteUserId) {
          return;
        }
        if (this.peerConnection && this.peerConnection.remoteDescription) {
          try {
            await this.peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
          } catch (err) {
            console.error('Error adding ICE candidate:', err);
          }
        } else {
          this.pendingIceCandidates.push(data.candidate);
        }
      })
    );

    this.subscriptions.add(
      this.videoChatService.mediaStateReceived.subscribe((state) => {
        if (this.videoChatService.remoteUserId && state.senderId !== this.videoChatService.remoteUserId) {
          return;
        }
        this.remoteVideoEnabled.set(state.isVideoOn);
        this.remoteAudioEnabled.set(state.isAudioOn);
      })
    );

    this.subscriptions.add(
      this.videoChatService.callEnded.subscribe((senderId) => {
        if (this.videoChatService.remoteUserId && senderId && senderId !== this.videoChatService.remoteUserId) {
          return;
        }
        this.showToast('Call ended');
        this.endCall(false);
      })
    );

    if (this.videoChatService.userOffline) {
      this.subscriptions.add(
        this.videoChatService.userOffline.subscribe((receiverId) => {
          if (
            this.videoChatService.remoteUserId &&
            receiverId &&
            receiverId !== this.videoChatService.remoteUserId
          ) {
            return;
          }
          this.remoteOfflineDetected.set(true);
          this.showToast(`${this.remoteDisplayName()} is offline right now`);
        })
      );
    }
  }

  private ensurePeerConnection(): RTCPeerConnection | null {
    if (this.peerConnection) {
      return this.peerConnection;
    }
    if (typeof RTCPeerConnection === 'undefined') {
      return null;
    }

    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ],
    });

    this.peerConnection = pc;
    this.videoChatService.preConnection = pc;

    pc.onicecandidate = (event) => {
      if (event.candidate && this.videoChatService.remoteUserId) {
        void this.videoChatService.sendIceCandidate(
          this.videoChatService.remoteUserId,
          event.candidate.toJSON()
        );
      }
    };

    pc.ontrack = (event) => {
      const incomingStream = event.streams?.[0];
      if (incomingStream) {
        this.remoteStream = incomingStream;
      } else {
        if (!this.remoteStream) {
          this.remoteStream = new MediaStream();
        }
        if (event.track && !this.remoteStream.getTracks().includes(event.track)) {
          this.remoteStream.addTrack(event.track);
        }
      }

      this.attachStreamToElement(this.remoteVideoRef?.nativeElement, this.remoteStream, false);

      if (event.track.kind === 'video') {
        this.hasRemoteVideoTrack.set(true);
        if (!event.track.muted && event.track.readyState === 'live') {
          this.remoteVideoEnabled.set(true);
          this.usedVideoDuringCall = true;
        }
        event.track.onunmute = () => {
          this.hasRemoteVideoTrack.set(true);
          this.remoteVideoEnabled.set(true);
          this.usedVideoDuringCall = true;
        };
        event.track.onmute = () => {
          this.remoteVideoEnabled.set(false);
        };
        event.track.onended = () => {
          this.hasRemoteVideoTrack.set(false);
          this.remoteVideoEnabled.set(false);
        };
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        this.activateCallState();
      } else if (pc.connectionState === 'failed') {
        this.showToast('Connection lost');
      }
    };

    return pc;
  }

  private async prepareInitialLocalMedia(pc: RTCPeerConnection | null): Promise<void> {
    const stream = await this.acquireInitialMediaStream();
    if (stream) {
      this.localStream = stream;
      this.attachStreamToElement(this.localVideoRef?.nativeElement, stream, true);

      if (pc) {
        for (const track of stream.getTracks()) {
          const sender = pc.addTrack(track, stream);
          if (track.kind === 'video') {
            this.videoSender = sender;
          } else if (track.kind === 'audio') {
            this.audioSender = sender;
          }
        }
      }
    }

    // Reserve a sendrecv video transceiver when starting audio-only so upgrading to video works smoothly.
    if (pc && !this.videoSender && typeof pc.addTransceiver === 'function') {
      const existingVideoTransceiver = pc
        .getTransceivers?.()
        .find((t) => t.receiver?.track?.kind === 'video' || t.sender?.track?.kind === 'video');

      if (existingVideoTransceiver) {
        this.videoSender = existingVideoTransceiver.sender;
      } else if (!this.videoChatService.incomingCall) {
        const transceiver = pc.addTransceiver('video', { direction: 'sendrecv' });
        this.videoSender = transceiver.sender;
      }
    }
  }

  private async acquireInitialMediaStream(): Promise<MediaStream | null> {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      this.hasLocalVideoTrack.set(false);
      return null;
    }

    const wantVideo = this.isCameraOn();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: wantVideo,
      });
      this.enforceLocalTrackStates(stream);
      return stream;
    } catch {
      if (wantVideo) {
        try {
          const audioOnlyStream = await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: false,
          });
          this.isCameraOn.set(false);
          this.hasLocalVideoTrack.set(false);
          this.enforceLocalTrackStates(audioOnlyStream);
          this.showToast('Camera unavailable — Audio-only mode');
          return audioOnlyStream;
        } catch {
          this.isCameraOn.set(false);
          this.isMicOn.set(false);
          this.hasLocalVideoTrack.set(false);
          this.showToast('Microphone and camera unavailable');
          return null;
        }
      }

      this.isMicOn.set(false);
      this.hasLocalVideoTrack.set(false);
      this.showToast('Microphone unavailable');
      return null;
    }
  }

  private enforceLocalTrackStates(stream: MediaStream): void {
    for (const track of stream.getAudioTracks()) {
      track.enabled = this.isMicOn();
    }
    const videoTracks = stream.getVideoTracks();
    for (const track of videoTracks) {
      track.enabled = this.isCameraOn();
    }
    const hasLiveVideo = videoTracks.length > 0 && this.isCameraOn();
    this.hasLocalVideoTrack.set(hasLiveVideo);
    if (hasLiveVideo) {
      this.usedVideoDuringCall = true;
    }
  }

  private async applyCameraState(enableVideo: boolean): Promise<void> {
    if (!enableVideo) {
      this.isCameraOn.set(false);
      this.hasLocalVideoTrack.set(false);

      if (this.localStream) {
        for (const track of this.localStream.getVideoTracks()) {
          track.enabled = false;
          track.stop();
          this.localStream.removeTrack(track);
        }
      }

      const sender = this.findVideoSender();
      if (sender) {
        try {
          await sender.replaceTrack(null);
        } catch {}
      }

      if (this.videoChatService.remoteUserId) {
        void this.videoChatService.sendMediaState(
          this.videoChatService.remoteUserId,
          false,
          this.isMicOn()
        );
      }

      this.showToast('Camera turned off — Audio only');
      return;
    }

    // If incoming call hasn't been accepted yet, update preference so acceptCall acquires video.
    if (this.isIncomingCall() && !this.isCallActive()) {
      this.isCameraOn.set(true);
      this.showToast('Camera will start when call is accepted');
      return;
    }

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      this.isCameraOn.set(false);
      this.hasLocalVideoTrack.set(false);
      this.showToast('Camera unavailable');
      return;
    }

    try {
      const videoStream = await navigator.mediaDevices.getUserMedia({ video: true });
      const newVideoTrack = videoStream.getVideoTracks()[0];
      if (!newVideoTrack) {
        throw new Error('No video track returned');
      }

      if (!this.localStream) {
        this.localStream = new MediaStream();
      }
      for (const oldTrack of this.localStream.getVideoTracks()) {
        oldTrack.stop();
        this.localStream.removeTrack(oldTrack);
      }
      this.localStream.addTrack(newVideoTrack);

      this.isCameraOn.set(true);
      this.hasLocalVideoTrack.set(true);
      this.usedVideoDuringCall = true;
      this.attachStreamToElement(this.localVideoRef?.nativeElement, this.localStream, true);

      if (this.peerConnection) {
        const sender = this.findVideoSender();
        if (sender) {
          await sender.replaceTrack(newVideoTrack);
          const transceiver = this.peerConnection
            .getTransceivers?.()
            .find((t) => t.sender === sender);
          if (transceiver && transceiver.direction !== 'sendrecv') {
            transceiver.direction = 'sendrecv';
            await this.renegotiateOffer();
          }
        } else {
          this.videoSender = this.peerConnection.addTrack(newVideoTrack, this.localStream);
          await this.renegotiateOffer();
        }
      }

      if (this.videoChatService.remoteUserId) {
        void this.videoChatService.sendMediaState(
          this.videoChatService.remoteUserId,
          true,
          this.isMicOn()
        );
      }

      this.showToast('Camera enabled');
    } catch {
      this.isCameraOn.set(false);
      this.hasLocalVideoTrack.set(false);
      this.showToast('Camera unavailable — Audio-only mode');
    }
  }

  private async acquireAndAttachAudioTrack(): Promise<void> {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      return;
    }
    try {
      const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const audioTrack = audioStream.getAudioTracks()[0];
      if (!audioTrack) return;

      if (!this.localStream) {
        this.localStream = new MediaStream();
      }
      this.localStream.addTrack(audioTrack);

      if (this.peerConnection) {
        if (this.audioSender) {
          await this.audioSender.replaceTrack(audioTrack);
        } else {
          this.audioSender = this.peerConnection.addTrack(audioTrack, this.localStream);
          await this.renegotiateOffer();
        }
      }
    } catch {
      this.isMicOn.set(false);
      this.showToast('Microphone unavailable');
    }
  }

  private findVideoSender(): RTCRtpSender | null {
    if (this.videoSender) return this.videoSender;
    if (!this.peerConnection) return null;

    const senderByTrack = this.peerConnection
      .getSenders()
      .find((s) => s.track?.kind === 'video');
    if (senderByTrack) {
      this.videoSender = senderByTrack;
      return senderByTrack;
    }

    const transceiver = this.peerConnection
      .getTransceivers?.()
      .find((t) => t.receiver?.track?.kind === 'video');
    if (transceiver) {
      this.videoSender = transceiver.sender;
      return transceiver.sender;
    }

    return null;
  }

  private async renegotiateOffer(): Promise<void> {
    if (
      !this.peerConnection ||
      !this.isCallActive() ||
      !this.videoChatService.remoteUserId ||
      this.isNegotiating
    ) {
      return;
    }
    this.isNegotiating = true;
    try {
      const offer = await this.peerConnection.createOffer();
      await this.peerConnection.setLocalDescription(offer);
      await this.videoChatService.sendOffer(this.videoChatService.remoteUserId, offer);
    } catch (err) {
      console.error('Error renegotiating offer:', err);
    } finally {
      this.isNegotiating = false;
    }
  }

  private async flushPendingIceCandidates(pc: RTCPeerConnection): Promise<void> {
    while (this.pendingIceCandidates.length > 0) {
      const candidate = this.pendingIceCandidates.shift();
      if (!candidate) continue;
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.error('Error flushing ICE candidate:', err);
      }
    }
  }

  private activateCallState(): void {
    this.videoChatService.stopIncomingCallSound();
    this.videoChatService.incomingCall = false;
    this.videoChatService.isCallActive = true;
    this.isIncomingCall.set(false);

    if (!this.isCallActive()) {
      this.isCallActive.set(true);
      this.startCallTimer();
    }
  }

  private startCallTimer(): void {
    if (this.timerInterval) return;
    this.elapsedSeconds.set(0);
    this.timerInterval = setInterval(() => {
      this.elapsedSeconds.update((s) => s + 1);
    }, 1000);
  }

  private showToast(message: string): void {
    this.toastMessage.set(message);
    if (this.toastTimeout) {
      clearTimeout(this.toastTimeout);
    }
    this.toastTimeout = setTimeout(() => {
      this.toastMessage.set('');
    }, 1800);
  }

  private attachStreamToElement(
    videoEl: HTMLVideoElement | undefined,
    stream: MediaStream | null,
    muted: boolean
  ): void {
    if (!videoEl) return;
    videoEl.muted = muted;
    if (videoEl.srcObject !== stream) {
      videoEl.srcObject = stream;
    }
    if (stream && typeof videoEl.play === 'function') {
      try {
        const playPromise = videoEl.play();
        if (playPromise && typeof playPromise.catch === 'function') {
          void playPromise.catch(() => {});
        }
      } catch {}
    }
  }

  private cleanupCallResources(): void {
    this.subscriptions.unsubscribe();

    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    if (this.toastTimeout) {
      clearTimeout(this.toastTimeout);
      this.toastTimeout = null;
    }

    if (this.localStream) {
      for (const track of this.localStream.getTracks()) {
        track.stop();
      }
      this.localStream = null;
    }

    if (this.remoteStream) {
      for (const track of this.remoteStream.getTracks()) {
        track.stop();
      }
      this.remoteStream = null;
    }

    if (this.localVideoRef?.nativeElement) {
      this.localVideoRef.nativeElement.srcObject = null;
    }
    if (this.remoteVideoRef?.nativeElement) {
      this.remoteVideoRef.nativeElement.srcObject = null;
    }

    if (this.peerConnection) {
      this.peerConnection.onicecandidate = null;
      this.peerConnection.ontrack = null;
      this.peerConnection.onconnectionstatechange = null;
      this.peerConnection.close();
      this.peerConnection = null;
    }

    this.videoSender = null;
    this.audioSender = null;
    this.pendingIceCandidates = [];
    this.videoChatService.stopIncomingCallSound();
  }
}
