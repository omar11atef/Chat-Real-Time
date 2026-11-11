import { CommonModule } from '@angular/common';
import { Component, effect, ElementRef, HostListener, inject, Input, OnDestroy, signal, ViewChild } from '@angular/core';
import { ChatAttachment, Message, MessageReaction } from '../../models/message';
import { User } from '../../models/user';
import { AuthService } from '../../services/auth-service';
import { Chat } from '../../services/chat';
import { ChatFileService } from '../../services/chat-file';
import { CallLogPayload, formatCallDuration, parseCallLog } from '../../utils/call-log';
import { getUserAvatarUrl, getUserInitials } from '../../utils/user-display';

export interface GroupedReaction {
  emoji: string;
  count: number;
  reactedByMe: boolean;
  tooltip: string;
}

const QUICK_REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
const EXTRA_REACTION_EMOJIS = [
  '🔥', '👏', '🎉', '😍', '🤔', '💯',
  '🤩', '😭', '🙌', '👌', '🥳', '😎',
  '🥰', '🤯', '🤝', '💪', '✨', '💔',
];

@Component({
  imports: [CommonModule],
  selector: 'app-chat-box',
  templateUrl: './chat-box.html',
  styleUrl: './chat-box.css',
})
export class ChatBox implements OnDestroy {
  chatService = inject(Chat);
  authService = inject(AuthService);
  private chatFileService = inject(ChatFileService, { optional: true });
  private elementRef = inject(ElementRef<HTMLElement>);

  @ViewChild('chatBoxContainer') private chatBoxContainer?: ElementRef<HTMLElement>;

  readonly quickReactionEmojis = QUICK_REACTION_EMOJIS;
  readonly extraReactionEmojis = EXTRA_REACTION_EMOJIS;

  private _selectedUser: User | null = null;
  private pendingScrollRestore: { prevScrollHeight: number; prevScrollTop: number } | null = null;
  private longPressTimer: ReturnType<typeof setTimeout> | null = null;
  private pressStartX = 0;
  private pressStartY = 0;
  private suppressNextMessageClick = false;
  private ignoreNextDocumentClick = false;

  pageNumber = signal<number>(1);
  isNearTop = signal<boolean>(false);
  lightboxAttachment = signal<ChatAttachment | null>(null);
  pressingMessageId = signal<number | null>(null);
  activeReactionMessageId = signal<number | null>(null);
  reactionPickerPlacement = signal<'top' | 'bottom'>('top');
  showMoreReactionEmojis = signal<boolean>(false);

  Isloading = this.chatService.isLoading;
  chatMessages = this.chatService.chatMessages;
  hasMoreMessages = this.chatService.hasMoreMessages;
  currentUser = this.authService.currentUser;

  @Input()
  set selectedUser(value: User | null) {
    const prevId = this._selectedUser?.id;
    this._selectedUser = value;
    if (value?.id !== prevId) {
      this.pageNumber.set(1);
      this.isNearTop.set(false);
      this.pendingScrollRestore = null;
      this.closeReactionPicker();
    }
  }

  get selectedUser(): User | null {
    return this._selectedUser ?? this.chatService.currentOpenedChat();
  }

  constructor() {
    effect(() => {
      const count = this.chatMessages().length;
      if (count === 0) return;

      queueMicrotask(() => {
        const el = this.chatBoxContainer?.nativeElement;
        if (!el) return;

        if (this.pendingScrollRestore) {
          const { prevScrollHeight, prevScrollTop } = this.pendingScrollRestore;
          this.pendingScrollRestore = null;
          el.scrollTop = Math.max(0, el.scrollHeight - prevScrollHeight + prevScrollTop);
          return;
        }

        if (this.pageNumber() === 1) {
          this.scrollToBottom();
        }
      });
    });
  }

  onScroll() {
    const el = this.chatBoxContainer?.nativeElement;
    if (!el) return;
    this.isNearTop.set(el.scrollTop <= 40);
  }

  loadMoreMessage() {
    const el = this.chatBoxContainer?.nativeElement;
    if (el) {
      this.pendingScrollRestore = {
        prevScrollHeight: el.scrollHeight,
        prevScrollTop: el.scrollTop,
      };
    }
    const nextPage = this.pageNumber() + 1;
    this.pageNumber.set(nextPage);
    this.chatService.loadMessages(nextPage);
  }

  isOwnMessage(message: Message): boolean {
    const selfId =
      this.authService.currentUser()?.id ||
      this.authService.getStoredUser()?.id ||
      this.chatService.getCurrentUserId();
    return Boolean(selfId && message.senderId === selfId);
  }

  getSenderDisplayName(isMine: boolean): string {
    if (isMine) {
      const me = this.currentUser() || this.authService.getStoredUser();
      return me?.fullName || me?.userName || 'You';
    }
    const peer = this.selectedUser;
    return peer?.fullName || peer?.userName || 'User';
  }

  getSenderAvatar(isMine: boolean): string {
    const user = isMine
      ? this.currentUser() || this.authService.getStoredUser()
      : this.selectedUser;
    return getUserAvatarUrl(user);
  }

  getSenderInitials(isMine: boolean): string {
    return getUserInitials(this.getSenderDisplayName(isMine));
  }

  getCallLog(message: Message): CallLogPayload | null {
    return parseCallLog(message.content);
  }

  formatCallDuration(seconds: number): string {
    return formatCallDuration(seconds);
  }

  getCallLogTitle(log: CallLogPayload, isMine: boolean): string {
    const direction = isMine ? 'Outgoing' : 'Incoming';
    const kind = log.callType === 'audio' ? 'Audio Call' : 'Video Call';
    return `${direction} ${kind}`;
  }

  getCallLogStatusLabel(log: CallLogPayload): string {
    switch (log.status) {
      case 'completed':
        return 'Completed';
      case 'offline':
        return 'Offline';
      case 'missed':
        return 'Missed';
      case 'cancelled':
        return 'No answer';
    }
  }

  getAttachmentPreviewUrl(attachment: ChatAttachment): string | null {
    return this.chatFileService?.getPreviewUrl(attachment) ?? null;
  }

  downloadAttachment(attachment: ChatAttachment): void {
    this.chatFileService?.downloadAttachment(attachment);
  }

  openAttachmentPreview(attachment: ChatAttachment): void {
    this.chatFileService?.openAttachmentPreview(attachment);
  }

  openImageLightbox(attachment: ChatAttachment): void {
    this.lightboxAttachment.set(attachment);
  }

  closeImageLightbox(): void {
    this.lightboxAttachment.set(null);
  }

  canPreviewAttachment(attachment: ChatAttachment): boolean {
    return attachment.fileCategory === 'pdf' || attachment.fileCategory === 'text';
  }

  formatAttachmentSize(bytes?: number | null): string {
    if (this.chatFileService) {
      return this.chatFileService.formatFileSize(bytes);
    }
    if (!bytes || bytes <= 0) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  ngOnDestroy(): void {
    this.clearLongPressTimer();
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (this.ignoreNextDocumentClick) {
      this.ignoreNextDocumentClick = false;
      return;
    }
    if (this.activeReactionMessageId() === null) return;
    const target = event.target as HTMLElement | null;
    if (!target) return;
    if (!target.closest('.reaction-picker-popover')) {
      this.closeReactionPicker();
    }
  }

  @HostListener('document:keydown.escape')
  onEscapeKey(): void {
    this.closeReactionPicker();
    this.closeImageLightbox();
  }

  onMessagePointerDown(event: PointerEvent, message: Message): void {
    if (event.button !== 0 || !message.id) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('.reaction-picker-popover, .message-reactions-row, .attachment-btn, .attachment-action-link')) {
      return;
    }

    this.clearLongPressTimer();
    this.pressStartX = event.clientX;
    this.pressStartY = event.clientY;
    this.pressingMessageId.set(message.id);

    const bubbleEl = event.currentTarget as HTMLElement | null;
    this.longPressTimer = setTimeout(() => {
      this.longPressTimer = null;
      this.pressingMessageId.set(null);
      this.suppressNextMessageClick = true;
      this.ignoreNextDocumentClick = true;
      this.openReactionPicker(message.id, bubbleEl);
    }, 450);
  }

  onMessagePointerMove(event: PointerEvent): void {
    if (!this.longPressTimer) return;
    const dx = Math.abs(event.clientX - this.pressStartX);
    const dy = Math.abs(event.clientY - this.pressStartY);
    if (dx > 10 || dy > 10) {
      this.cancelLongPress();
    }
  }

  onMessagePointerEnd(): void {
    this.cancelLongPress();
    if (this.suppressNextMessageClick) {
      setTimeout(() => {
        this.suppressNextMessageClick = false;
      }, 60);
    }
    if (this.ignoreNextDocumentClick) {
      setTimeout(() => {
        this.ignoreNextDocumentClick = false;
      }, 60);
    }
  }

  onMessageContextMenu(event: MouseEvent, message: Message): void {
    if (!message.id) return;
    event.preventDefault();
    this.cancelLongPress();
    this.openReactionPicker(message.id, event.currentTarget as HTMLElement | null);
  }

  onMessageClickCapture(event: MouseEvent): void {
    if (this.suppressNextMessageClick) {
      event.preventDefault();
      event.stopPropagation();
      this.suppressNextMessageClick = false;
    }
  }

  toggleMoreReactionEmojis(event: MouseEvent): void {
    event.stopPropagation();
    this.showMoreReactionEmojis.update((v) => !v);
  }

  selectReaction(event: MouseEvent, messageId: number, emoji: string): void {
    event.stopPropagation();
    this.closeReactionPicker();
    void this.chatService.reactToMessage?.(messageId, emoji);
  }

  hasUserReacted(message: Message, emoji: string): boolean {
    const selfId = this.getSelfId();
    if (!selfId || !message.reactions?.length) return false;
    return message.reactions.some((r) => r.userId === selfId && r.emoji === emoji);
  }

  getGroupedReactions(message: Message): GroupedReaction[] {
    const list: MessageReaction[] = message.reactions ?? [];
    if (list.length === 0) return [];

    const selfId = this.getSelfId();
    const groups = new Map<string, { count: number; reactedByMe: boolean; names: string[] }>();

    for (const reaction of list) {
      if (!reaction.emoji) continue;
      const existing = groups.get(reaction.emoji) ?? {
        count: 0,
        reactedByMe: false,
        names: [],
      };
      existing.count += 1;
      if (selfId && reaction.userId === selfId) {
        existing.reactedByMe = true;
      }
      const reactorName = this.getReactorDisplayName(reaction.userId);
      if (!existing.names.includes(reactorName)) {
        existing.names.push(reactorName);
      }
      groups.set(reaction.emoji, existing);
    }

    return Array.from(groups.entries()).map(([emoji, info]) => ({
      emoji,
      count: info.count,
      reactedByMe: info.reactedByMe,
      tooltip: `${info.names.join(', ')} reacted with ${emoji}`,
    }));
  }

  private openReactionPicker(messageId: number, bubbleEl: HTMLElement | null): void {
    const containerEl = this.chatBoxContainer?.nativeElement;
    if (bubbleEl && containerEl) {
      const bubbleTop = bubbleEl.getBoundingClientRect().top;
      const containerTop = containerEl.getBoundingClientRect().top;
      this.reactionPickerPlacement.set(bubbleTop - containerTop < 115 ? 'bottom' : 'top');
    } else {
      this.reactionPickerPlacement.set('top');
    }
    this.showMoreReactionEmojis.set(false);
    this.activeReactionMessageId.set(messageId);
  }

  private closeReactionPicker(): void {
    this.activeReactionMessageId.set(null);
    this.showMoreReactionEmojis.set(false);
  }

  private cancelLongPress(): void {
    this.clearLongPressTimer();
    this.pressingMessageId.set(null);
  }

  private clearLongPressTimer(): void {
    if (this.longPressTimer) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
  }

  private getSelfId(): string | undefined {
    return (
      this.authService.currentUser()?.id ||
      this.authService.getStoredUser()?.id ||
      this.chatService.getCurrentUserId()
    );
  }

  private getReactorDisplayName(userId: string): string {
    const selfId = this.getSelfId();
    if (selfId && userId === selfId) {
      return 'You';
    }
    const peer = this.selectedUser;
    if (peer?.id === userId) {
      return peer.fullName || peer.userName || 'User';
    }
    return 'User';
  }

  getAttachmentBadge(attachment: ChatAttachment): string {
    const ext = attachment.fileExtension?.replace('.', '').toUpperCase();
    if (ext && ext.length <= 5) return ext;
    return attachment.fileCategory?.toUpperCase() || 'FILE';
  }

  private scrollToBottom(): void {
    const el = this.chatBoxContainer?.nativeElement;
    if (el) {
      el.scrollTop = el.scrollHeight;
      this.isNearTop.set(el.scrollTop <= 40);
    }
  }
}
