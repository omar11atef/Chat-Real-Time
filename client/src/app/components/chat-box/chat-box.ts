import { CommonModule } from '@angular/common';
import { Component, effect, ElementRef, inject, Input, signal, ViewChild } from '@angular/core';
import { Message } from '../../models/message';
import { User } from '../../models/user';
import { AuthService } from '../../services/auth-service';
import { Chat } from '../../services/chat';
import { getUserAvatarUrl, getUserInitials } from '../../utils/user-display';

@Component({
  imports: [CommonModule],
  selector: 'app-chat-box',
  templateUrl: './chat-box.html',
  styleUrl: './chat-box.css',
})
export class ChatBox {
  chatService = inject(Chat);
  authService = inject(AuthService);

  @ViewChild('chatBoxContainer') private chatBoxContainer?: ElementRef<HTMLElement>;

  private _selectedUser: User | null = null;
  private pendingScrollRestore: { prevScrollHeight: number; prevScrollTop: number } | null = null;
  pageNumber = signal<number>(1);
  isNearTop = signal<boolean>(false);

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

  private scrollToBottom(): void {
    const el = this.chatBoxContainer?.nativeElement;
    if (el) {
      el.scrollTop = el.scrollHeight;
      this.isNearTop.set(el.scrollTop <= 40);
    }
  }
}
