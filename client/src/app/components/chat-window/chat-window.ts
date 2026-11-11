import { CommonModule } from '@angular/common';
import { Component, computed, ElementRef, HostListener, inject, Input, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { User } from '../../models/user';
import { Chat } from '../../services/chat';
import { ChatBox } from '../chat-box/chat-box';
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
export class ChatWindow {
  chatService = inject(Chat);
  private elementRef = inject(ElementRef<HTMLElement>);

  @Input() selectedUser: User | null = null;

  messageInput = viewChild<ElementRef<HTMLInputElement>>('messageInput');

  readonly emojiGroups = EMOJI_GROUPS;
  isEmojiPickerOpen = signal(false);
  selectedEmojiGroupId = signal<string>(EMOJI_GROUPS[0].id);
  activeEmojiGroup = computed(
    () => this.emojiGroups.find((group) => group.id === this.selectedEmojiGroupId()) ?? this.emojiGroups[0]
  );

  newMessage: string = '';

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
    const content = this.newMessage.trim();
    if (!content) return;
    this.newMessage = '';
    this.isEmojiPickerOpen.set(false);
    void this.chatService.sendMessage(content);
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
}
