import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { BehaviorSubject, Subject } from 'rxjs';
import { App } from './app';
import { User } from './models/user';
import { AuthService } from './services/auth-service';
import { Chat } from './services/chat';
import { OfferPayload, VideoChatService } from './services/video-chat';
import { VideoChat } from './video-chat/video-chat';

describe('App', () => {
  let offerReceived$: BehaviorSubject<OfferPayload | null>;
  let callEnded$: Subject<string>;
  let afterClosed$: Subject<void>;
  let dialogOpenSpy: ReturnType<typeof vi.fn>;
  let dialogCloseSpy: ReturnType<typeof vi.fn>;
  let mockVideoChatService: {
    offerReceived: BehaviorSubject<OfferPayload | null>;
    callEnded: Subject<string>;
    remoteUserId: string;
    remoteUserName: string;
    remoteUserAvatar: string;
    incomingCall: boolean;
    isCallActive: boolean;
    isDialogOpen: boolean;
    startConnection: ReturnType<typeof vi.fn>;
    stopConnection: ReturnType<typeof vi.fn>;
    playIncomingCallSound: ReturnType<typeof vi.fn>;
    stopIncomingCallSound: ReturnType<typeof vi.fn>;
    resetCallState: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    offerReceived$ = new BehaviorSubject<OfferPayload | null>(null);
    callEnded$ = new Subject<string>();
    afterClosed$ = new Subject<void>();
    dialogCloseSpy = vi.fn(() => afterClosed$.next());
    dialogOpenSpy = vi.fn().mockReturnValue({
      close: dialogCloseSpy,
      afterClosed: () => afterClosed$.asObservable(),
    });

    mockVideoChatService = {
      offerReceived: offerReceived$,
      callEnded: callEnded$,
      remoteUserId: '',
      remoteUserName: '',
      remoteUserAvatar: '',
      incomingCall: false,
      isCallActive: false,
      isDialogOpen: false,
      startConnection: vi.fn().mockResolvedValue(undefined),
      stopConnection: vi.fn().mockResolvedValue(undefined),
      playIncomingCallSound: vi.fn(),
      stopIncomingCallSound: vi.fn(),
      resetCallState: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        {
          provide: AuthService,
          useValue: {
            currentUser: signal<User | null>({ id: 'u-self', userName: 'self', fullName: 'Self User' }),
            getToken: () => 'token-123',
          },
        },
        {
          provide: Chat,
          useValue: {
            onlineUsers: signal<User[]>([{ id: 'u-caller', fullName: 'Pushpa Raj', userName: 'pushpa' }]),
          },
        },
        { provide: VideoChatService, useValue: mockVideoChatService },
        { provide: MatDialog, useValue: { open: dialogOpenSpy } },
      ],
    }).compileComponents();
  });

  it('should create the app and start VideoHub connection when authenticated', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    expect(fixture.componentInstance).toBeTruthy();
    expect(mockVideoChatService.startConnection).toHaveBeenCalled();
  });

  it('opens VideoChat dialog and plays incoming call audio on incoming offer', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    offerReceived$.next({
      senderId: 'u-caller',
      offer: { type: 'offer', sdp: 'sdp-offer' },
    });

    expect(mockVideoChatService.remoteUserId).toBe('u-caller');
    expect(mockVideoChatService.remoteUserName).toBe('Pushpa Raj');
    expect(mockVideoChatService.incomingCall).toBe(true);
    expect(mockVideoChatService.playIncomingCallSound).toHaveBeenCalledTimes(1);
    expect(dialogOpenSpy).toHaveBeenCalledWith(
      VideoChat,
      expect.objectContaining({
        width: '100vw',
        height: '100vh',
      })
    );
  });

  it('does not open a duplicate dialog for renegotiation offers during an active call', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    mockVideoChatService.isDialogOpen = true;
    mockVideoChatService.isCallActive = true;

    offerReceived$.next({
      senderId: 'u-caller',
      offer: { type: 'offer', sdp: 'renegotiation-sdp' },
    });

    expect(dialogOpenSpy).not.toHaveBeenCalled();
    expect(mockVideoChatService.playIncomingCallSound).not.toHaveBeenCalled();
  });
});
