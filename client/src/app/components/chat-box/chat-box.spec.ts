import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ChatBox } from './chat-box';
import { Chat } from '../../services/chat';
import { AuthService } from '../../services/auth-service';
import { ChatFileService } from '../../services/chat-file';
import { Message } from '../../models/message';
import { User } from '../../models/user';

describe('ChatBox', () => {
  let messagesSignal: ReturnType<typeof signal<Message[]>>;
  let isLoadingSignal: ReturnType<typeof signal<boolean>>;
  let hasMoreSignal: ReturnType<typeof signal<boolean>>;
  let loadMessagesSpy: ReturnType<typeof vi.fn>;
  let downloadAttachmentSpy: ReturnType<typeof vi.fn>;
  let openAttachmentPreviewSpy: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    messagesSignal = signal<Message[]>([]);
    isLoadingSignal = signal(false);
    hasMoreSignal = signal(false);
    loadMessagesSpy = vi.fn();
    downloadAttachmentSpy = vi.fn();
    openAttachmentPreviewSpy = vi.fn();

    const mockChatService = {
      isLoading: isLoadingSignal,
      chatMessages: messagesSignal,
      hasMoreMessages: hasMoreSignal,
      currentOpenedChat: signal<User | null>({
        id: 'u-peer',
        userName: 'peer',
        fullName: 'Peer User',
      }),
      loadMessages: loadMessagesSpy,
      getCurrentUserId: () => 'u-self',
    };

    const mockAuthService = {
      currentUser: signal<User | null>({
        id: 'u-self',
        userName: 'self',
        fullName: 'Self User',
      }),
      getStoredUser: () => ({
        id: 'u-self',
        userName: 'self',
        fullName: 'Self User',
      }),
    };

    const mockChatFileService = {
      getPreviewUrl: () => 'blob:http://localhost/preview-1',
      downloadAttachment: downloadAttachmentSpy,
      openAttachmentPreview: openAttachmentPreviewSpy,
      formatFileSize: (bytes: number) => `${bytes} B`,
    };

    await TestBed.configureTestingModule({
      imports: [ChatBox],
      providers: [
        { provide: Chat, useValue: mockChatService },
        { provide: AuthService, useValue: mockAuthService },
        { provide: ChatFileService, useValue: mockChatFileService },
      ],
    }).compileComponents();
  });

  it('renders incoming messages as .in and outgoing messages as .out with index.html chat-list structure', () => {
    const fixture = TestBed.createComponent(ChatBox);
    fixture.componentInstance.selectedUser = {
      id: 'u-peer',
      userName: 'peer',
      fullName: 'Peer User',
    };

    messagesSignal.set([
      {
        id: 1,
        senderId: 'u-peer',
        receiverId: 'u-self',
        content: 'Hi there',
        createdData: '2026-11-10T18:00:00Z',
        isRead: false,
      },
      {
        id: 2,
        senderId: 'u-self',
        receiverId: 'u-peer',
        content: 'Hello back!',
        createdData: '2026-11-10T18:01:00Z',
        isRead: false,
      },
    ]);
    fixture.detectChanges();

    const items = fixture.nativeElement.querySelectorAll('.chat-list li') as NodeListOf<HTMLLIElement>;
    expect(items.length).toBe(2);
    expect(items[0].classList.contains('in')).toBe(true);
    expect(items[0].querySelector('.chat-message p')?.textContent?.trim()).toBe('Hi there');
    expect(items[0].querySelector('.read-receipt')).toBeNull();
    expect(items[1].classList.contains('out')).toBe(true);
    expect(items[1].querySelector('.chat-message p')?.textContent?.trim()).toBe('Hello back!');
    expect(items[1].querySelector('.read-receipt')?.classList.contains('unread')).toBe(true);

    messagesSignal.set([
      messagesSignal()[0],
      { ...messagesSignal()[1], isRead: true },
    ]);
    fixture.detectChanges();

    const updatedOut = fixture.nativeElement.querySelectorAll('.chat-list li')[1] as HTMLLIElement;
    expect(updatedOut.querySelector('.read-receipt')?.classList.contains('read')).toBe(true);
    expect(updatedOut.querySelector('.read-receipt')?.classList.contains('unread')).toBe(false);
  });

  it('triggers loadMessages with incremented page number when Load more is clicked', () => {
    const fixture = TestBed.createComponent(ChatBox);
    messagesSignal.set([
      {
        id: 1,
        senderId: 'u-peer',
        receiverId: 'u-self',
        content: 'Msg',
        createdData: '2026-11-10T18:00:00Z',
        isRead: true,
      },
    ]);
    hasMoreSignal.set(true);
    fixture.detectChanges();

    const btn = fixture.nativeElement.querySelector('.load-more-btn') as HTMLButtonElement | null;
    expect(btn).toBeTruthy();
    btn!.click();

    expect(loadMessagesSpy).toHaveBeenCalledWith(2);
  });

  it('renders image and document attachments with preview and download actions', () => {
    const fixture = TestBed.createComponent(ChatBox);
    messagesSignal.set([
      {
        id: 10,
        senderId: 'u-peer',
        receiverId: 'u-self',
        content: 'Photo caption',
        createdData: '2026-11-11T19:00:00Z',
        isRead: true,
        attachmentId: 1,
        attachment: {
          id: 1,
          originalFileName: 'pic.png',
          contentType: 'image/png',
          fileExtension: '.png',
          fileCategory: 'image',
          fileSize: 512,
          downloadUrl: '/api/chat-files/1',
        },
      },
      {
        id: 11,
        senderId: 'u-self',
        receiverId: 'u-peer',
        content: '',
        createdData: '2026-11-11T19:01:00Z',
        isRead: false,
        attachmentId: 2,
        attachment: {
          id: 2,
          originalFileName: 'deck.pptx',
          contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          fileExtension: '.pptx',
          fileCategory: 'powerpoint',
          fileSize: 1024,
          downloadUrl: '/api/chat-files/2',
        },
      },
    ]);
    fixture.detectChanges();

    const img = fixture.nativeElement.querySelector('.attachment-image') as HTMLImageElement | null;
    expect(img).toBeTruthy();
    expect(img?.getAttribute('src')).toBe('blob:http://localhost/preview-1');

    const fileCard = fixture.nativeElement.querySelector('.attachment-file-card') as HTMLElement | null;
    expect(fileCard?.textContent).toContain('deck.pptx');
    expect(fileCard?.textContent).toContain('PPTX');

    const downloadBtn = fileCard?.querySelector('.attachment-btn.primary') as HTMLButtonElement | null;
    downloadBtn?.click();
    expect(downloadAttachmentSpy).toHaveBeenCalledWith(
      expect.objectContaining({ id: 2, originalFileName: 'deck.pptx' })
    );
  });
});
