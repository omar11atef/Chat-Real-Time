import { CommonModule } from '@angular/common';
import { Component, Input, signal } from '@angular/core';
import { User } from '../../models/user';
import { getUserAvatarUrl, getUserInitials } from '../../utils/user-display';

@Component({
  imports: [CommonModule],
  selector: 'app-chat-right-sildebar',
  templateUrl: './chat-right-sildebar.html',
  styleUrl: './chat-right-sildebar.css',
})
export class ChatRightSildebar {
  private _selectedUser: User | null = null;
  imageLoadFailed = signal<boolean>(false);

  @Input()
  set selectedUser(value: User | null) {
    this._selectedUser = value;
    this.imageLoadFailed.set(false);
  }

  get selectedUser(): User | null {
    return this._selectedUser;
  }

  getAvatarUrl(user?: User | null): string {
    if (this.imageLoadFailed()) return '';
    return getUserAvatarUrl(user);
  }

  getInitials(name?: string | null): string {
    return getUserInitials(name);
  }

  onImageError() {
    this.imageLoadFailed.set(true);
  }
}
