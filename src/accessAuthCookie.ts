import type { CookieOptions } from "express";

/** HTTP-only JWT cookie: set after login/register, cleared by logout. Overrides via AUTH_ACCESS_COOKIE_NAME. */
export const ACCESS_TOKEN_COOKIE_NAME =
  process.env.AUTH_ACCESS_COOKIE_NAME ?? "accessToken";

/** Must match JWT default when using `JWT_EXPIRES_IN=7d` (approximate drift if env differs). */
const DEFAULT_COOKIE_MAX_MS = 7 * 24 * 60 * 60 * 1000;

/** Options when setting `Set-Cookie` (includes maxAge). */
export function accessAuthCookieOpts(): CookieOptions {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: DEFAULT_COOKIE_MAX_MS,
  };
}

/** Subset repeated on `clearCookie` — must align with what was sent on set (path/domain/secure/etc.). */
export function accessAuthCookieClearOpts(): CookieOptions {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  };
}
