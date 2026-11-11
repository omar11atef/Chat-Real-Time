import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { ChatSidebar } from './chat-sidebar';
import { AuthService } from '../../services/auth-service';
import { Chat } from '../../services/chat';
import { User } from '../../models/user';

describe('ChatSidebar', () => {
  let onlineUsersSignal: ReturnType<typeof signal<User[]>>;
  let hasReceivedUsersSignal: ReturnType<typeof signal<boolean>>;
  let startConnectionSpy: ReturnType<typeof vi.fn>;
  let disconnectSpy: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    onlineUsersSignal = signal<User[]>([]);
    hasReceivedUsersSignal = signal<boolean>(false);
    startConnectionSpy = vi.fn().mockResolvedValue(undefined);
    disconnectSpy = vi.fn().mockResolvedValue(undefined);

    const mockAuthService = {
      currentUser: signal<User | null>({ id: 'u-self', userName: 'pushpa', fullName: 'Pushpa Raj' }),
      getAccessToken: 'token-123',
      getToken: () => 'token-123',
      getStoredUser: () => ({ id: 'u-self', userName: 'pushpa', fullName: 'Pushpa Raj' }),
      setUser: vi.fn(),
      me: () => of({ IsSuccess: true, data: { id: 'u-self', userName: 'pushpa', fullName: 'Pushpa Raj' }, error: '', message: '' }),
      getUsers: () => of({ IsSuccess: true, data: [], error: '', message: '' })
    };

    const mockChatService = {
      onlineUsers: onlineUsersSignal,
      hasReceivedUsers: hasReceivedUsersSignal,
      startConnection: startConnectionSpy,
      disConnectConnection: disconnectSpy
    };

    await TestBed.configureTestingModule({
      imports: [ChatSidebar],
      providers: [
        { provide: AuthService, useValue: mockAuthService },
        { provide: Chat, useValue: mockChatService }
      ]
    }).compileComponents();
  });

  it('shows green circle for online user and gray circle for offline user, and updates on logout', () => {
    const fixture = TestBed.createComponent(ChatSidebar);
    fixture.detectChanges();

    onlineUsersSignal.set([
      { id: 'u-1', userName: 'test12', fullName: 'Test12 User', isOnline: true, IsOnline: true },
      { id: 'u-2', userName: 'ram', fullName: 'Ram Doe', isOnline: false, IsOnline: false }
    ]);
    hasReceivedUsersSignal.set(true);
    fixture.detectChanges();

    const dots = fixture.nativeElement.querySelectorAll('.status-dot-indicator') as NodeListOf<HTMLElement>;
    expect(dots.length).toBe(2);
    expect(dots[0].classList.contains('online')).toBe(true);
    expect(dots[1].classList.contains('offline')).toBe(true);

    // Simulate Test12 User logging out
    onlineUsersSignal.set([
      { id: 'u-1', userName: 'test12', fullName: 'Test12 User', isOnline: false, IsOnline: false },
      { id: 'u-2', userName: 'ram', fullName: 'Ram Doe', isOnline: false, IsOnline: false }
    ]);
    fixture.detectChanges();

    const updatedDots = fixture.nativeElement.querySelectorAll('.status-dot-indicator') as NodeListOf<HTMLElement>;
    expect(updatedDots[0].classList.contains('offline')).toBe(true);
    expect(updatedDots[0].classList.contains('online')).toBe(false);
  });

  it('disconnects SignalR and emits logoutClicked on logout', async () => {
    const fixture = TestBed.createComponent(ChatSidebar);
    const component = fixture.componentInstance;
    const logoutEmitSpy = vi.fn();
    component.logoutClicked.subscribe(logoutEmitSpy);

    fixture.detectChanges();
    await component.logout();

    expect(disconnectSpy).toHaveBeenCalledTimes(1);
    expect(logoutEmitSpy).toHaveBeenCalledTimes(1);
  });

  it('displays animated Typing... indicator when a user is typing', () => {
    const fixture = TestBed.createComponent(ChatSidebar);
    fixture.detectChanges();

    onlineUsersSignal.set([
      { id: 'u-1', userName: 'test12', fullName: 'Test12 User', isOnline: true, isTyping: true }
    ]);
    hasReceivedUsersSignal.set(true);
    fixture.detectChanges();

    const typingEl = fixture.nativeElement.querySelector('.contact-typing') as HTMLElement | null;
    const dots = fixture.nativeElement.querySelectorAll('.contact-typing .typing-dots .dot');
    expect(typingEl?.textContent).toContain('Typing...');
    expect(dots.length).toBe(3);
  });

  it('emits chatClosed and clears selectedUser when clicking profile avatar/name button', () => {
    const fixture = TestBed.createComponent(ChatSidebar);
    const component = fixture.componentInstance;
    component.selectedUser = { id: 'u-1', userName: 'test12', fullName: 'Test12 User' };
    const closeEmitSpy = vi.fn();
    component.chatClosed.subscribe(closeEmitSpy);
    fixture.detectChanges();

    const profileBtn = fixture.nativeElement.querySelector('.user-profile-btn') as HTMLButtonElement | null;
    expect(profileBtn).toBeTruthy();
    profileBtn!.click();

    expect(closeEmitSpy).toHaveBeenCalledTimes(1);
    expect(component.selectedUser).toBeNull();
  });
});
