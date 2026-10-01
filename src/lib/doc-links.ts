import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signed, expiring links for CUSTOMER documents (payment receipts and delivery
 * sheets) so they can be sent over WhatsApp.
 *
 * Security rules:
 *  - Only an Owner can create a link (see /api/documents/share).
 *  - The token is an HMAC over type + id + expiry, so ids cannot be guessed or
 *    enumerated and links expire on their own.
 *  - Payroll, worker wages, internal costs and company financials are NEVER
 *    part of a shareable document. Those screens (payroll, bank sheet,
 *    profitability, reports) deliberately have no share action at all.
 */

export type ShareDocumentType = "receipt" | "delivery";

export const SHARE_LINK_DAYS = 30;

const TYPES: ShareDocumentType[] = ["receipt", "delivery"];

function secretKey(): string {
  // A dedicated secret is preferred. DATABASE_URL is only a fallback so local
  // development works without extra setup - it is never sent to the browser.
  return (
    process.env.DOCUMENT_SHARE_SECRET ||
    process.env.AUTH_SECRET ||
    process.env.DATABASE_URL ||
    "matesther-development-only"
  );
}

function signature(payload: string): string {
  return createHmac("sha256", secretKey()).update(payload).digest("base64url");
}

export function isShareDocumentType(value: unknown): value is ShareDocumentType {
  return typeof value === "string" && (TYPES as string[]).includes(value);
}

export function createDocumentToken(type: ShareDocumentType, id: number, days = SHARE_LINK_DAYS) {
  const expiresAt = Date.now() + days * 24 * 60 * 60 * 1000;
  const payload = `${type}.${id}.${expiresAt}`;
  const token = `${Buffer.from(payload, "utf8").toString("base64url")}.${signature(payload)}`;
  return { token, expiresAt: new Date(expiresAt) };
}

export function verifyDocumentToken(
  token: string | null | undefined
): { type: ShareDocumentType; id: number; expiresAt: Date } | null {
  if (!token || typeof token !== "string" || token.length > 400) return null;
  const [encoded, provided] = token.split(".");
  if (!encoded || !provided) return null;
  let payload: string;
  try {
    payload = Buffer.from(encoded, "base64url").toString("utf8");
  } catch {
    return null;
  }
  const [type, rawId, rawExpiry] = payload.split(".");
  if (!isShareDocumentType(type)) return null;
  const id = Number(rawId);
  const expiry = Number(rawExpiry);
  if (!Number.isSafeInteger(id) || id < 1 || !Number.isFinite(expiry)) return null;
  const expected = signature(payload);
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  if (Date.now() > expiry) return null;
  return { type, id, expiresAt: new Date(expiry) };
}

/** Where a verified link points. */
export function sharePath(token: string): string {
  return `/share/${token}`;
}
