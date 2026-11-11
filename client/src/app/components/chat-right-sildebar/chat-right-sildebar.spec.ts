import { TestBed } from '@angular/core/testing';
import { ChatRightSildebar } from './chat-right-sildebar';

describe('ChatRightSildebar', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ChatRightSildebar],
    }).compileComponents();
  });

  it('displays profile image, name, and email for the selected chat user', () => {
    const fixture = TestBed.createComponent(ChatRightSildebar);
    fixture.componentInstance.selectedUser = {
      id: 'u-1',
      fullName: 'rama kumari',
      userName: 'ramakumari',
      email: 'rama@gmail.com',
      profilePicture: 'http://localhost:5000/uploads/rama.png',
    };
    fixture.detectChanges();

    const img = fixture.nativeElement.querySelector('.profile-avatar-img') as HTMLImageElement | null;
    const name = fixture.nativeElement.querySelector('.profile-name') as HTMLElement | null;
    const email = fixture.nativeElement.querySelector('.profile-email') as HTMLElement | null;

    expect(img).toBeTruthy();
    expect(img?.getAttribute('src')).toBe('http://localhost:5000/uploads/rama.png');
    expect(name?.textContent?.trim()).toBe('Rama Kumari');
    expect(email?.textContent?.trim()).toBe('rama@gmail.com');
  });

  it('falls back to initials if profile image is missing or fails to load', () => {
    const fixture = TestBed.createComponent(ChatRightSildebar);
    fixture.componentInstance.selectedUser = {
      id: 'u-2',
      fullName: 'Rama Kumari',
      userName: 'ramakumari',
      email: 'rama@gmail.com',
      profilePicture: 'http://localhost:5000/uploads/missing.png',
    };
    fixture.detectChanges();

    fixture.componentInstance.onImageError();
    fixture.detectChanges();

    const img = fixture.nativeElement.querySelector('.profile-avatar-img');
    const fallback = fixture.nativeElement.querySelector('.profile-avatar-fallback') as HTMLElement | null;

    expect(img).toBeNull();
    expect(fallback?.textContent?.trim()).toBe('RK');
  });
});
