import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { enforceRateLimit, errorResponse, json, readJson, requireApiKey } from "@/lib/api";
import { parseOtpPayload } from "@/lib/simulator";

const schema = z.object({
  id: z.string().min(20).max(16_384),
  code: z.string().regex(/^\d{4,8}$/),
}).strict();

export async function POST(request: Request) {
  const limited = enforceRateLimit(request, "otp-verify", 5, 5 * 60_000);
  if (limited) return limited;

  const denied = requireApiKey(request);
  if (denied) return denied;

  try {
    const input = schema.parse(await readJson(request, 24 * 1024));
    const payload = parseOtpPayload(input.id);

    if (Date.now() >= payload.expiresAt) {
      return json({ id: input.id, status: "expired", verified: false }, 410);
    }

    const expected = Buffer.from(payload.code, "utf8");
    const supplied = Buffer.from(input.code, "utf8");
    const verified =
      expected.length === supplied.length && timingSafeEqual(expected, supplied);

    return json({
      id: input.id,
      status: verified ? "verified" : "invalid",
      verified,
    }, verified ? 200 : 400);
  } catch (error) {
    return errorResponse(error);
  }
}
