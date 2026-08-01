/**
 * Username+password accounts ride on Supabase's email-based auth, but the
 * app never shows or asks for an email — every synthetic address is
 * deterministic (`lower(username)@kendocoach.internal`), so login never
 * needs a username→email lookup, just this same derivation.
 */
const USERNAME_PATTERN = /^[a-zA-Z0-9_]{3,20}$/;
const SYNTHETIC_EMAIL_DOMAIN = "kendocoach.internal";
const MIN_PASSWORD_LENGTH = 8;

export function isValidUsername(username: string): boolean {
  return USERNAME_PATTERN.test(username);
}

export function isValidPassword(password: string): boolean {
  return password.length >= MIN_PASSWORD_LENGTH;
}

export function usernameToSyntheticEmail(username: string): string {
  return `${username.toLowerCase()}@${SYNTHETIC_EMAIL_DOMAIN}`;
}
