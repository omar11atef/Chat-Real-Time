import { HttpClient } from '@angular/common/http';
import { inject, Service } from '@angular/core';
import { Observable, tap } from 'rxjs';
import { ApiResponse } from '../models/api-response';

@Service()
export class AuthService {
    private baseUrl = 'http://localhost:5000/api/account';
    httpClient = inject(HttpClient);

    register(data:FormData) :Observable<ApiResponse<string>>{
        return this.httpClient.post<ApiResponse<string>>(`${this.baseUrl}/register`, data)
        .pipe(tap((response) => {
            localStorage.setItem('token', response.data);
        }));
    }
}
