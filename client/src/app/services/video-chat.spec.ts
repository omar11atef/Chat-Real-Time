import { TestBed } from '@angular/core/testing';
import { AuthService } from './auth-service';
import { VideoChatService } from './video-chat';

describe('VideoChatService', () => {
  let service: VideoChatService;
  let originalAudio: typeof Audio;
  let originalFetch: typeof fetch;
  let createdAudios: Array<{
    src: string;
    loop: boolean;
    currentTime: number;
    play: ReturnType<typeof vi.fn>;
    pause: ReturnType<typeof vi.fn>;
  }>;

  beforeEach(() => {
    createdAudios = [];
    originalAudio = globalThis.Audio;
    originalFetch = globalThis.fetch;

    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false } as Response);

    (globalThis as unknown as { Audio: unknown }).Audio = vi.fn(function (src: string) {
      const instance = {
        src,
        loop: false,
        currentTime: 0,
        play: vi.fn().mockResolvedValue(undefined),
        pause: vi.fn(),
      };
      createdAudios.push(instance);
      return instance;
    });

    TestBed.configureTestingModule({
      providers: [
        VideoChatService,
        {
          provide: AuthService,
          useValue: {
            getToken: () => 'jwt-token',
          },
        },
      ],
    });

    service = TestBed.inject(VideoChatService);
  });

  afterEach(() => {
    service.stopIncomingCallSound();
    (globalThis as unknown as { Audio: unknown }).Audio = originalAudio;
    globalThis.fetch = originalFetch;
  });

  it('plays WhatsApp incoming call MP3 on loop and stops cleanly', () => {
    service.playIncomingCallSound();

    expect(createdAudios.length).toBe(1);
    expect(createdAudios[0].src).toContain('WhatsApp_-_Incoming_Call-646860-mobiles24.mp3');
    expect(createdAudios[0].loop).toBe(true);
    expect(createdAudios[0].play).toHaveBeenCalledTimes(1);

    // Calling again while active should not stack another overlapping Audio instance
    service.playIncomingCallSound();
    expect(createdAudios.length).toBe(1);

    service.stopIncomingCallSound();
    expect(createdAudios[0].pause).toHaveBeenCalledTimes(1);
    expect(createdAudios[0].currentTime).toBe(0);
  });

  it('resetCallState clears call metadata and stops ringtone', () => {
    service.incomingCall = true;
    service.isCallActive = true;
    service.remoteUserId = 'user-42';
    service.remoteUserName = 'Pushpa Raj';
    service.playIncomingCallSound();

    service.resetCallState();

    expect(service.incomingCall).toBe(false);
    expect(service.isCallActive).toBe(false);
    expect(service.remoteUserId).toBe('');
    expect(service.remoteUserName).toBe('');
    expect(service.offerReceived.value).toBeNull();
    expect(createdAudios[0].pause).toHaveBeenCalled();
  });
});
