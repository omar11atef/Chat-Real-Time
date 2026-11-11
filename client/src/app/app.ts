import { Component, effect, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { RouterOutlet } from '@angular/router';
import { Subscription } from 'rxjs';
import { AuthService } from './services/auth-service';
import { Chat } from './services/chat';
import { VideoChatService } from './services/video-chat';
import { VideoChat } from './video-chat/video-chat';

@Component({
  imports: [RouterOutlet],
  selector: 'app-root',
  styleUrl: './app.css',
  templateUrl: './app.html',
})
export class App implements OnInit, OnDestroy {
  protected readonly title = signal('client');

  private videoChatService = inject(VideoChatService);
  private authService = inject(AuthService);
  private chatService = inject(Chat, { optional: true });
  private matDialog = inject(MatDialog);
  private subscriptions = new Subscription();
  private activeCallDialogRef: MatDialogRef<VideoChat> | null = null;

  constructor() {
    effect(() => {
      const user = this.authService.currentUser();
      const token = this.authService.getToken();
      if (user && token) {
        void this.videoChatService.startConnection();
      } else if (!token) {
        void this.videoChatService.stopConnection();
      }
    });
  }

  ngOnInit(): void {
    this.startOfferReceived();
    if (this.authService.getToken()) {
      void this.videoChatService.startConnection();
    }
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  startOfferReceived(): void {
    this.subscriptions.unsubscribe();
    this.subscriptions = new Subscription();

    this.subscriptions.add(
      this.videoChatService.offerReceived.subscribe((data) => {
        if (!data) return;

        // Renegotiation offers during an active call are handled directly by the open VideoChat instance.
        if (this.videoChatService.isDialogOpen || this.videoChatService.isCallActive) {
          return;
        }

        const caller = this.chatService?.onlineUsers().find((u) => u.id === data.senderId);
        this.videoChatService.remoteUserId = data.senderId;
        this.videoChatService.remoteUserName =
          caller?.fullName || caller?.userName || 'Incoming Call';
        this.videoChatService.remoteUserAvatar =
          caller?.profilePicture || caller?.profileImage || caller?.photoUrl || '';
        this.videoChatService.isRemoteUserOnline = true;
        this.videoChatService.incomingCall = true;
        this.videoChatService.isCallActive = false;
        this.videoChatService.isDialogOpen = true;

        this.videoChatService.playIncomingCallSound();

        const dialogRef = this.matDialog.open(VideoChat, {
          width: '100vw',
          height: '100vh',
          maxWidth: '100vw',
          maxHeight: '100vh',
          panelClass: 'video-call-dialog-panel',
          disableClose: true,
        });
        this.activeCallDialogRef = dialogRef;

        dialogRef.afterClosed().subscribe(() => {
          if (this.activeCallDialogRef === dialogRef) {
            this.activeCallDialogRef = null;
          }
          this.videoChatService.isDialogOpen = false;
          this.videoChatService.stopIncomingCallSound();
        });
      })
    );

    this.subscriptions.add(
      this.videoChatService.callEnded.subscribe((senderId) => {
        this.videoChatService.stopIncomingCallSound();
        if (
          this.activeCallDialogRef &&
          (!this.videoChatService.remoteUserId || senderId === this.videoChatService.remoteUserId)
        ) {
          this.activeCallDialogRef.close();
          this.videoChatService.resetCallState();
        }
      })
    );
  }
}
