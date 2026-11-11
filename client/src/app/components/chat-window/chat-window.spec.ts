import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { of, Subject } from 'rxjs';
import { ChatWindow } from './chat-window';
import { Chat } from '../../services/chat';
import { AuthService } from '../../services/auth-service';
import { ChatFileService } from '../../services/chat-file';
import { VideoChatService } from '../../services/video-chat';
import { VideoChat } from '../../video-chat/video-chat';
import { Message } from '../../models/message';
import { User } from '../../models/user';

describe('ChatWindow', () => {
  let sendMessageSpy: ReturnType<typeof vi.fn>;
  let notifyTypingSpy: ReturnType<typeof vi.fn>;
  let appendMessageIfMissingSpy: ReturnType<typeof vi.fn>;
  let dialogOpenSpy: ReturnType<typeof vi.fn>;
  let uploadFileSpy: ReturnType<typeof vi.fn>;
  let snackBarOpenSpy: ReturnType<typeof vi.fn>;
  let mockVideoChatService: {
    remoteUserId: string;
    remoteUserName: string;
    remoteUserAvatar: string;
    isRemoteUserOnline: boolean;
    incomingCall: boolean;
    isCallActive: boolean;
    isDialogOpen: boolean;
    unlockAudio: ReturnType<typeof vi.fn>;
    startConnection: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    sendMessageSpy = vi.fn().mockResolvedValue(undefined);
    notifyTypingSpy = vi.fn();
    appendMessageIfMissingSpy = vi.fn();
    dialogOpenSpy = vi.fn().mockReturnValue({ afterClosed: () => new Subject<void>() });
    uploadFileSpy = vi.fn().mockReturnValue(
      of({
        isSuccess: true,
        data: {
          id: 99,
          senderId: 'u-self',
          receiverId: 'u-1',
          content: 'Check this PDF',
          createdData: '2026-11-11T19:00:00Z',
          isRead: false,
          attachmentId: 5,
          attachment: {
            id: 5,
            originalFileName: 'report.pdf',
            contentType: 'application/pdf',
            fileExtension: '.pdf',
            fileCategory: 'pdf',
            fileSize: 2048,
            downloadUrl: 'http://localhost:5000/api/chat-files/5',
            isEncrypted: true,
          },
        },
        error: '',
        message: 'ok',
      })
    );
    snackBarOpenSpy = vi.fn();

    mockVideoChatService = {
      remoteUserId: '',
      remoteUserName: '',
      remoteUserAvatar: '',
      isRemoteUserOnline: true,
      incomingCall: false,
      isCallActive: false,
      isDialogOpen: false,
      unlockAudio: vi.fn(),
      startConnection: vi.fn().mockResolvedValue(undefined),
    };

    const mockChatService = {
      isLoading: signal(false),
      chatMessages: signal<Message[]>([]),
      hasMoreMessages: signal(false),
      currentOpenedChat: signal<User | null>(null),
      sendMessage: sendMessageSpy,
      notifyTyping: notifyTypingSpy,
      appendMessageIfMissing: appendMessageIfMissingSpy,
      loadMessages: vi.fn(),
      getCurrentUserId: () => 'u-self',
    };

    const mockAuthService = {
      currentUser: signal<User | null>({ id: 'u-self', userName: 'self', fullName: 'Self User' }),
      getStoredUser: () => ({ id: 'u-self', userName: 'self', fullName: 'Self User' }),
      getToken: () => 'jwt-token',
    };

    await TestBed.configureTestingModule({
      imports: [ChatWindow],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        ChatFileService,
        { provide: Chat, useValue: mockChatService },
        { provide: AuthService, useValue: mockAuthService },
        { provide: VideoChatService, useValue: mockVideoChatService },
        { provide: MatDialog, useValue: { open: dialogOpenSpy } },
        { provide: MatSnackBar, useValue: { open: snackBarOpenSpy } },
      ],
    }).compileComponents();

    const chatFileService = TestBed.inject(ChatFileService);
    uploadFileSpy = vi.spyOn(chatFileService, 'uploadFile').mockReturnValue(
      of({
        IsSuccess: true,
        data: {
          id: 99,
          senderId: 'u-self',
          receiverId: 'u-1',
          content: 'Check this PDF',
          createdData: '2026-11-11T19:00:00Z',
          isRead: false,
          attachmentId: 5,
          attachment: {
            id: 5,
            originalFileName: 'report.pdf',
            contentType: 'application/pdf',
            fileExtension: '.pdf',
            fileCategory: 'pdf',
            fileSize: 2048,
            downloadUrl: 'http://localhost:5000/api/chat-files/5',
            isEncrypted: true,
          },
        },
        error: '',
        message: 'ok',
      })
    );
  });

  it('renders camera, file attach, emoji, pill input, and mic icon when input is empty, then sends via ChatService', () => {
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
    const attachFileBtn = fixture.nativeElement.querySelector('button[aria-label="Attach file"]');
    const emojiBtn = fixture.nativeElement.querySelector('button[aria-label="Insert emoji"]');
    const input = fixture.nativeElement.querySelector('.chat-text-input') as HTMLInputElement | null;
    const micBtn = fixture.nativeElement.querySelector('button[aria-label="Voice message"]');
    const sendBtnInitial = fixture.nativeElement.querySelector('.send-message-btn');

    expect(attachBtn).toBeTruthy();
    expect(attachFileBtn).toBeTruthy();
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

  it('renders the header video call button and opens VideoChat dialog for the selected user on click', () => {
    const fixture = TestBed.createComponent(ChatWindow);
    fixture.componentInstance.selectedUser = {
      id: 'u-pushpa',
      fullName: 'Pushpa Raj',
      userName: 'pushpa',
      isOnline: true,
    };
    fixture.detectChanges();

    const videoCallBtn = fixture.nativeElement.querySelector(
      'button[aria-label="Start video call"]'
    ) as HTMLButtonElement | null;
    expect(videoCallBtn).toBeTruthy();

    videoCallBtn!.click();
    fixture.detectChanges();

    expect(mockVideoChatService.unlockAudio).toHaveBeenCalledTimes(1);
    expect(mockVideoChatService.startConnection).toHaveBeenCalledTimes(1);
    expect(mockVideoChatService.remoteUserId).toBe('u-pushpa');
    expect(mockVideoChatService.remoteUserName).toBe('Pushpa Raj');
    expect(mockVideoChatService.incomingCall).toBe(false);
    expect(dialogOpenSpy).toHaveBeenCalledWith(
      VideoChat,
      expect.objectContaining({
        width: '100vw',
        height: '100vh',
        panelClass: 'video-call-dialog-panel',
      })
    );
  });

  it('validates, previews, and uploads an attached PDF file with optional caption', () => {
    const fixture = TestBed.createComponent(ChatWindow);
    fixture.componentInstance.selectedUser = {
      id: 'u-1',
      fullName: 'Rama Kumari',
      userName: 'ramakumari',
      isOnline: true,
    };
    fixture.detectChanges();

    const validPdf = new File(['%PDF-1.4 content'], 'report.pdf', { type: 'application/pdf' });
    fixture.componentInstance.onFileSelected({
      target: { files: [validPdf], value: 'report.pdf' },
    } as unknown as Event);
    fixture.detectChanges();

    expect(fixture.componentInstance.pendingFile()).toBe(validPdf);
    expect(fixture.nativeElement.querySelector('.pending-file-name')?.textContent).toContain('report.pdf');

    const sendBtn = fixture.nativeElement.querySelector('.send-message-btn') as HTMLButtonElement | null;
    expect(sendBtn).toBeTruthy();

    fixture.componentInstance.newMessage = 'Check this PDF';
    sendBtn!.click();
    fixture.detectChanges();

    expect(uploadFileSpy).toHaveBeenCalledWith('u-1', validPdf, 'Check this PDF');
    expect(appendMessageIfMissingSpy).toHaveBeenCalled();
    expect(fixture.componentInstance.pendingFile()).toBeNull();
  });

  it('blocks harmful script/JS files and displays an error toast', () => {
    const fixture = TestBed.createComponent(ChatWindow);
    fixture.componentInstance.selectedUser = {
      id: 'u-1',
      fullName: 'Rama Kumari',
      userName: 'ramakumari',
      isOnline: true,
    };
    fixture.detectChanges();

    const blockedScript = new File(['console.log(1)'], 'hack.js', { type: 'application/javascript' });
    fixture.componentInstance.onFileSelected({
      target: { files: [blockedScript], value: 'hack.js' },
    } as unknown as Event);
    fixture.detectChanges();

    expect(fixture.componentInstance.pendingFile()).toBeNull();
    expect(snackBarOpenSpy).toHaveBeenCalled();
    expect(uploadFileSpy).not.toHaveBeenCalled();
  });
});
