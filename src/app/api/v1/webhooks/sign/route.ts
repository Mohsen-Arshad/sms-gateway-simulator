import { enforceRateLimit, errorResponse, json, readJson, requireApiKey } from "@/lib/api";
import { webhookSignature } from "@/lib/simulator";

export async function POST(request: Request) {
  const limited = enforceRateLimit(request, "webhook-sign", 30, 60_000);
  if (limited) return limited;

  const denied = requireApiKey(request);
  if (denied) return denied;

  try {
    const payload = await readJson<unknown>(request, 32 * 1024);
    return json({
      algorithm: "HMAC-SHA256",
      signature: webhookSignature(payload),
      payload,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
