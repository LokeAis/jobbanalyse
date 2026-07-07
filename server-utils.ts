import crypto from "crypto";

// --- Constant-time string comparison ---
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// --- HMAC-signed interview session tokens ---
export interface SessionPayload {
  uid: string;
  turnsLeft: number;
  iat: number;
}

export function signSession(secret: string, payload: SessionPayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifySession(secret: string, token: unknown): SessionPayload | null {
  if (typeof token !== "string" || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  const expected = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString()) as SessionPayload;
  } catch {
    return null;
  }
}

// --- Credit packages (single source of truth) ---
export interface CreditPackage {
  id: string;
  credits: number;
  amountNok: number;
  label: string;
  badge?: string;
}

export const CREDIT_PACKAGES: CreditPackage[] = [
  { id: "single", credits: 1, amountNok: 49, label: "1 klipp" },
  { id: "triple", credits: 3, amountNok: 99, label: "3 klipp", badge: "Mest populær" },
  { id: "ten", credits: 10, amountNok: 249, label: "10 klipp" },
  { id: "twenty", credits: 20, amountNok: 399, label: "20 klipp", badge: "Beste verdi" },
];
