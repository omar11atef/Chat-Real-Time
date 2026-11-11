import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ChatWindow } from './chat-window';
import { Chat } from '../../services/chat';
import { AuthService } from '../../services/auth-service';
import { Message } from '../../models/message';
import { User } from '../../models/user';

describe('ChatWindow', () => {
  let sendMessageSpy: ReturnType<typeof vi.fn>;
  let notifyTypingSpy: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    sendMessageSpy = vi.fn().mockResolvedValue(undefined);
    notifyTypingSpy = vi.fn();

    const mockChatService = {
      isLoading: signal(false),
      chatMessages: signal<Message[]>([]),
      hasMoreMessages: signal(false),
      currentOpenedChat: signal<User | null>(null),
      sendMessage: sendMessageSpy,
      notifyTyping: notifyTypingSpy,
      loadMessages: vi.fn(),
      getCurrentUserId: () => 'u-self',
    };

    const mockAuthService = {
      currentUser: signal<User | null>({ id: 'u-self', userName: 'self', fullName: 'Self User' }),
      getStoredUser: () => ({ id: 'u-self', userName: 'self', fullName: 'Self User' }),
    };

    await TestBed.configureTestingModule({
      imports: [ChatWindow],
      providers: [
        { provide: Chat, useValue: mockChatService },
        { provide: AuthService, useValue: mockAuthService },
      ],
    }).compileComponents();
  });

  it('renders camera, emoji, pill input, and mic icon when input is empty, then sends via ChatService', () => {
    const fixture = TestBed.createComponent(ChatWindow);
    fixture.componentInstance.selectedUser = {
      id: 'u-1',
      fullName: 'Rama Kumari',
      userName: 'ramakumari',
      email: 'rama@gmail.com',
      isOnline: true,
    };
    fixture.detectChanges();

    const attachBtn = fixture.nativeElement.querySelector('button[aria-label="Attach photo"]');
    const emojiBtn = fixture.nativeElement.querySelector('button[aria-label="Insert emoji"]');
    const input = fixture.nativeElement.querySelector('.chat-text-input') as HTMLInputElement | null;
    const micBtn = fixture.nativeElement.querySelector('button[aria-label="Voice message"]');
    const sendBtnInitial = fixture.nativeElement.querySelector('.send-message-btn');

    expect(attachBtn).toBeTruthy();
    expect(emojiBtn).toBeTruthy();
    expect(input?.getAttribute('placeholder')).toBe('Type your message here!');
    expect(micBtn).toBeTruthy();
    expect(sendBtnInitial).toBeNull();

    input!.value = 'Hello!';
    input!.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const sendBtnTyping = fixture.nativeElement.querySelector('.send-message-btn') as HTMLButtonElement | null;
    expect(sendBtnTyping).toBeTruthy();
    expect(fixture.nativeElement.querySelector('button[aria-label="Voice message"]')).toBeNull();

    sendBtnTyping!.click();
    fixture.detectChanges();

    expect(sendMessageSpy).toHaveBeenCalledWith('Hello!');
    expect(fixture.componentInstance.newMessage).toBe('');
  });

  it('calls notifyTyping on input and shows Typing... in header when selectedUser is typing', () => {
    const fixture = TestBed.createComponent(ChatWindow);
    fixture.componentInstance.selectedUser = {
      id: 'u-1',
      fullName: 'Test12 User',
      userName: 'test12',
      isOnline: true,
      isTyping: true,
    };
    fixture.detectChanges();

    const headerTyping = fixture.nativeElement.querySelector('.header-typing') as HTMLElement | null;
    const headerDots = fixture.nativeElement.querySelectorAll('.header-typing .typing-dots .dot');
    expect(headerTyping?.textContent).toContain('Typing...');
    expect(headerDots.length).toBe(3);

    const input = fixture.nativeElement.querySelector('.chat-text-input') as HTMLInputElement;
    input.value = 'Hey';
    input.dispatchEvent(new Event('input'));
    expect(notifyTypingSpy).toHaveBeenCalled();
  });
});
