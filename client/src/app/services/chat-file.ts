import { HttpClient, HttpHeaders } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiResponse } from '../models/api-response';
import { AttachmentCategory, ChatAttachment, Message } from '../models/message';
import { AuthService } from './auth-service';

export interface ClientFileValidationResult {
  valid: boolean;
  error?: string;
  category?: AttachmentCategory;
}

@Injectable({
  providedIn: 'root',
})
export class ChatFileService {
  static readonly MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB

  private static readonly ALLOWED_EXTENSIONS: Record<string, AttachmentCategory> = {
    '.jpg': 'image',
    '.jpeg': 'image',
    '.png': 'image',
    '.gif': 'image',
    '.webp': 'image',
    '.bmp': 'image',
    '.pdf': 'pdf',
    '.doc': 'word',
    '.docx': 'word',
    '.ppt': 'powerpoint',
    '.pptx': 'powerpoint',
    '.zip': 'archive',
    '.rar': 'archive',
    '.7z': 'archive',
    '.tar': 'archive',
    '.gz': 'archive',
    '.txt': 'text',
    '.csv': 'text',
    '.md': 'text',
  };

  private static readonly BLOCKED_DANGEROUS_EXTENSIONS = new Set([
    '.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx',
    '.html', '.htm', '.xhtml', '.svg', '.xml', '.xsl',
    '.exe', '.dll', '.msi', '.com', '.scr', '.pif', '.cpl', '.ocx', '.sys',
    '.bat', '.cmd', '.ps1', '.psm1', '.psd1', '.vbs', '.vbe', '.wsf', '.wsh', '.hta',
    '.sh', '.bash', '.zsh', '.ksh', '.csh',
    '.py', '.pyc', '.rb', '.pl', '.php', '.phtml', '.jsp', '.asp', '.aspx', '.cgi',
    '.jar', '.war', '.class', '.reg', '.inf', '.lnk', '.url',
    '.iso', '.img', '.dmg', '.apk', '.app',
    '.docm', '.xlsm', '.pptm', '.vb', '.vba', '.sct',
  ]);

  private readonly apiOrigin = 'http://localhost:5000';
  private readonly baseUrl = `${this.apiOrigin}/api/chat-files`;
  private httpClient = inject(HttpClient);
  private authService = inject(AuthService);

  private previewUrls = signal<Record<number, string>>({});
  private loadingAttachmentIds = new Set<number>();

  /** Validates file extension, double extensions, and size before uploading. */
  validateFile(file: File | null | undefined): ClientFileValidationResult {
    if (!file) {
      return { valid: false, error: 'Please select a file.' };
    }
    if (file.size === 0) {
      return { valid: false, error: 'Empty files cannot be sent.' };
    }
    if (file.size > ChatFileService.MAX_FILE_SIZE_BYTES) {
      return { valid: false, error: 'File size exceeds the 25 MB limit.' };
    }

    const fileName = file.name?.trim() || '';
    const lastDot = fileName.lastIndexOf('.');
    if (lastDot <= 0 || lastDot === fileName.length - 1) {
      return { valid: false, error: 'Files without a valid extension are not allowed.' };
    }

    const ext = fileName.slice(lastDot).toLowerCase();
    if (ChatFileService.BLOCKED_DANGEROUS_EXTENSIONS.has(ext)) {
      return {
        valid: false,
        error: `File type '${ext}' is blocked for security reasons. Scripts, executables, and HTML/SVG files are not permitted.`,
      };
    }

    const parts = fileName.split('.').filter(Boolean);
    for (let i = 1; i < parts.length - 1; i++) {
      const innerExt = `.${parts[i].toLowerCase()}`;
      if (ChatFileService.BLOCKED_DANGEROUS_EXTENSIONS.has(innerExt)) {
        return {
          valid: false,
          error: `File name contains a blocked embedded extension ('${innerExt}') and cannot be uploaded.`,
        };
      }
    }

    const category = ChatFileService.ALLOWED_EXTENSIONS[ext];
    if (!category) {
      return {
        valid: false,
        error: `File type '${ext}' is not supported. Allowed: images, PDF, Word, PowerPoint, compressed archives, and text files.`,
      };
    }

    return { valid: true, category };
  }

  /** Uploads and encrypts an attachment on the server and delivers the resulting message. */
  uploadFile(receiverId: string, file: File, caption?: string): Observable<ApiResponse<Message>> {
    const formData = new FormData();
    formData.append('receiverId', receiverId);
    formData.append('file', file, file.name);
    if (caption && caption.trim()) {
      formData.append('caption', caption.trim());
    }

    return this.httpClient.post<ApiResponse<Message>>(`${this.baseUrl}/upload`, formData, {
      headers: this.buildAuthHeaders(),
    });
  }

  /** Returns a reactive Blob object URL for rendering protected encrypted image attachments. */
  getPreviewUrl(attachment: ChatAttachment | null | undefined): string | null {
    if (!attachment?.id || !attachment.downloadUrl) {
      return null;
    }

    const cached = this.previewUrls()[attachment.id];
    if (cached) {
      return cached;
    }

    if (!this.loadingAttachmentIds.has(attachment.id) && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
      this.loadingAttachmentIds.add(attachment.id);
      this.fetchAttachmentBlob(attachment.downloadUrl).subscribe({
        next: (blob) => {
          const objectUrl = URL.createObjectURL(blob);
          this.previewUrls.update((current) => ({ ...current, [attachment.id]: objectUrl }));
          this.loadingAttachmentIds.delete(attachment.id);
        },
        error: () => {
          this.loadingAttachmentIds.delete(attachment.id);
        },
      });
    }

    return null;
  }

  /** Fetches the decrypted attachment and triggers a browser file download with its original name. */
  downloadAttachment(attachment: ChatAttachment): void {
    if (!attachment.downloadUrl) return;
    const url = this.resolveDownloadUrl(attachment.downloadUrl, true);
    this.httpClient
      .get(url, { headers: this.buildAuthHeaders(), responseType: 'blob' })
      .subscribe({
        next: (blob) => {
          if (typeof document === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
            return;
          }
          const blobUrl = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = blobUrl;
          link.download = attachment.originalFileName || 'attachment';
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
        },
        error: (err) => {
          console.error('Error downloading attachment:', err);
        },
      });
  }

  /** Opens a decrypted attachment (such as PDF or plain text) in a new browser tab. */
  openAttachmentPreview(attachment: ChatAttachment): void {
    if (!attachment.downloadUrl) return;
    this.fetchAttachmentBlob(attachment.downloadUrl).subscribe({
      next: (blob) => {
        if (typeof window === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
          return;
        }
        const blobUrl = URL.createObjectURL(blob);
        window.open(blobUrl, '_blank', 'noopener,noreferrer');
      },
      error: (err) => {
        console.error('Error opening attachment preview:', err);
      },
    });
  }

  formatFileSize(bytes?: number | null): string {
    if (!bytes || bytes <= 0) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  private fetchAttachmentBlob(downloadUrl: string): Observable<Blob> {
    const url = this.resolveDownloadUrl(downloadUrl, false);
    return this.httpClient.get(url, {
      headers: this.buildAuthHeaders(),
      responseType: 'blob',
    });
  }

  private resolveDownloadUrl(downloadUrl: string, asDownload: boolean): string {
    const base = downloadUrl.startsWith('http://') || downloadUrl.startsWith('https://')
      ? downloadUrl
      : `${this.apiOrigin}${downloadUrl.startsWith('/') ? '' : '/'}${downloadUrl}`;
    if (!asDownload) {
      return base;
    }
    return base.includes('?') ? `${base}&download=true` : `${base}?download=true`;
  }

  private buildAuthHeaders(): HttpHeaders {
    const token = this.authService.getToken();
    return token ? new HttpHeaders({ Authorization: `Bearer ${token}` }) : new HttpHeaders();
  }
}
