import { ChangeDetectorRef, Component, computed, ElementRef, EventEmitter, HostListener, inject, Input, OnInit, Output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../services/auth-service';
import { User } from '../../models/user';
import { Chat } from '../../services/chat';
import { getUserAvatarUrl, getUserInitials } from '../../utils/user-display';

@Component({
  imports: [CommonModule, FormsModule],
  selector: 'app-chat-sidebar',
  templateUrl: './chat-sidebar.html',
  styleUrl: './chat-sidebar.css'
})
export class ChatSidebar implements OnInit {
  authService = inject(AuthService);
  chatService = inject(Chat);
  elementRef = inject(ElementRef);
  cdr = inject(ChangeDetectorRef);

  @Input() selectedUser: User | null = null;
  @Output() userSelected = new EventEmitter<User>();
  @Output() chatClosed = new EventEmitter<void>();
  @Output() logoutClicked = new EventEmitter<void>();

  searchTerm = signal<string>('');
  isMenuOpen = signal<boolean>(false);
  isLoadingUsers = signal<boolean>(false);

  // Initial list loaded from API before SignalR pushes live online users
  users = signal<User[]>([]);

  currentUser = this.authService.currentUser;

  filteredUsers = computed(() => {
    const term = this.searchTerm().trim().toLowerCase();
    const list = this.chatService.hasReceivedUsers()
      ? this.chatService.onlineUsers()
      : this.users();
    if (!term) {
      return list;
    }
    return list.filter((user) =>
      (user.fullName && user.fullName.toLowerCase().includes(term)) ||
      (user.userName && user.userName.toLowerCase().includes(term))
    );
  });

  ngOnInit() {
    this.loadCurrentUser();
    const token = this.authService.getAccessToken || this.authService.getToken();
    if (token) {
      void this.chatService.startConnection(token);
    }
    this.loadUsers();
  }

  loadCurrentUser() {
    const stored = this.authService.getStoredUser();
    if (stored) {
      this.authService.currentUser.set(stored);
      this.cdr.markForCheck();
    }

    this.authService.me().subscribe({
      next: (res) => {
        const userData = (res as any)?.data ?? (res as any)?.Data;
        if (userData) {
          this.authService.setUser(userData);
          this.cdr.markForCheck();
        }
      },
      error: () => {}
    });
  }

  loadUsers() {
    this.isLoadingUsers.set(true);
    this.authService.getUsers().subscribe({
      next: (response) => {
        this.isLoadingUsers.set(false);
        const usersList = (response as any)?.data ?? (response as any)?.Data;
        if (Array.isArray(usersList)) {
          this.users.set(
            usersList.map((u: User) => ({
              ...u,
              isOnline: Boolean(u.isOnline ?? u.IsOnline),
              IsOnline: Boolean(u.isOnline ?? u.IsOnline)
            }))
          );
        }
        this.cdr.markForCheck();
      },
      error: () => {
        this.isLoadingUsers.set(false);
        this.cdr.markForCheck();
      }
    });
  }

  selectUser(user: User) {
    this.selectedUser = user;
    this.userSelected.emit(user);
  }

  closeActiveChat() {
    this.selectedUser = null;
    this.chatClosed.emit();
  }

  isSelected(user: User): boolean {
    if (!this.selectedUser) return false;
    if (this.selectedUser.id && user.id) {
      return this.selectedUser.id === user.id;
    }
    return Boolean(
      this.selectedUser.userName &&
      user.userName &&
      this.selectedUser.userName.toLowerCase() === user.userName.toLowerCase()
    );
  }

  toggleMenu(event: MouseEvent) {
    event.stopPropagation();
    this.isMenuOpen.update(v => !v);
  }

  async logout() {
    this.isMenuOpen.set(false);
    await this.chatService.disConnectConnection();
    this.logoutClicked.emit();
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    if (this.isMenuOpen() && !this.elementRef.nativeElement.querySelector('.dropdown-container')?.contains(event.target)) {
      this.isMenuOpen.set(false);
      this.cdr.markForCheck();
    }
  }

  getAvatarUrl(user?: User | null): string {
    return getUserAvatarUrl(user);
  }

  getInitials(name?: string | null): string {
    return getUserInitials(name);
  }
}
