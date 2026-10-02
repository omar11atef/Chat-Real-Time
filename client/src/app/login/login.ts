import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../services/auth-service';

@Component({
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    MatInputModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatSnackBarModule
  ],
  selector: 'app-login',
  styleUrl: './login.css',
  templateUrl: './login.html',
})
export class Login {
  email: string = '';
  password: string = '';
  hidePassword: boolean = true;
  rememberMe: boolean = false;
  isLoading: boolean = false;
  errorMessage: string = '';
  successMessage: string = '';

  private authService = inject(AuthService);
  private snackBar = inject(MatSnackBar);
  private router = inject(Router);

  login() {
    this.isLoading = true;
    this.errorMessage = '';
    this.successMessage = '';

    this.authService.login(this.email, this.password).subscribe({
      next: (response) => {
        this.authService.me().subscribe();
        this.isLoading = false;
        this.successMessage = response?.message || 'Logged in successfully';

        this.snackBar.open('Logged in successfully', 'Close', {
          duration: 3500,
          verticalPosition: 'top',
          horizontalPosition: 'center',
          panelClass: ['blue-snackbar']
        });

        setTimeout(() => {
          this.router.navigate(['/']);
        }, 1200);
      },
      error: (err) => {
        this.isLoading = false;
        console.error('Login error:', err);
        this.errorMessage = err?.error?.error || err?.error?.message || 'Invalid email or password';

        this.snackBar.open(this.errorMessage, 'Close', {
          duration: 3500,
          verticalPosition: 'top',
          horizontalPosition: 'center',
          panelClass: ['error-snackbar']
        });
      }
    });
  }

  togglePassword(event?: MouseEvent) {
    this.hidePassword = !this.hidePassword;
    if (event) {
      event.preventDefault();
    }
  }
}
