import { User } from '../models/user';

/** Returns a sanitized profile image URL for the given user, or an empty string if unavailable. */
export function getUserAvatarUrl(user?: User | null): string {
  if (!user) return '';
  const img = user.profilePicture || user.profileImage || user.photoUrl;
  if (!img || img === 'null' || img === 'undefined') return '';
  return img;
}

/** Builds up to two uppercase initials from a user's display name or username. */
export function getUserInitials(name?: string | null): string {
  if (!name || !name.trim()) return 'U';
  const clean = name.trim();
  const parts = clean.split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return clean.slice(0, 2).toUpperCase();
}
