import { HttpClient } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, Observable, of, switchMap, tap } from 'rxjs';
import { ApiResponse } from '../models/api-response';
import { User } from '../models/user';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
    private baseUrl = 'http://localhost:5000/api/account';
    private tokenKey = 'token';
    private userKey = 'user';
    httpClient = inject(HttpClient);
    router = inject(Router);

    currentUser = signal<User | null>(this.getStoredUser());
    currentLoggedUser: any;

    register(data: FormData): Observable<ApiResponse<string>> {
        return this.httpClient.post<ApiResponse<string>>(`${this.baseUrl}/register`, data)
        .pipe(tap((response) => {
            const data = (response as any)?.data ?? (response as any)?.Data;
            if (data) {
                this.setToken(data);
            }
        }));
    }

    login(email: string, password: string): Observable<ApiResponse<any>> {
        return this.httpClient.post<ApiResponse<any>>(`${this.baseUrl}/login`, { email, password })
        .pipe(
            tap((response) => {
                const data = (response as any)?.data ?? (response as any)?.Data;
                const token = data?.token || (typeof data === 'string' ? data : null);
                if (token) {
                    this.setToken(token);
                }
                const user = data?.user;
                if (user) {
                    this.setUser(user);
                }
            }),
            switchMap((loginRes) => {
                return this.me().pipe(
                    catchError(() => of(loginRes))
                );
            })
        );
    }

    private setToken(token: string) {
        localStorage.setItem(this.tokenKey, token);
        const maxAge = 7 * 24 * 60 * 60; // 7 days
        document.cookie = `${this.tokenKey}=${token}; path=/; max-age=${maxAge}; SameSite=Lax`;
    }

    setUser(user: User) {
        if (!user) return;
        localStorage.setItem(this.userKey, JSON.stringify(user));
        const maxAge = 7 * 24 * 60 * 60; // 7 days
        const serialized = encodeURIComponent(JSON.stringify(user));
        document.cookie = `${this.userKey}=${serialized}; path=/; max-age=${maxAge}; SameSite=Lax`;
        this.currentUser.set(user);
    }

    getToken(): string | null {
        const local = localStorage.getItem(this.tokenKey);
        if (local) return local;
        const match = document.cookie.match(new RegExp('(^|;\\s*)' + this.tokenKey + '=([^;]*)'));
        return match ? match[2] : null;
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
                    const userData = (response as any)?.data ?? (response as any)?.Data;
                    if (userData) {
                        this.setUser(userData);
                    }
                })
            );
    }

    getUsers(): Observable<ApiResponse<User[]>> {
        return this.httpClient.get<ApiResponse<User[]>>(`${this.baseUrl}/users`, {
            headers: {
                Authorization: `Bearer ${this.getToken()}`,
            },
        });
    }

    getStoredUser(): User | null {
        // 1. Check localStorage first
        const userJson = localStorage.getItem(this.userKey);
        if (userJson) {
            try {
                return JSON.parse(userJson);
            } catch {}
        }

        // 2. Check cookies
        const cookieMatch = document.cookie.match(new RegExp('(^|;\\s*)' + this.userKey + '=([^;]*)'));
        if (cookieMatch && cookieMatch[2]) {
            try {
                const parsed = JSON.parse(decodeURIComponent(cookieMatch[2]));
                if (parsed) return parsed;
            } catch (e) {
                console.error('Failed to parse user from cookie:', e);
            }
        }

        return null;
    }

    get getAccessToken(): string | null {
        return this.getToken() || '';
    }

    isLoggedIn(): boolean {
        return !!this.getToken();
    }

    IsLoggedIn(): boolean {
        return this.isLoggedIn();
    }

    logout() {
        localStorage.removeItem(this.tokenKey);
        localStorage.removeItem(this.userKey);
        document.cookie = `${this.tokenKey}=; path=/; max-age=0; SameSite=Lax`;
        document.cookie = `${this.userKey}=; path=/; max-age=0; SameSite=Lax`;
        this.currentUser.set(null);
        this.router.navigate(['/login']);
    }
}
