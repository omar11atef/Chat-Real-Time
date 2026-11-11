import {inject, Injectable} from '@angular/core';
import { HubConnection, HubConnectionBuilder } from '@microsoft/signalr';
import { AuthService } from './auth-service';
import { BehaviorSubject } from 'rxjs/internal/BehaviorSubject';

@Injectable({
    providedIn: 'root'
})
export class VideoChatService {
    private hubUrl = 'http://localhost:5000/hubs/video';
    private authService = inject(AuthService);
    
    public hubconnection!:HubConnection; 
    public offerReceived = new BehaviorSubject<{senderId: string, offer: RTCSessionDescriptionInit } | null>(null);
    public answerReceived = new BehaviorSubject<{senderId: string, answer: RTCSessionDescriptionInit } | null>(null);
    public iceCandidateReceived = new BehaviorSubject<{senderId: string, candidate: RTCIceCandidateInit } | null>(null);
    public incomingCall = false ; 
    public isCallActive = false ;
    public remoteUserId='';

    public preConnection!: RTCPeerConnection;

    startConnection(){
         this.hubconnection = new HubConnectionBuilder()
         .withUrl(this.hubUrl,{
            accessTokenFactory: () => this.authService.getToken()!
         })
         .withAutomaticReconnect()
         .build();
        this.hubconnection.start().catch(err => console.error('Error while starting connection: ' + err));
        
        this.hubconnection.on("ReceiveVideo", (senderId,offer) => {
            this.offerReceived.next({senderId, offer:JSON.parse(offer)});
        });
        
        this.hubconnection.on("ReceiveAnswer", (senderId, answer) => {
            this.answerReceived.next({senderId, answer:JSON.parse(answer)});
        });

        this.hubconnection.on("ReceiveIceCandidate", (senderId, candidate) => {
            this.iceCandidateReceived.next({senderId, candidate:JSON.parse(candidate)});
        });
    }

    sendOffer(receiverId: string, offer: RTCSessionDescription){
        this.hubconnection.invoke("SendOffer", receiverId, JSON.stringify(offer))
        .catch(err => console.error('Error while sending offer: ' + err));
    }

    sendAnswer(receiverId: string, answer: RTCSessionDescriptionInit){
        this.hubconnection.invoke("SendAnswer", receiverId, JSON.stringify(answer))
        .catch(err => console.error('Error while sending answer: ' + err));
    }

    sendIceCandidate(receiverId: string, candidate: RTCIceCandidateInit){
        this.hubconnection.invoke("SendIceCandidate", receiverId, JSON.stringify(candidate))
        .catch(err => console.error('Error while sending ice candidate: ' + err));
    }

    sendEndCall(receiverId: string){
        this.hubconnection.invoke("EndCall", receiverId)
        .catch(err => console.error('Error while sending end call: ' + err));
    }
}