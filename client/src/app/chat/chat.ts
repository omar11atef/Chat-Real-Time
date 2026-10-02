import { Component, inject } from '@angular/core';
import { AuthService } from '../services/auth-service';

@Component({
  imports: [],
  selector: 'app-chat',
  styleUrl: './chat.css',
  templateUrl: './chat.html',
})
export class Chat {
  authService = inject(AuthService);

  logout(){
    this.authService.logout();
  }
  
}
