import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable, tap } from 'rxjs';
import { ApiResponse } from '../models/api-response';
import { User } from '../models/user';

@Injectable({
  providedIn: 'root'
})
export class AuthService {

    token(token: any): string | null {
        throw new Error('Method not implemented.');
    }
    private baseUrl = 'http://localhost:5000/api/account';
    private tokenKey = 'token';
    httpClient = inject(HttpClient);

    register(data: FormData): Observable<ApiResponse<string>> {
        return this.httpClient.post<ApiResponse<string>>(`${this.baseUrl}/register`, data)
        .pipe(tap((response) => {
            if (response?.data) {
                this.setToken(response.data);
            }
        }));
    }

    login(email: string, password: string): Observable<ApiResponse<string>> {
        return this.httpClient.post<ApiResponse<string>>(`${this.baseUrl}/login`, { email, password })
        .pipe(tap((response) => {
            if (response?.data) {
                this.setToken(response.data);
            }
        }));
    }

    private setToken(token: string) {
        localStorage.setItem(this.tokenKey, token);
        const maxAge = 7 * 24 * 60 * 60; // 7 days
        document.cookie = `token=${token}; path=/; max-age=${maxAge}; SameSite=Lax`;
    }

    getToken(): string | null {
        const match = document.cookie.match(new RegExp('(^| )token=([^;]+)'));
        if (match) {
            return match[2];
        }
        return localStorage.getItem(this.tokenKey);
    }

  me(): Observable<ApiResponse<User>> {
  return this.httpClient
    .get<ApiResponse<User>>(`${this.baseUrl}/me`, {
      headers: {
        Authorization: `Bearer ${this.getToken()}`,
      },
    })
    .pipe(
      tap((response) => {
        if (response.IsSuccess) {
          localStorage.setItem('user', JSON.stringify(response.data));
        }
      })
    );
}

    get getAccessToken(): string | null {
        return localStorage.getItem(this.tokenKey) || '';
    }
    IsLoggedIn(): boolean {
        return !!localStorage.getItem(this.tokenKey);
    }
    logout(){
        localStorage.removeItem(this.tokenKey);
        localStorage.removeItem('user');
    }
}
