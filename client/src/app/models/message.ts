export interface Message {
    id: number;
    senderId: string | null;
    receiverId: string | null;
    content: string | null;
    createdData: string;
    createdAt?: string;
    isRead: boolean;
}
