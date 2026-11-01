import { z } from "zod";
import { enforceRateLimit, errorResponse, json, phoneSchema, readJson, requireApiKey } from "@/lib/api";
import { generateOtp, maskPhone, seal, type OtpPayload } from "@/lib/simulator";

const schema = z.object({
  to: phoneSchema,
  ttl_seconds: z.number().int().min(30).max(900).default(300),
  length: z.number().int().min(4).max(8).default(6),
}).strict();

export async function POST(request: Request) {
  const limited = enforceRateLimit(request, "otp-send", 8, 5 * 60_000);
  if (limited) return limited;

  const denied = requireApiKey(request);
  if (denied) return denied;

  try {
    const input = schema.parse(await readJson(request, 16 * 1024));
    const createdAt = Date.now();
    const code = generateOtp(input.length);
    const payload: OtpPayload = {
      v: 1,
      type: "otp",
      createdAt,
      to: input.to,
      code,
      expiresAt: createdAt + input.ttl_seconds * 1000,
    };
    const id = seal(payload, "otp");
    const exposeOtp =
      process.env.NODE_ENV !== "production" &&
      process.env.SIMULATOR_EXPOSE_OTP === "true";

    return json({
      id,
      status: "pending",
      to: maskPhone(input.to),
      expires_at: new Date(payload.expiresAt).toISOString(),
      ...(exposeOtp ? { debug: { code } } : {}),
    }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
