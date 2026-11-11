import { Component, inject, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import {MatSlideToggle} from '@angular/material/slide-toggle';
import { VideoChatService } from './services/video-chat';
import { AuthService } from './services/auth-service';
import { MatDialog } from '@angular/material/dialog';

@Component({
  // imports: [MatSlideToggle, RouterOutlet],
  imports: [RouterOutlet],
  selector: 'app-root',
  styleUrl: './app.css',
  templateUrl: './app.html',
})
export class App {
  protected readonly title = signal('client');

  private singleRService = inject(VideoChatService);    
  private authService = inject(AuthService);
  private matiDalog = inject(MatDialog); 

  ngOninit() : void {
    if(!this.authService.getAccessToken) return;
    this.singleRService.startConnection();
    this.startOfferReceived();
  }

  startOfferReceived() {
    this.singleRService.offerReceived.subscribe(async(data)=>{
      if(data){
        this.matiDalog.open(VideoChatService,{
          width: '400px',
          height: '600px',
          disableClose: false,
        });
        this.singleRService.remoteUserId = data.senderId;
        this.singleRService.incomingCall = true;
      }
    });
  }

}
