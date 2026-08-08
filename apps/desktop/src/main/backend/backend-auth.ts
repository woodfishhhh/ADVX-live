import { randomBytes } from "node:crypto";

const STARTUP_TOKEN_BYTES = 32;
const STARTUP_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43,128}$/;

/**
 * Create the short-lived credential owned by Electron Main. It is deliberately
 * independent from the parent environment so an ambient token cannot become
 * the desktop/backend credential.
 */
export function createLocalBackendToken(): string {
  return randomBytes(STARTUP_TOKEN_BYTES).toString("base64url");
}

export function isLocalBackendToken(value: unknown): value is string {
  return typeof value === "string" && STARTUP_TOKEN_PATTERN.test(value);
}
