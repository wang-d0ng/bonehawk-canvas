import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";

const sessionCookieName = "cw_session";
const stateCookieName = "cw_oauth_state";

export interface CookieConfig {
  secret: string;
  secure?: boolean;
}

export function readSessionCookie(request: Request, config: CookieConfig): string | undefined {
  return verifySignedValue(readCookie(request, sessionCookieName), config.secret);
}

export function writeSessionCookie(response: Response, sessionId: string, config: CookieConfig): void {
  writeSignedCookie(response, sessionCookieName, sessionId, config, 60 * 60 * 24 * 30);
}

export function clearSessionCookie(response: Response, config: CookieConfig): void {
  clearCookie(response, sessionCookieName, config);
}

export function readStateCookie(request: Request, config: CookieConfig): string | undefined {
  return verifySignedValue(readCookie(request, stateCookieName), config.secret);
}

export function writeStateCookie(response: Response, state: string, config: CookieConfig): void {
  writeSignedCookie(response, stateCookieName, state, config, 60 * 10);
}

export function clearStateCookie(response: Response, config: CookieConfig): void {
  clearCookie(response, stateCookieName, config);
}

function writeSignedCookie(
  response: Response,
  name: string,
  value: string,
  config: CookieConfig,
  maxAgeSeconds: number
): void {
  response.cookie(name, signValue(value, config.secret), {
    httpOnly: true,
    sameSite: "lax",
    secure: config.secure ?? false,
    maxAge: maxAgeSeconds * 1000,
    path: "/"
  });
}

function clearCookie(response: Response, name: string, config: CookieConfig): void {
  response.clearCookie(name, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.secure ?? false,
    path: "/"
  });
}

function readCookie(request: Request, name: string): string | undefined {
  const cookieHeader = request.headers.cookie;
  if (!cookieHeader) return undefined;

  return cookieHeader
    .split(";")
    .map((part) => part.trim())
    .map((part) => part.split("="))
    .find(([key]) => key === name)
    ?.slice(1)
    .join("=");
}

function signValue(value: string, secret: string): string {
  return `${encodeURIComponent(value)}.${signature(value, secret)}`;
}

function verifySignedValue(signedValue: string | undefined, secret: string): string | undefined {
  if (!signedValue) return undefined;
  const [encodedValue, actualSignature] = signedValue.split(".");
  if (!encodedValue || !actualSignature) return undefined;

  const value = decodeURIComponent(encodedValue);
  const expectedSignature = signature(value, secret);
  const actual = Buffer.from(actualSignature);
  const expected = Buffer.from(expectedSignature);

  if (actual.length !== expected.length) return undefined;
  return timingSafeEqual(actual, expected) ? value : undefined;
}

function signature(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}
