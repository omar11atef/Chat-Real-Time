export type AttachmentCategory =
  | 'image'
  | 'pdf'
  | 'word'
  | 'powerpoint'
  | 'archive'
  | 'text';

export interface ChatAttachment {
  id: number;
  messageId?: number | null;
  originalFileName: string;
  contentType: string;
  fileExtension: string;
  fileCategory: AttachmentCategory | string;
  fileSize: number;
  downloadUrl: string;
  isEncrypted?: boolean;
  createdAt?: string;
}

export interface MessageReaction {
  id: number;
  messageId: number;
  userId: string;
  emoji: string;
  createdAt?: string;
}

export interface Message {
  id: number;
  senderId: string | null;
  receiverId: string | null;
  content: string | null;
  createdData: string;
  createdAt?: string;
  isRead: boolean;
  attachmentId?: number | null;
  attachment?: ChatAttachment | null;
  reactions?: MessageReaction[];
}
