import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { AuthService } from './auth-service';
import { ChatFileService } from './chat-file';

describe('ChatFileService', () => {
  let service: ChatFileService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        ChatFileService,
        {
          provide: AuthService,
          useValue: {
            getToken: () => 'jwt-token-xyz',
          },
        },
      ],
    });

    service = TestBed.inject(ChatFileService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('allows images, PDFs, Word, PowerPoint, compressed archives, and text files', () => {
    const validFiles = [
      { name: 'photo.png', type: 'image/png', expectedCategory: 'image' },
      { name: 'vacation.jpg', type: 'image/jpeg', expectedCategory: 'image' },
      { name: 'doc.pdf', type: 'application/pdf', expectedCategory: 'pdf' },
      { name: 'report.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', expectedCategory: 'word' },
      { name: 'slides.pptx', type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', expectedCategory: 'powerpoint' },
      { name: 'bundle.zip', type: 'application/zip', expectedCategory: 'archive' },
      { name: 'notes.txt', type: 'text/plain', expectedCategory: 'text' },
    ];

    for (const item of validFiles) {
      const file = new File(['sample content'], item.name, { type: item.type });
      const result = service.validateFile(file);
      expect(result.valid).toBe(true);
      expect(result.category).toBe(item.expectedCategory);
    }
  });

  it('blocks scripts, JS, HTML, SVG, executables, and double-extension spoofing', () => {
    const blockedNames = [
      'evil.js',
      'module.mjs',
      'run.ps1',
      'setup.exe',
      'batch.bat',
      'page.html',
      'icon.svg',
      'shell.sh',
      'payload.py',
      'macro.docm',
      'exploit.js.png',
      'trojan.exe.pdf',
    ];

    for (const name of blockedNames) {
      const file = new File(['alert(1)'], name, { type: 'application/octet-stream' });
      const result = service.validateFile(file);
      expect(result.valid).toBe(false);
      expect(result.error).toBeTruthy();
    }

    const emptyFile = new File([], 'empty.txt', { type: 'text/plain' });
    expect(service.validateFile(emptyFile).valid).toBe(false);
  });

  it('uploads file via FormData with Authorization Bearer token', () => {
    const file = new File(['pdf bytes'], 'spec.pdf', { type: 'application/pdf' });

    service.uploadFile('u-peer', file, 'See attached').subscribe((res) => {
      expect(res.data?.id).toBe(10);
    });

    const req = httpMock.expectOne('http://localhost:5000/api/chat-files/upload');
    expect(req.request.method).toBe('POST');
    expect(req.request.headers.get('Authorization')).toBe('Bearer jwt-token-xyz');
    expect(req.request.body instanceof FormData).toBe(true);
    const body = req.request.body as FormData;
    expect(body.get('receiverId')).toBe('u-peer');
    expect(body.get('caption')).toBe('See attached');
    expect((body.get('file') as File)?.name).toBe('spec.pdf');

    req.flush({
      IsSuccess: true,
      data: { id: 10, senderId: 'u-self', receiverId: 'u-peer', content: 'See attached', createdData: '', isRead: false },
      error: '',
      message: 'ok',
    });
  });
});
