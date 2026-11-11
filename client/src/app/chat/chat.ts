import { Component, computed, HostListener, inject, OnDestroy, signal } from '@angular/core';
import { AuthService } from '../services/auth-service';
import { Chat as ChatService } from '../services/chat';
import { ChatSidebar } from '../components/chat-sidebar/chat-sidebar';
import { ChatWindow } from '../components/chat-window/chat-window';
import { ChatRightSildebar } from '../components/chat-right-sildebar/chat-right-sildebar';
import { User } from '../models/user';

@Component({
  imports: [ChatSidebar, ChatWindow, ChatRightSildebar],
  selector: 'app-chat',
  styleUrl: './chat.css',
  templateUrl: './chat.html',
})
export class Chat implements OnDestroy {
  authService = inject(AuthService);
  chatService = inject(ChatService);

  private selectedUserSnapshot = signal<User | null>(null);

  selectedUser = computed<User | null>(() => {
    const current = this.selectedUserSnapshot();
    if (!current) return null;
    const liveUsers = this.chatService.onlineUsers();
    const match = liveUsers.find(
      u =>
        (current.id && u.id === current.id) ||
        (current.userName && u.userName?.toLowerCase() === current.userName.toLowerCase())
    );
    return match ?? current;
  });

  onUserSelected(user: User) {
    this.selectedUserSnapshot.set(user);
    this.chatService.openChat(user);
  }

  onChatClosed() {
    this.selectedUserSnapshot.set(null);
    this.chatService.closeChat();
  }

  async logout() {
    await this.chatService.disConnectConnection();
    this.authService.logout();
  }

  @HostListener('window:beforeunload')
  onBeforeUnload() {
    void this.chatService.disConnectConnection();
  }

  ngOnDestroy() {
    void this.chatService.disConnectConnection();
  }
}
