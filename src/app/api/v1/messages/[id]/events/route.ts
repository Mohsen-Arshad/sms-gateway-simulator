import { enforceRateLimit, errorResponse, json, requireApiKey } from "@/lib/api";
import { parseSmsPayload, smsEvents, webhookSignature } from "@/lib/simulator";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const limited = enforceRateLimit(request, "message-events", 60, 60_000);
  if (limited) return limited;

  const denied = requireApiKey(request);
  if (denied) return denied;

  try {
    const { id } = await params;
    const payload = parseSmsPayload(id);
    const events = smsEvents(payload).map((event) => {
      const body = { id, ...event };
      return { ...body, signature: webhookSignature(body) };
    });
    return json({ id, events });
  } catch (error) {
    return errorResponse(error);
  }
}
