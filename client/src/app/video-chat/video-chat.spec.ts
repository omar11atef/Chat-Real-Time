import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatDialogRef } from '@angular/material/dialog';
import { BehaviorSubject, Subject } from 'rxjs';
import { User } from '../models/user';
import { Chat } from '../services/chat';
import {
  AnswerPayload,
  IceCandidatePayload,
  MediaStatePayload,
  OfferPayload,
  VideoChatService,
} from '../services/video-chat';
import { VideoChat } from './video-chat';

class MockTrack {
  enabled = true;
  muted = false;
  readyState: MediaStreamTrackState = 'live';
  onmute: (() => void) | null = null;
  onunmute: (() => void) | null = null;
  onended: (() => void) | null = null;
  stop = vi.fn(() => {
    this.readyState = 'ended';
  });

  constructor(public kind: 'audio' | 'video') {}
}

class MockMediaStream {
  private tracks: MockTrack[];

  constructor(tracks: MockTrack[] = []) {
    this.tracks = [...tracks];
  }

  getTracks() {
    return [...this.tracks];
  }

  getAudioTracks() {
    return this.tracks.filter((t) => t.kind === 'audio');
  }

  getVideoTracks() {
    return this.tracks.filter((t) => t.kind === 'video');
  }

  addTrack(track: MockTrack) {
    this.tracks.push(track);
  }

  removeTrack(track: MockTrack) {
    this.tracks = this.tracks.filter((t) => t !== track);
  }
}

describe('VideoChat', () => {
  let mockVideoService: {
    offerReceived: BehaviorSubject<OfferPayload | null>;
    answerReceived: BehaviorSubject<AnswerPayload | null>;
    iceCandidateReceived: BehaviorSubject<IceCandidatePayload | null>;
    mediaStateReceived: Subject<MediaStatePayload>;
    callEnded: Subject<string>;
    incomingCall: boolean;
    isCallActive: boolean;
    isDialogOpen: boolean;
    remoteUserId: string;
    remoteUserName: string;
    remoteUserAvatar: string;
    preConnection: RTCPeerConnection | undefined;
    playIncomingCallSound: ReturnType<typeof vi.fn>;
    stopIncomingCallSound: ReturnType<typeof vi.fn>;
    unlockAudio: ReturnType<typeof vi.fn>;
    sendOffer: ReturnType<typeof vi.fn>;
    sendAnswer: ReturnType<typeof vi.fn>;
    sendIceCandidate: ReturnType<typeof vi.fn>;
    sendMediaState: ReturnType<typeof vi.fn>;
    sendEndCall: ReturnType<typeof vi.fn>;
    resetCallState: ReturnType<typeof vi.fn>;
    drainBufferedIceCandidates: ReturnType<typeof vi.fn>;
  };

  let closeSpy: ReturnType<typeof vi.fn>;
  let originalMediaDevices: MediaDevices | undefined;
  let originalRtcPeerConnection: typeof RTCPeerConnection | undefined;
  let originalRtcSessionDescription: typeof RTCSessionDescription | undefined;
  let originalMediaStream: typeof MediaStream | undefined;

  let fakeAudioTrack: MockTrack;
  let fakeVideoTrack: MockTrack;
  let fakePcInstance: {
    remoteDescription: RTCSessionDescription | null;
    connectionState: RTCPeerConnectionState;
    onicecandidate: ((ev: { candidate: null }) => void) | null;
    ontrack: ((ev: unknown) => void) | null;
    onconnectionstatechange: (() => void) | null;
    addTrack: ReturnType<typeof vi.fn>;
    addTransceiver: ReturnType<typeof vi.fn>;
    getSenders: ReturnType<typeof vi.fn>;
    getTransceivers: ReturnType<typeof vi.fn>;
    createOffer: ReturnType<typeof vi.fn>;
    createAnswer: ReturnType<typeof vi.fn>;
    setLocalDescription: ReturnType<typeof vi.fn>;
    setRemoteDescription: ReturnType<typeof vi.fn>;
    addIceCandidate: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    fakeAudioTrack = new MockTrack('audio');
    fakeVideoTrack = new MockTrack('video');

    const senders: Array<{ track: MockTrack | null; replaceTrack: ReturnType<typeof vi.fn> }> = [];
    fakePcInstance = {
      remoteDescription: null,
      connectionState: 'new',
      onicecandidate: null,
      ontrack: null,
      onconnectionstatechange: null,
      addTrack: vi.fn((track: MockTrack) => {
        const sender: { track: MockTrack | null; replaceTrack: ReturnType<typeof vi.fn> } = {
          track,
          replaceTrack: vi.fn(async (next: MockTrack | null) => {
            sender.track = next;
          }),
        };
        senders.push(sender);
        return sender;
      }),
      addTransceiver: vi.fn(() => {
        const sender = {
          track: null as MockTrack | null,
          replaceTrack: vi.fn(async (next: MockTrack | null) => {
            sender.track = next;
          }),
        };
        senders.push(sender);
        return { sender, direction: 'sendrecv', receiver: { track: { kind: 'video' } } };
      }),
      getSenders: vi.fn(() => senders),
      getTransceivers: vi.fn(() => []),
      createOffer: vi.fn().mockResolvedValue({ type: 'offer', sdp: 'fake-offer-sdp' }),
      createAnswer: vi.fn().mockResolvedValue({ type: 'answer', sdp: 'fake-answer-sdp' }),
      setLocalDescription: vi.fn().mockResolvedValue(undefined),
      setRemoteDescription: vi.fn(async (desc: RTCSessionDescription) => {
        fakePcInstance.remoteDescription = desc;
      }),
      addIceCandidate: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
    };

    originalMediaDevices = navigator.mediaDevices;
    originalRtcPeerConnection = globalThis.RTCPeerConnection;
    originalRtcSessionDescription = globalThis.RTCSessionDescription;
    originalMediaStream = globalThis.MediaStream;

    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn(async (constraints: MediaStreamConstraints) => {
          const tracks: MockTrack[] = [];
          if (constraints.audio) tracks.push(fakeAudioTrack);
          if (constraints.video) tracks.push(new MockTrack('video'));
          return new MockMediaStream(tracks);
        }),
      },
    });

    (globalThis as unknown as { RTCPeerConnection: unknown }).RTCPeerConnection = vi.fn(
      function () {
        return fakePcInstance;
      }
    );
    (globalThis as unknown as { RTCSessionDescription: unknown }).RTCSessionDescription = vi.fn(
      function (init: RTCSessionDescriptionInit) {
        return init;
      }
    );
    (globalThis as unknown as { MediaStream: unknown }).MediaStream = MockMediaStream;

    closeSpy = vi.fn();
    mockVideoService = {
      offerReceived: new BehaviorSubject<OfferPayload | null>(null),
      answerReceived: new BehaviorSubject<AnswerPayload | null>(null),
      iceCandidateReceived: new BehaviorSubject<IceCandidatePayload | null>(null),
      mediaStateReceived: new Subject<MediaStatePayload>(),
      callEnded: new Subject<string>(),
      incomingCall: false,
      isCallActive: false,
      isDialogOpen: true,
      remoteUserId: 'u-peer',
      remoteUserName: 'Pushpa Raj',
      remoteUserAvatar: '',
      preConnection: undefined,
      playIncomingCallSound: vi.fn(),
      stopIncomingCallSound: vi.fn(),
      unlockAudio: vi.fn(),
      sendOffer: vi.fn().mockResolvedValue(undefined),
      sendAnswer: vi.fn().mockResolvedValue(undefined),
      sendIceCandidate: vi.fn().mockResolvedValue(undefined),
      sendMediaState: vi.fn().mockResolvedValue(undefined),
      sendEndCall: vi.fn().mockResolvedValue(undefined),
      resetCallState: vi.fn(),
      drainBufferedIceCandidates: vi.fn().mockReturnValue([]),
    };

    await TestBed.configureTestingModule({
      imports: [VideoChat],
      providers: [
        { provide: VideoChatService, useValue: mockVideoService },
        { provide: MatDialogRef, useValue: { close: closeSpy } },
        {
          provide: Chat,
          useValue: {
            onlineUsers: signal<User[]>([{ id: 'u-peer', fullName: 'Pushpa Raj', userName: 'pushpa' }]),
          },
        },
      ],
    }).compileComponents();
  });

  afterEach(() => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: originalMediaDevices,
    });
    (globalThis as unknown as { RTCPeerConnection: unknown }).RTCPeerConnection =
      originalRtcPeerConnection;
    (globalThis as unknown as { RTCSessionDescription: unknown }).RTCSessionDescription =
      originalRtcSessionDescription;
    (globalThis as unknown as { MediaStream: unknown }).MediaStream = originalMediaStream;
  });

  it('renders code_artifact style stage and controls without share or message buttons', async () => {
    const fixture = TestBed.createComponent(VideoChat);
    fixture.detectChanges();
    await fixture.whenStable();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('#video-stage')).toBeTruthy();
    expect(el.querySelector('#pip-window')).toBeTruthy();
    expect(el.querySelector('#cam-btn')).toBeTruthy();
    expect(el.querySelector('#mic-btn')).toBeTruthy();
    expect(el.querySelector('#end-btn')).toBeTruthy();
    expect(el.querySelector('#fullscreen-btn')).toBeTruthy();
    expect(el.querySelector('.remote-username')?.textContent?.trim()).toBe('Pushpa Raj');

    // Share and chat/message buttons and drawer must NOT exist
    expect(el.querySelector('#share-btn')).toBeNull();
    expect(el.querySelector('#chat-btn')).toBeNull();
    expect(el.querySelector('#chat-drawer')).toBeNull();
  });

  it('starts an outgoing call by creating and sending a WebRTC offer', async () => {
    const fixture = TestBed.createComponent(VideoChat);
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r, 0));

    expect(fakePcInstance.createOffer).toHaveBeenCalledTimes(1);
    expect(mockVideoService.sendOffer).toHaveBeenCalledWith('u-peer', {
      type: 'offer',
      sdp: 'fake-offer-sdp',
    });
    expect(mockVideoService.playIncomingCallSound).not.toHaveBeenCalled();
  });

  it('toggles microphone and video on/off (audio-only vs audio-and-video)', async () => {
    const fixture = TestBed.createComponent(VideoChat);
    const component = fixture.componentInstance;
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r, 0));

    const micBtn = fixture.nativeElement.querySelector('#mic-btn') as HTMLButtonElement;
    const camBtn = fixture.nativeElement.querySelector('#cam-btn') as HTMLButtonElement;

    expect(component.isMicOn()).toBe(true);
    expect(component.isCameraOn()).toBe(true);

    // Mute mic
    micBtn.click();
    fixture.detectChanges();
    expect(component.isMicOn()).toBe(false);
    expect(fakeAudioTrack.enabled).toBe(false);
    expect(mockVideoService.sendMediaState).toHaveBeenLastCalledWith('u-peer', true, false);

    // Toggle video off (switches to audio-only mode)
    await component.toggleCamera();
    fixture.detectChanges();
    expect(component.isCameraOn()).toBe(false);
    expect(component.showLocalPreview()).toBe(false);
    expect(mockVideoService.sendMediaState).toHaveBeenLastCalledWith('u-peer', false, false);

    // Toggle video back on (audio & video)
    await component.toggleCamera();
    fixture.detectChanges();
    expect(component.isCameraOn()).toBe(true);
    expect(component.showLocalPreview()).toBe(true);
    expect(mockVideoService.sendMediaState).toHaveBeenLastCalledWith('u-peer', true, false);

    // Unmute mic via button click
    micBtn.click();
    fixture.detectChanges();
    expect(component.isMicOn()).toBe(true);
    expect(fakeAudioTrack.enabled).toBe(true);

    expect(camBtn).toBeTruthy();
  });

  it('plays incoming call sound on incoming call and stops it on accept, sending answer', async () => {
    mockVideoService.incomingCall = true;
    mockVideoService.offerReceived.next({
      senderId: 'u-peer',
      offer: { type: 'offer', sdp: 'incoming-sdp' },
    });

    const fixture = TestBed.createComponent(VideoChat);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(mockVideoService.playIncomingCallSound).toHaveBeenCalledTimes(1);

    const acceptBtn = fixture.nativeElement.querySelector('#accept-btn') as HTMLButtonElement | null;
    expect(acceptBtn).toBeTruthy();

    // Switch to audio-only before accepting
    await fixture.componentInstance.toggleCamera();
    fixture.detectChanges();
    expect(fixture.componentInstance.isCameraOn()).toBe(false);

    await fixture.componentInstance.acceptCall();
    fixture.detectChanges();

    expect(mockVideoService.stopIncomingCallSound).toHaveBeenCalled();
    expect(fakePcInstance.setRemoteDescription).toHaveBeenCalled();
    expect(fakePcInstance.createAnswer).toHaveBeenCalledTimes(1);
    expect(mockVideoService.sendAnswer).toHaveBeenCalledWith('u-peer', {
      type: 'answer',
      sdp: 'fake-answer-sdp',
    });
    expect(fixture.componentInstance.isCallActive()).toBe(true);
    expect(fixture.nativeElement.querySelector('#accept-btn')).toBeNull();
  });

  it('notifies remote and closes dialog when End Call is clicked', async () => {
    const fixture = TestBed.createComponent(VideoChat);
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r, 0));

    const endBtn = fixture.nativeElement.querySelector('#end-btn') as HTMLButtonElement;
    endBtn.click();
    fixture.detectChanges();

    expect(mockVideoService.stopIncomingCallSound).toHaveBeenCalled();
    expect(mockVideoService.sendEndCall).toHaveBeenCalledWith('u-peer');
    expect(mockVideoService.resetCallState).toHaveBeenCalled();
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  it('switches between audio-only and audio-video via the mode menu and falls back to audio-only when camera fails', async () => {
    const fixture = TestBed.createComponent(VideoChat);
    const component = fixture.componentInstance;
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r, 0));

    const caretBtn = fixture.nativeElement.querySelector('#caret-btn') as HTMLButtonElement;
    caretBtn.click();
    fixture.detectChanges();

    const menuItems = fixture.nativeElement.querySelectorAll('.mode-popover button[role="menuitem"]') as NodeListOf<HTMLButtonElement>;
    expect(menuItems.length).toBe(2);

    // Switch to Audio Only via menu
    menuItems[1].click();
    await new Promise((r) => setTimeout(r, 0));
    fixture.detectChanges();
    expect(component.isCameraOn()).toBe(false);

    // Simulate camera hardware unavailable when trying to switch back to Audio & Video
    (navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('NotFoundError')
    );
    await component.setCallMode('audio-video');
    fixture.detectChanges();

    expect(component.isCameraOn()).toBe(false);
    expect(component.showLocalPreview()).toBe(false);
  });

  it('closes dialog cleanly when remote peer emits callEnded', async () => {
    const fixture = TestBed.createComponent(VideoChat);
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r, 0));

    mockVideoService.callEnded.next('u-peer');
    fixture.detectChanges();

    expect(mockVideoService.stopIncomingCallSound).toHaveBeenCalled();
    expect(mockVideoService.resetCallState).toHaveBeenCalled();
    expect(mockVideoService.sendEndCall).not.toHaveBeenCalled();
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });
});
