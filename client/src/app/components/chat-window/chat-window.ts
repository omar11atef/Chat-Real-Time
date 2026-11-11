import { CommonModule } from '@angular/common';
import { Component, computed, ElementRef, HostListener, inject, Input, OnChanges, OnDestroy, signal, SimpleChanges, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { User } from '../../models/user';
import { Chat } from '../../services/chat';
import { ChatFileService } from '../../services/chat-file';
import { VideoChatService } from '../../services/video-chat';
import { ChatBox } from '../chat-box/chat-box';
import { VideoChat } from '../../video-chat/video-chat';
import { getUserAvatarUrl, getUserInitials } from '../../utils/user-display';

/**
 * Represents a named emoji category displayed in the chat composer picker.
 */
export interface EmojiGroup {
  id: string;
  label: string;
  icon: string;
  emojis: string[];
}

export const EMOJI_GROUPS: EmojiGroup[] = [
  {
    id: 'smileys',
    label: 'Smileys',
    icon: '😀',
    emojis: [
      '😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣',
      '😊', '😇', '🙂', '😉', '😍', '🥰', '😘', '😋',
      '😎', '🤩', '🥳', '🤔', '🤗', '😴', '😭', '🤯'
    ]
  },
  {
    id: 'gestures',
    label: 'Gestures',
    icon: '👋',
    emojis: [
      '👋', '🤚', '✋', '👌', '🤏', '✌️', '🤞', '🤟',
      '🤘', '🤙', '👍', '👎', '✊', '👊', '👏', '🙌',
      '🫶', '🤝', '🙏', '💪', '👀', '🧠', '🗣️', '🫂'
    ]
  },
  {
    id: 'hearts',
    label: 'Hearts',
    icon: '❤️',
    emojis: [
      '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍',
      '🤎', '💖', '💗', '💓', '💞', '💕', '💘', '💝',
      '💔', '❤️‍🔥', '✨', '🌟', '💫', '🔥', '💯', '✅'
    ]
  },
  {
    id: 'celebration',
    label: 'Celebration',
    icon: '🎉',
    emojis: [
      '🎉', '🎊', '🎈', '🎁', '🎂', '🥂', '🍾', '🏆',
      '🥇', '🎯', '🚀', '🌈', '☀️', '🌙', '⭐', '⚡',
      '🎶', '🎵', '🎮', '📸', '💡', '📣', '🔔', '👑'
    ]
  },
  {
    id: 'food',
    label: 'Food & Drink',
    icon: '☕',
    emojis: [
      '☕', '🍵', '🧃', '🥤', '🍕', '🍔', '🍟', '🌮',
      '🍣', '🍩', '🍪', '🍰', '🍫', '🍿', '🍎', '🍓',
      '🍉', '🍇', '🥑', '🥐', '🥨', '🍦', '🧁', '🍯'
    ]
  }
];

@Component({
  imports: [CommonModule, FormsModule, ChatBox],
  selector: 'app-chat-window',
  templateUrl: './chat-window.html',
  styleUrl: './chat-window.css'
})
export class ChatWindow implements OnChanges, OnDestroy {
  chatService = inject(Chat);
  private elementRef = inject(ElementRef<HTMLElement>);
  private matDialog = inject(MatDialog);
  private videoChatService = inject(VideoChatService);
  private chatFileService = inject(ChatFileService);
  private snackBar = inject(MatSnackBar);

  @Input() selectedUser: User | null = null;

  messageInput = viewChild<ElementRef<HTMLInputElement>>('messageInput');

  readonly emojiGroups = EMOJI_GROUPS;
  isEmojiPickerOpen = signal(false);
  selectedEmojiGroupId = signal<string>(EMOJI_GROUPS[0].id);
  activeEmojiGroup = computed(
    () => this.emojiGroups.find((group) => group.id === this.selectedEmojiGroupId()) ?? this.emojiGroups[0]
  );

  pendingFile = signal<File | null>(null);
  pendingImagePreviewUrl = signal<string | null>(null);
  isUploadingFile = signal(false);
  isDragOver = signal(false);

  newMessage: string = '';

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['selectedUser'] && !changes['selectedUser'].firstChange) {
      const prev = changes['selectedUser'].previousValue as User | null;
      const curr = changes['selectedUser'].currentValue as User | null;
      if (prev?.id !== curr?.id) {
        this.clearPendingFile();
      }
    }
  }

  ngOnDestroy(): void {
    this.revokePendingPreviewUrl();
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    if (!this.isEmojiPickerOpen()) return;
    const target = event.target as HTMLElement | null;
    if (!target) return;

    const pickerContainer = this.elementRef.nativeElement.querySelector('.emoji-picker-container');
    if (pickerContainer && !pickerContainer.contains(target)) {
      this.isEmojiPickerOpen.set(false);
    }
  }

  @HostListener('document:keydown.escape')
  onEscapeKey() {
    this.isEmojiPickerOpen.set(false);
  }

  toggleEmojiPicker(event: MouseEvent) {
    event.stopPropagation();
    this.isEmojiPickerOpen.update((open) => !open);
  }

  selectEmojiGroup(groupId: string) {
    this.selectedEmojiGroupId.set(groupId);
  }

  insertEmoji(emoji: string) {
    const input = this.messageInput()?.nativeElement;
    const currentText = this.newMessage;

    if (input && typeof input.selectionStart === 'number' && typeof input.selectionEnd === 'number') {
      const start = input.selectionStart;
      const end = input.selectionEnd;
      const updated = `${currentText.slice(0, start)}${emoji}${currentText.slice(end)}`;
      const nextCursor = start + emoji.length;

      this.newMessage = updated;
      input.value = updated;
      input.focus();
      input.setSelectionRange(nextCursor, nextCursor);
    } else {
      this.newMessage = `${currentText}${emoji}`;
      input?.focus();
    }

    this.onTyping();
  }

  sendMessage() {
    const file = this.pendingFile();
    const content = this.newMessage.trim();

    if (file) {
      const receiverId = this.selectedUser?.id;
      if (!receiverId || this.isUploadingFile()) return;

      this.isUploadingFile.set(true);
      this.isEmojiPickerOpen.set(false);

      this.chatFileService.uploadFile(receiverId, file, content).subscribe({
        next: (response) => {
          this.isUploadingFile.set(false);
          this.newMessage = '';
          this.clearPendingFile();
          const sentMessage = (response as any)?.data ?? (response as any)?.Data;
          if (sentMessage) {
            this.chatService.appendMessageIfMissing?.(sentMessage);
          }
        },
        error: (err) => {
          this.isUploadingFile.set(false);
          const errorMsg =
            err?.error?.error ||
            err?.error?.Error ||
            err?.error?.message ||
            err?.error?.Message ||
            'Could not send file. Please verify the file type and size.';
          this.showErrorToast(errorMsg);
        },
      });
      return;
    }

    if (!content) return;
    this.newMessage = '';
    this.isEmojiPickerOpen.set(false);
    void this.chatService.sendMessage(content);
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    const file = input?.files?.[0];
    if (input) {
      input.value = '';
    }
    if (file) {
      this.attachSelectedFile(file);
    }
  }

  onPaste(event: ClipboardEvent): void {
    const items = event.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === 'file') {
        const pastedFile = item.getAsFile();
        if (pastedFile) {
          event.preventDefault();
          this.attachSelectedFile(pastedFile);
          return;
        }
      }
    }
  }

  onDragOver(event: DragEvent): void {
    if (!this.selectedUser) return;
    if (event.dataTransfer?.types?.includes('Files')) {
      event.preventDefault();
      this.isDragOver.set(true);
    }
  }

  onDragLeave(event: DragEvent): void {
    const wrapper = this.elementRef.nativeElement.querySelector('.window-wrapper');
    const related = event.relatedTarget as Node | null;
    if (!related || !wrapper?.contains(related)) {
      this.isDragOver.set(false);
    }
  }

  onDrop(event: DragEvent): void {
    this.isDragOver.set(false);
    if (!this.selectedUser) return;
    const file = event.dataTransfer?.files?.[0];
    if (file) {
      event.preventDefault();
      this.attachSelectedFile(file);
    }
  }

  clearPendingFile(): void {
    this.revokePendingPreviewUrl();
    this.pendingFile.set(null);
  }

  formatFileSize(bytes: number): string {
    return this.chatFileService.formatFileSize(bytes);
  }

  getPendingFileBadge(file: File): string {
    const ext = file.name.split('.').pop()?.toUpperCase();
    return ext && ext.length <= 5 ? ext : 'FILE';
  }

  private attachSelectedFile(file: File): void {
    const validation = this.chatFileService.validateFile(file);
    if (!validation.valid) {
      this.showErrorToast(validation.error || 'This file cannot be uploaded.');
      return;
    }

    this.revokePendingPreviewUrl();
    this.pendingFile.set(file);

    if (
      validation.category === 'image' &&
      typeof URL !== 'undefined' &&
      typeof URL.createObjectURL === 'function'
    ) {
      this.pendingImagePreviewUrl.set(URL.createObjectURL(file));
    }
  }

  private revokePendingPreviewUrl(): void {
    const existing = this.pendingImagePreviewUrl();
    if (existing && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
      URL.revokeObjectURL(existing);
    }
    this.pendingImagePreviewUrl.set(null);
  }

  private showErrorToast(message: string): void {
    this.snackBar.open(message, 'Close', {
      duration: 4500,
      verticalPosition: 'top',
      horizontalPosition: 'right',
      panelClass: ['error-snackbar'],
    });
  }

  onTyping() {
    if (!this.newMessage.trim()) return;
    this.chatService.notifyTyping();
  }

  getAvatarUrl(user?: User | null): string {
    return getUserAvatarUrl(user);
  }

  getInitials(name?: string): string {
    return getUserInitials(name);
  }

  /** Opens the full-screen video call view and initiates a WebRTC call with the selected user. */
  startVideoCall(): void {
    const receiverId = this.selectedUser?.id;
    if (!receiverId || this.videoChatService.isDialogOpen) {
      return;
    }

    this.videoChatService.unlockAudio();
    void this.videoChatService.startConnection();

    this.videoChatService.remoteUserId = receiverId;
    this.videoChatService.remoteUserName =
      this.selectedUser?.fullName || this.selectedUser?.userName || 'User';
    this.videoChatService.remoteUserAvatar = this.getAvatarUrl(this.selectedUser);
    this.videoChatService.isRemoteUserOnline = Boolean(
      this.selectedUser?.isOnline ?? this.selectedUser?.IsOnline
    );
    this.videoChatService.incomingCall = false;
    this.videoChatService.isCallActive = false;
    this.videoChatService.isDialogOpen = true;

    const dialogRef = this.matDialog.open(VideoChat, {
      width: '100vw',
      height: '100vh',
      maxWidth: '100vw',
      maxHeight: '100vh',
      panelClass: 'video-call-dialog-panel',
      disableClose: true,
    });

    dialogRef.afterClosed().subscribe(() => {
      this.videoChatService.isDialogOpen = false;
    });
  }
}
