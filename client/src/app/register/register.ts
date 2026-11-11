import { Component, inject } from '@angular/core';
import { AuthService } from '../services/auth-service';
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatInputModule } from "@angular/material/input";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { Router, RouterLink } from '@angular/router';

@Component({
  imports: [CommonModule, MatFormFieldModule, FormsModule, MatButtonModule, MatInputModule, MatIconModule, MatSnackBarModule, RouterLink],
  selector: 'app-register',
  styleUrl: './register.css',
  templateUrl: './register.html',
})
export class Register {
  email: string = '';
  userName: string = '';
  fullName: string = '';
  password: string = '';
  hidePassword: boolean = true;
  profilePicture: string = 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=150';
  profileImage: File | null = null;
  isLoading: boolean = false;
  errorMessage: string = '';
  successMessage: string = '';

  authservice = inject(AuthService);
  router = inject(Router);
  private snackBar = inject(MatSnackBar);

  onFileSelected(event: any) {
    const file = event.target.files?.[0];
    if (file) {
      this.profileImage = file;
      const reader = new FileReader();
      reader.onload = () => {
        this.profilePicture = reader.result as string;
      };
      reader.readAsDataURL(file);
    }
  }

  register() {
    if (this.isLoading) return;

    if (!this.profileImage) {
      this.errorMessage = 'Profile picture is required';
      this.snackBar.open(this.errorMessage, 'Close', {
        duration: 3500,
        verticalPosition: 'top',
        horizontalPosition: 'center',
        panelClass: ['error-snackbar']
      });
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';
    this.successMessage = '';

    const formData = new FormData();
    formData.append('email', this.email);
    formData.append('username', this.userName);
    formData.append('fullname', this.fullName);
    formData.append('password', this.password);
    formData.append('profilePicture', this.profileImage);

    this.authservice.register(formData).subscribe({
      next: (response: any) => {
        this.isLoading = false;
        this.successMessage = response?.message || 'User created successfully';
        this.snackBar.open(this.successMessage, 'Close', {
          duration: 3000,
          verticalPosition: 'top',
          horizontalPosition: 'center',
          panelClass: ['blue-snackbar']
        });
        setTimeout(() => {
          this.router.navigate(['/login']);
        }, 800);
      },
      error: (err: any) => {
        this.isLoading = false;
        console.error('Registration failed:', err);
        this.errorMessage = err?.error?.error || err?.error?.message || 'Registration failed';
        this.snackBar.open(this.errorMessage, 'Close', {
          duration: 3500,
          verticalPosition: 'top',
          horizontalPosition: 'center',
          panelClass: ['error-snackbar']
        });
      }
    });
  }
}
