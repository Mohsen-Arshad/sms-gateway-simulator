import crypto from "node:crypto";
import { z } from "zod";

export type SmsFinalStatus = "delivered" | "failed";
export type SmsStatus = "queued" | "sent" | SmsFinalStatus;

export interface SmsPayload {
  v: 1;
  type: "sms";
  createdAt: number;
  to: string;
  body: string;
  senderId: string;
  latencyMs: number;
  deliveryDelayMs: number;
  finalStatus: SmsFinalStatus;
  failureCode?: string;
  metadata?: Record<string, string>;
}

export interface OtpPayload {
  v: 1;
  type: "otp";
  createdAt: number;
  to: string;
  code: string;
  expiresAt: number;
}

function getSecret() {
  const configured = process.env.SIMULATOR_SECRET;

  if (configured) {
    if (configured.length < 32) {
      throw new Error("SIMULATOR_SECRET must contain at least 32 characters");
    }
    return configured;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("SIMULATOR_SECRET must be configured in production");
  }

  return "dev-only-sms-gateway-simulator-secret";
}

function deriveKey(purpose: "encryption" | "webhook") {
  return crypto
    .createHmac("sha256", getSecret())
    .update(`sms-gateway-simulator:${purpose}:v1`, "utf8")
    .digest();
}

function getWebhookKey() {
  const configured = process.env.SIMULATOR_WEBHOOK_SECRET;
  if (configured) {
    if (configured.length < 32) {
      throw new Error("SIMULATOR_WEBHOOK_SECRET must contain at least 32 characters");
    }
    return crypto
      .createHmac("sha256", configured)
      .update("sms-gateway-simulator:webhook:v1", "utf8")
      .digest();
  }
  return deriveKey("webhook");
}

const smsPayloadSchema = z.object({
  v: z.literal(1),
  type: z.literal("sms"),
  createdAt: z.number().int().nonnegative(),
  to: z.string().regex(/^\+[1-9]\d{7,14}$/),
  body: z.string().min(1).max(1000),
  senderId: z.string().min(1).max(20),
  latencyMs: z.number().int().min(0).max(30_000),
  deliveryDelayMs: z.number().int().min(0).max(60_000),
  finalStatus: z.enum(["delivered", "failed"]),
  failureCode: z.string().max(100).optional(),
  metadata: z.record(z.string().max(64), z.string().max(256)).optional(),
}).strict();

const otpPayloadSchema = z.object({
  v: z.literal(1),
  type: z.literal("otp"),
  createdAt: z.number().int().nonnegative(),
  to: z.string().regex(/^\+[1-9]\d{7,14}$/),
  code: z.string().regex(/^\d{4,8}$/),
  expiresAt: z.number().int().positive(),
}).strict();

export function seal<T extends object>(payload: T, prefix: "sms" | "otp") {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", deriveKey("encryption"), iv);
  cipher.setAAD(Buffer.from(prefix, "utf8"));

  const plain = Buffer.from(JSON.stringify(payload), "utf8");
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${prefix}_${Buffer.concat([iv, tag, encrypted]).toString("base64url")}`;
}

export function unseal<T>(token: string, prefix: "sms" | "otp"): T {
  if (
    token.length > 16_384 ||
    !token.startsWith(`${prefix}_`)
  ) {
    throw new Error("Invalid token");
  }

  const encoded = token.slice(prefix.length + 1);
  if (!/^[A-Za-z0-9_-]+$/.test(encoded)) {
    throw new Error("Invalid token");
  }

  const data = Buffer.from(encoded, "base64url");
  if (data.toString("base64url") !== encoded || data.length < 29) {
    throw new Error("Invalid token");
  }

  try {
    const iv = data.subarray(0, 12);
    const tag = data.subarray(12, 28);
    const encrypted = data.subarray(28);
    const decipher = crypto.createDecipheriv("aes-256-gcm", deriveKey("encryption"), iv);
    decipher.setAAD(Buffer.from(prefix, "utf8"));
    decipher.setAuthTag(tag);

    const plain = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return JSON.parse(plain.toString("utf8")) as T;
  } catch {
    throw new Error("Invalid token");
  }
}

export function parseSmsPayload(token: string): SmsPayload {
  const parsed = smsPayloadSchema.safeParse(unseal<unknown>(token, "sms"));
  if (!parsed.success) throw new Error("Invalid token");
  return parsed.data;
}

export function parseOtpPayload(token: string): OtpPayload {
  const parsed = otpPayloadSchema.safeParse(unseal<unknown>(token, "otp"));
  if (!parsed.success) throw new Error("Invalid token");
  return parsed.data;
}

export function currentSmsStatus(payload: SmsPayload, now = Date.now()): SmsStatus {
  const elapsed = Math.max(0, now - payload.createdAt);
  if (elapsed < payload.latencyMs) return "queued";
  if (elapsed < payload.latencyMs + payload.deliveryDelayMs) return "sent";
  return payload.finalStatus;
}

export function smsEvents(payload: SmsPayload, now = Date.now()) {
  const events = [
    { type: "message.queued", status: "queued", at: new Date(payload.createdAt).toISOString() },
  ];

  if (now >= payload.createdAt + payload.latencyMs) {
    events.push({
      type: "message.sent",
      status: "sent",
      at: new Date(payload.createdAt + payload.latencyMs).toISOString(),
    });
  }

  if (now >= payload.createdAt + payload.latencyMs + payload.deliveryDelayMs) {
    events.push({
      type: payload.finalStatus === "delivered" ? "message.delivered" : "message.failed",
      status: payload.finalStatus,
      at: new Date(payload.createdAt + payload.latencyMs + payload.deliveryDelayMs).toISOString(),
    });
  }

  return events;
}

export function chooseFinalStatus(failureRate: number, forced?: SmsFinalStatus): SmsFinalStatus {
  if (forced) return forced;
  return crypto.randomInt(0, 10_000) < Math.round(failureRate * 10_000) ? "failed" : "delivered";
}

export function generateOtp(length = 6) {
  if (!Number.isInteger(length) || length < 4 || length > 8) {
    throw new RangeError("OTP length must be between 4 and 8 digits");
  }
  const min = 10 ** (length - 1);
  const max = 10 ** length;
  return String(crypto.randomInt(min, max));
}

export function webhookSignature(payload: unknown) {
  return `sha256=${crypto.createHmac("sha256", getWebhookKey()).update(JSON.stringify(payload)).digest("hex")}`;
}

export function maskPhone(phone: string) {
  return phone.length <= 6 ? phone : `${phone.slice(0, 4)}•••${phone.slice(-3)}`;
}
