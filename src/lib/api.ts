import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
    this.name = "ApiError";
  }
}

const rateLimits = new Map<string, { count: number; resetAt: number }>();
const MAX_RATE_LIMIT_KEYS = 10_000;

export const phoneSchema = z
  .string()
  .regex(/^\+[1-9]\d{7,14}$/, "Use E.164 format, e.g. +224612345678");

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "x-frame-options": "DENY",
    },
  });
}

export async function readJson<T = unknown>(
  request: Request,
  maxBytes = 64 * 1024,
): Promise<T> {
  const contentType = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new ApiError(415, "unsupported_media_type");
  }

  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    if (!/^\d+$/.test(declaredLength)) {
      throw new ApiError(400, "invalid_content_length");
    }
    if (Number(declaredLength) > maxBytes) {
      throw new ApiError(413, "request_too_large");
    }
  }

  const reader = request.body?.getReader();
  if (!reader) {
    throw new ApiError(400, "missing_request_body");
  }

  const chunks: Buffer[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new ApiError(413, "request_too_large");
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }

  let raw: string;
  try {
    raw = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
  } catch {
    throw new ApiError(400, "invalid_utf8");
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new ApiError(400, "invalid_json");
  }
}

export function errorResponse(error: unknown) {
  if (error instanceof ApiError) {
    return json({ error: error.code }, error.status);
  }
  if (error instanceof z.ZodError) {
    return json({ error: "validation_error", details: z.flattenError(error) }, 400);
  }
  if (error instanceof Error && error.message === "Invalid token") {
    return json({ error: "invalid_id" }, 404);
  }

  console.error("Unhandled simulator API error", error);
  return json({ error: "internal_error" }, 500);
}

export function hasValidProductionConfig() {
  if (process.env.NODE_ENV !== "production") return true;

  const simulatorSecret = process.env.SIMULATOR_SECRET ?? "";
  const apiKey = process.env.SIMULATOR_API_KEY ?? "";

  return (
    simulatorSecret.length >= 32 &&
    apiKey.length >= 32 &&
    simulatorSecret !== apiKey
  );
}

export function requireApiKey(request: Request) {
  if (!hasValidProductionConfig()) {
    return json({ error: "server_misconfigured" }, 503);
  }

  const expected = process.env.SIMULATOR_API_KEY;
  if (!expected) return null;

  const authorization = request.headers.get("authorization") ?? "";
  const supplied = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : "";
  const expectedBytes = Buffer.from(expected, "utf8");
  const suppliedBytes = Buffer.from(supplied, "utf8");
  const matches =
    suppliedBytes.length === expectedBytes.length &&
    timingSafeEqual(suppliedBytes, expectedBytes);

  if (!matches) {
    return json({ error: "unauthorized" }, 401);
  }

  return null;
}

function clientIdentifier(request: Request) {
  // These headers must be overwritten by the trusted reverse proxy.
  const forwarded = request.headers.get("x-forwarded-for");
  const forwardedAddress = forwarded?.split(",").at(-1)?.trim();
  const address =
    request.headers.get("x-real-ip") ||
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-vercel-forwarded-for") ||
    forwardedAddress ||
    "unknown";

  return address.slice(0, 128);
}

export function enforceRateLimit(
  request: Request,
  scope: string,
  limit: number,
  windowMs: number,
  discriminator = "",
) {
  const now = Date.now();

  if (rateLimits.size >= MAX_RATE_LIMIT_KEYS) {
    for (const [key, entry] of rateLimits) {
      if (entry.resetAt <= now) rateLimits.delete(key);
    }
    while (rateLimits.size >= MAX_RATE_LIMIT_KEYS) {
      const oldestKey = rateLimits.keys().next().value;
      if (!oldestKey) break;
      rateLimits.delete(oldestKey);
    }
  }

  const key = `${scope}:${clientIdentifier(request)}:${discriminator}`;
  const current = rateLimits.get(key);

  if (!current || current.resetAt <= now) {
    rateLimits.set(key, { count: 1, resetAt: now + windowMs });
    return null;
  }

  if (current.count >= limit) {
    const retryAfter = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
    const response = json(
      { error: "rate_limited", retry_after_seconds: retryAfter },
      429,
    );
    response.headers.set("retry-after", String(retryAfter));
    return response;
  }

  current.count += 1;
  return null;
}

export function resetRateLimitsForTests() {
  rateLimits.clear();
}
