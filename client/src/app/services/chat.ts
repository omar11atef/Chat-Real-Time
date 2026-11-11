import { inject, Injectable, signal } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { User } from '../models/user';
import { Message } from '../models/message';
import { AuthService } from './auth-service';
import { HubConnection, HubConnectionBuilder, HubConnectionState } from '@microsoft/signalr';

@Injectable({
    providedIn: 'root'
})
export class Chat {
    private authService = inject(AuthService);
    private snackBar = inject(MatSnackBar);
    private hubUrl = 'http://localhost:5000/chatHub';

    onlineUsers = signal<User[]>([]);
    hasReceivedUsers = signal<boolean>(false);
    connectionState = signal<HubConnectionState>(HubConnectionState.Disconnected);
    currentOpenedChat = signal<User | null>(null);
    chatMessages = signal<Message[]>([]);
    isLoading = signal<boolean>(false);
    hasMoreMessages = signal<boolean>(false);

    private hubConnection?: HubConnection;
    private activeToken: string | null = null;
    private startPromise: Promise<void> | null = null;
    private loadingPage = 1;
    private typingTimers = new Map<string, ReturnType<typeof setTimeout>>();
    private lastTypingSentAt = 0;
    private lastNotifiedOnlineAt = new Map<string, number>();
    private audioContext: AudioContext | null = null;
    private notificationBuffer: AudioBuffer | null = null;
    private notificationBlobUrl: string | null = null;
    private audioPreloadPromise: Promise<void> | null = null;
    private readonly soundUrl = '/assecc/mixkit-correct-answer-tone-2870.wav';

    constructor() {
        this.registerAudioUnlock();
    }

    requestNotificationPermission(): void {
        if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
            void Notification.requestPermission().catch(() => {});
        }
    }

    async startConnection(token: string, senderId?: string): Promise<void> {
        if (!token) {
            return;
        }

        this.requestNotificationPermission();
        void this.preloadNotificationSound();

        if (this.startPromise && this.activeToken === token) {
            return this.startPromise;
        }

        if (
            this.hubConnection &&
            this.activeToken === token &&
            this.hubConnection.state !== HubConnectionState.Disconnected
        ) {
            return Promise.resolve();
        }

        this.activeToken = token;

        const startTask = (async () => {
            if (this.hubConnection) {
                await this.disConnectConnection();
                this.activeToken = token;
            }

            const url = senderId
                ? `${this.hubUrl}?SenderId=${encodeURIComponent(senderId)}`
                : this.hubUrl;

            const connection = new HubConnectionBuilder()
                .withUrl(url, {
                    accessTokenFactory: () => this.authService.getToken() || token
                })
                .withAutomaticReconnect()
                .build();

            this.hubConnection = connection;
            this.registerHubEvents(connection);
            this.connectionState.set(HubConnectionState.Connecting);

            try {
                await connection.start();
                if (this.hubConnection !== connection) {
                    await connection.stop().catch(() => {});
                    return;
                }
                this.connectionState.set(connection.state);
                console.log('SignalR connection established.');
                const opened = this.currentOpenedChat();
                if (opened?.id) {
                    this.loadMessages(1);
                }
            } catch (err) {
                if (this.hubConnection === connection) {
                    this.connectionState.set(HubConnectionState.Disconnected);
                }
                console.error('Error establishing SignalR connection:', err);
            }
        })().finally(() => {
            if (this.startPromise === startTask) {
                this.startPromise = null;
            }
        });

        this.startPromise = startTask;
        return startTask;
    }

    async disConnectConnection(): Promise<void> {
        const connection = this.hubConnection;
        this.hubConnection = undefined;
        this.activeToken = null;
        this.startPromise = null;
        this.lastTypingSentAt = 0;
        for (const timer of this.typingTimers.values()) {
            clearTimeout(timer);
        }
        this.typingTimers.clear();
        this.lastNotifiedOnlineAt.clear();
        this.onlineUsers.set([]);
        this.hasReceivedUsers.set(false);
        this.currentOpenedChat.set(null);
        this.chatMessages.set([]);
        this.isLoading.set(false);
        this.hasMoreMessages.set(false);
        this.connectionState.set(HubConnectionState.Disconnected);

        if (connection && connection.state !== HubConnectionState.Disconnected) {
            try {
                await connection.stop();
            } catch (error) {
                console.error('Error disconnecting SignalR connection:', error);
            }
        }
    }

    openChat(user: User): void {
        this.currentOpenedChat.set(user);
        this.chatMessages.set([]);
        this.hasMoreMessages.set(false);
        this.onlineUsers.update(users =>
            users.map(u => (this.isSameUser(u, user) ? { ...u, unreadCount: 0 } : u))
        );
        this.loadMessages(1);
    }

    closeChat(): void {
        this.currentOpenedChat.set(null);
        this.chatMessages.set([]);
        this.hasMoreMessages.set(false);
        this.isLoading.set(false);
    }

    loadMessages(pageNumber: number = 1): void {
        const openedId = this.currentOpenedChat()?.id;
        if (!openedId || !this.hubConnection || this.hubConnection.state !== HubConnectionState.Connected) {
            return;
        }

        this.loadingPage = pageNumber;
        this.isLoading.update(() => true);
        this.hubConnection
            .invoke('LoadMessages', openedId, pageNumber)
            .catch(err => {
                console.error('Error loading messages:', err);
                this.isLoading.update(() => false);
            })
            .finally(() => {
                this.isLoading.update(() => false);
            });
    }

    async sendMessage(content: string): Promise<void> {
        const trimmed = content.trim();
        const receiverId = this.currentOpenedChat()?.id;
        if (!trimmed || !receiverId) {
            return;
        }

        if (this.startPromise) {
            await this.startPromise;
        }

        if (!this.hubConnection || this.hubConnection.state !== HubConnectionState.Connected) {
            return;
        }

        this.lastTypingSentAt = 0;

        try {
            await this.hubConnection.invoke('SendMessage', {
                receiverId,
                content: trimmed,
                isRead: false
            });
        } catch (err) {
            console.error('Error sending message:', err);
        }
    }

    notifyTyping(): void {
        const recipientUserName = this.currentOpenedChat()?.userName;
        if (!recipientUserName || !this.hubConnection || this.hubConnection.state !== HubConnectionState.Connected) {
            return;
        }

        const now = Date.now();
        if (now - this.lastTypingSentAt < 500) {
            return;
        }
        this.lastTypingSentAt = now;

        this.hubConnection.invoke('NotifyTyping', recipientUserName).catch(err => {
            console.error('Error sending typing notification:', err);
        });
    }

    async markAsRead(senderId: string): Promise<void> {
        if (!senderId || !this.hubConnection || this.hubConnection.state !== HubConnectionState.Connected) {
            return;
        }
        try {
            await this.hubConnection.invoke('MarkAsRead', senderId);
        } catch (err) {
            console.error('Error marking messages as read:', err);
        }
    }

    getCurrentUserId(): string | undefined {
        return this.getCurrentIdentity().id;
    }

    private registerHubEvents(connection: HubConnection): void {
        connection.on('OnlineUsers', (users: User[]) => {
            if (this.hubConnection !== connection) return;
            const wasInitialized = this.hasReceivedUsers();
            const prevUsers = this.onlineUsers();
            const typingKeys = new Set(this.typingTimers.keys());
            const seen = new Set<string>();
            const filtered = (users ?? [])
                .filter(user => !this.isCurrentUser(user))
                .filter(user => {
                    const key = (user.id || user.userName || '').toLowerCase();
                    if (!key || seen.has(key)) return false;
                    seen.add(key);
                    return true;
                })
                .map(user => {
                    const isTyping = Boolean(
                        user.userName && typingKeys.has(user.userName.toLowerCase())
                    );
                    return {
                        ...this.normalizeUser(user, Boolean(user.isOnline ?? user.IsOnline)),
                        isTyping,
                        IsTyping: isTyping
                    };
                });

            this.onlineUsers.set(this.sortUsersByOnline(filtered));
            this.hasReceivedUsers.set(true);

            if (wasInitialized) {
                for (const nextUser of filtered) {
                    const prev = prevUsers.find(u => this.isSameUser(u, nextUser));
                    if (nextUser.isOnline && prev && !prev.isOnline) {
                        this.showOnlineNotification(nextUser);
                    } else if (!nextUser.isOnline) {
                        const key = (nextUser.id || nextUser.userName || '').toLowerCase();
                        if (key) this.lastNotifiedOnlineAt.delete(key);
                    }
                }
            }

            const opened = this.currentOpenedChat();
            if (opened) {
                const updated = filtered.find(u => this.isSameUser(u, opened));
                if (updated) {
                    this.currentOpenedChat.set(updated);
                }
            }
        });

        connection.on('Notify', (connectedUser: User) => {
            if (this.hubConnection !== connection || !connectedUser || this.isCurrentUser(connectedUser)) {
                return;
            }

            this.onlineUsers.update(users => {
                const index = users.findIndex(u => this.isSameUser(u, connectedUser));
                if (index >= 0) {
                    const updated = [...users];
                    updated[index] = this.normalizeUser(
                        { ...updated[index], ...connectedUser },
                        true
                    );
                    return this.sortUsersByOnline(updated);
                }

                return this.sortUsersByOnline([
                    this.normalizeUser(connectedUser, true),
                    ...users
                ]);
            });

            this.showOnlineNotification(connectedUser);
        });

        connection.on('UserDisconnected', (disconnectedUser: User) => {
            if (this.hubConnection !== connection || !disconnectedUser || this.isCurrentUser(disconnectedUser)) {
                return;
            }

            if (disconnectedUser.userName) {
                const key = disconnectedUser.userName.toLowerCase();
                const timer = this.typingTimers.get(key);
                if (timer) {
                    clearTimeout(timer);
                    this.typingTimers.delete(key);
                }
                this.lastNotifiedOnlineAt.delete(key);
            }
            if (disconnectedUser.id) {
                this.lastNotifiedOnlineAt.delete(disconnectedUser.id.toLowerCase());
            }

            this.onlineUsers.update(users => {
                const updated = users.map(u =>
                    this.isSameUser(u, disconnectedUser)
                        ? { ...this.normalizeUser(u, false), isTyping: false, IsTyping: false }
                        : u
                );
                return this.sortUsersByOnline(updated);
            });
        });

        connection.on('TypingNotification', (senderUserName: string) => {
            if (this.hubConnection !== connection || !senderUserName) return;
            const key = senderUserName.toLowerCase();

            this.setUserTyping(key, true);

            const existingTimer = this.typingTimers.get(key);
            if (existingTimer) {
                clearTimeout(existingTimer);
            }
            this.typingTimers.set(
                key,
                setTimeout(() => {
                    this.typingTimers.delete(key);
                    this.setUserTyping(key, false);
                }, 2000)
            );
        });

        connection.on('LoadMessages', (messages: Message[]) => {
            if (this.hubConnection !== connection) return;
            const incoming = (messages ?? []).map(m => this.normalizeMessage(m));
            this.hasMoreMessages.set(incoming.length >= 10);

            if (this.loadingPage <= 1) {
                this.chatMessages.set(incoming);
            } else {
                this.chatMessages.update(existing => {
                    const existingIds = new Set(existing.map(m => m.id));
                    const older = incoming.filter(m => !existingIds.has(m.id));
                    return [...older, ...existing];
                });
            }
            this.isLoading.update(() => false);
        });

        connection.on('ReceiveMessage', (message: Message) => {
            if (this.hubConnection !== connection || !message) return;
            const normalized = this.normalizeMessage(message);

            if (normalized.senderId) {
                this.clearTypingByUserId(normalized.senderId);
            }

            const selfId = this.getCurrentIdentity().id;
            const openedId = this.currentOpenedChat()?.id;
            const isIncomingFromOther = Boolean(normalized.senderId && normalized.senderId !== selfId);
            const belongsToOpenChat =
                !!openedId &&
                ((normalized.senderId === openedId && (!selfId || normalized.receiverId === selfId)) ||
                 (normalized.receiverId === openedId && (!selfId || normalized.senderId === selfId)));

            if (isIncomingFromOther) {
                this.playNotificationSound();
            }

            if (belongsToOpenChat) {
                this.chatMessages.update(messages => {
                    if (normalized.id && messages.some(m => m.id === normalized.id)) {
                        return messages;
                    }
                    return [...messages, normalized];
                });

                if (normalized.senderId === openedId && !normalized.isRead) {
                    void this.markAsRead(openedId);
                }
                return;
            }

            if (isIncomingFromOther && normalized.senderId) {
                const sender = this.onlineUsers().find(u => u.id === normalized.senderId);
                this.onlineUsers.update(users =>
                    users.map(u =>
                        u.id === normalized.senderId
                            ? { ...u, unreadCount: (u.unreadCount ?? 0) + 1 }
                            : u
                    )
                );
                const senderName = sender?.fullName || sender?.userName || 'New message';
                const preview = normalized.content || 'Sent a message';
                this.showBrowserNotification(
                    senderName,
                    preview,
                    sender?.profilePicture || sender?.profileImage || sender?.photoUrl,
                    `msg-${normalized.id || Date.now()}`
                );
                this.snackBar.open(`${senderName}: ${preview}`, 'Close', {
                    duration: 3000,
                    verticalPosition: 'top',
                    horizontalPosition: 'right',
                    panelClass: ['blue-snackbar']
                });
            }
        });

        connection.on('MessageRead', (payload: number | number[]) => {
            if (this.hubConnection !== connection) return;
            const readIds = new Set(Array.isArray(payload) ? payload : [payload]);
            if (readIds.size === 0) return;

            this.chatMessages.update(messages =>
                messages.map(m => (readIds.has(m.id) ? { ...m, isRead: true } : m))
            );
        });

        connection.onreconnecting(() => {
            if (this.hubConnection === connection) {
                this.connectionState.set(HubConnectionState.Reconnecting);
            }
        });

        connection.onreconnected(() => {
            if (this.hubConnection === connection) {
                this.connectionState.set(HubConnectionState.Connected);
            }
        });

        connection.onclose(() => {
            if (this.hubConnection === connection) {
                this.connectionState.set(HubConnectionState.Disconnected);
            }
        });
    }

    private registerAudioUnlock(): void {
        if (typeof window === 'undefined') return;
        const unlock = () => {
            this.ensureAudioContext();
            if (this.audioContext?.state === 'suspended') {
                void this.audioContext.resume().catch(() => {});
            }
            void this.preloadNotificationSound();
        };
        window.addEventListener('pointerdown', unlock, { passive: true });
        window.addEventListener('keydown', unlock, { passive: true });
    }

    private ensureAudioContext(): AudioContext | null {
        if (typeof window === 'undefined') return null;
        if (!this.audioContext) {
            const Ctx = window.AudioContext || (window as any).webkitAudioContext;
            if (Ctx) {
                this.audioContext = new Ctx();
            }
        }
        return this.audioContext;
    }

    private preloadNotificationSound(): Promise<void> {
        if (
            typeof window === 'undefined' ||
            typeof fetch === 'undefined' ||
            !window.location?.origin?.startsWith('http')
        ) {
            return Promise.resolve();
        }
        if (this.notificationBuffer || this.audioPreloadPromise) {
            return this.audioPreloadPromise ?? Promise.resolve();
        }

        const resolvedUrl = new URL(this.soundUrl, window.location.origin).toString();
        this.audioPreloadPromise = fetch(resolvedUrl)
            .then(async res => {
                if (!res.ok) return;
                const arrayBuffer = await res.arrayBuffer();
                if (!this.notificationBlobUrl && typeof URL !== 'undefined' && typeof Blob !== 'undefined') {
                    this.notificationBlobUrl = URL.createObjectURL(new Blob([arrayBuffer], { type: 'audio/wav' }));
                }
                const ctx = this.ensureAudioContext();
                if (ctx) {
                    this.notificationBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
                }
            })
            .catch(err => {
                console.warn('Could not preload notification sound:', err);
            })
            .finally(() => {
                this.audioPreloadPromise = null;
            });

        return this.audioPreloadPromise;
    }

    private playNotificationSound(): void {
        if (typeof window === 'undefined') return;

        const ctx = this.ensureAudioContext();
        if (ctx && this.notificationBuffer) {
            if (ctx.state === 'suspended') {
                void ctx.resume().catch(() => {});
            }
            try {
                const source = ctx.createBufferSource();
                source.buffer = this.notificationBuffer;
                source.connect(ctx.destination);
                source.start(0);
                return;
            } catch (err) {
                console.warn('Web Audio playback failed, falling back to Audio():', err);
            }
        }

        if (typeof Audio === 'undefined') return;
        try {
            // Fresh Audio instance avoids Chrome/Vite seek-to-0 failure after first playback ends.
            const audio = new Audio(this.notificationBlobUrl || this.soundUrl);
            void audio.play().catch(err => {
                console.warn('Notification sound playback blocked or failed:', err);
            });
            void this.preloadNotificationSound();
        } catch (err) {
            console.warn('Notification sound playback failed:', err);
        }
    }

    private showBrowserNotification(title: string, body: string, icon?: string, tagPrefix?: string): void {
        if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
            new Notification(title, {
                body,
                icon: icon || undefined,
                tag: `${tagPrefix || 'chat'}-${Date.now()}`,
                renotify: true
            } as NotificationOptions);
        }
    }

    private showOnlineNotification(user: User): void {
        const key = (user.id || user.userName || '').toLowerCase();
        const now = Date.now();
        if (key) {
            const last = this.lastNotifiedOnlineAt.get(key) ?? 0;
            if (now - last < 1500) {
                return;
            }
            this.lastNotifiedOnlineAt.set(key, now);
        }

        const displayName = user.fullName || user.userName || 'A user';
        const icon = user.profilePicture || user.profileImage || user.photoUrl || undefined;

        this.showBrowserNotification(
            'Active now 🟠',
            `${displayName} is online now`,
            icon,
            `online-${user.id || user.userName || 'user'}`
        );

        this.snackBar.open(`${displayName} is online now`, 'Close', {
            duration: 3000,
            verticalPosition: 'top',
            horizontalPosition: 'right',
            panelClass: ['blue-snackbar']
        });
    }

    private setUserTyping(userNameLower: string, isTyping: boolean): void {
        this.onlineUsers.update(users =>
            users.map(u =>
                u.userName?.toLowerCase() === userNameLower
                    ? { ...u, isTyping, IsTyping: isTyping }
                    : u
            )
        );

        const opened = this.currentOpenedChat();
        if (opened?.userName?.toLowerCase() === userNameLower) {
            this.currentOpenedChat.set({ ...opened, isTyping, IsTyping: isTyping });
        }
    }

    private clearTypingByUserId(userId: string): void {
        const match = this.onlineUsers().find(u => u.id === userId);
        if (!match?.userName) return;

        const key = match.userName.toLowerCase();
        const timer = this.typingTimers.get(key);
        if (timer) {
            clearTimeout(timer);
            this.typingTimers.delete(key);
        }
        this.setUserTyping(key, false);
    }

    private normalizeMessage(message: Message): Message {
        return {
            ...message,
            isRead: Boolean(message.isRead ?? (message as any).IsRead)
        };
    }

    private normalizeUser(user: User, isOnline: boolean): User {
        return {
            ...user,
            profilePicture: user.profilePicture || user.profileImage || user.photoUrl,
            isOnline,
            IsOnline: isOnline
        };
    }

    private sortUsersByOnline(users: User[]): User[] {
        return [...users].sort((a, b) => Number(Boolean(b.isOnline)) - Number(Boolean(a.isOnline)));
    }

    private isSameUser(a: User, b: User): boolean {
        if (a.id && b.id && a.id === b.id) {
            return true;
        }
        if (a.userName && b.userName) {
            return a.userName.toLowerCase() === b.userName.toLowerCase();
        }
        return false;
    }

    private isCurrentUser(user: User): boolean {
        const identity = this.getCurrentIdentity();
        if (identity.id && user.id && user.id === identity.id) {
            return true;
        }
        if (identity.userName && user.userName) {
            return user.userName.toLowerCase() === identity.userName.toLowerCase();
        }
        return false;
    }

    private getCurrentIdentity(): { id?: string; userName?: string } {
        const current = this.authService.currentUser() || this.authService.getStoredUser();
        if (current?.id || current?.userName) {
            return { id: current.id, userName: current.userName };
        }

        const token = this.authService.getToken();
        if (!token) {
            return {};
        }

        try {
            const parts = token.split('.');
            if (parts.length !== 3) return {};
            const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
            const payload = JSON.parse(atob(base64));
            return {
                id: payload.nameid || payload.sub,
                userName: payload.unique_name || payload.name
            };
        } catch {
            return {};
        }
    }
}
