import { z } from "zod";
import {
  enforceRateLimit,
  errorResponse,
  json,
  phoneSchema,
  readJson,
  requireApiKey,
} from "@/lib/api";
import { maskPhone, webhookSignature } from "@/lib/simulator";

const metadataSchema = z.record(z.string().max(64), z.string().max(256))
  .refine((metadata) => Object.keys(metadata).length <= 20, "At most 20 metadata fields are allowed");

const schema = z.object({
  from: phoneSchema,
  to: z.string().min(1).max(20).regex(/^[A-Za-z0-9_+-]+$/).default("DEMO"),
  body: z.string().min(1).max(1000),
  provider: z.enum(["generic", "orange", "mtn", "moov"]).default("generic"),
  metadata: metadataSchema.optional(),
}).strict();

export async function POST(request: Request) {
  const limited = enforceRateLimit(request, "inbound", 30, 60_000);
  if (limited) return limited;

  const denied = requireApiKey(request);
  if (denied) return denied;

  try {
    const input = schema.parse(await readJson(request, 64 * 1024));
    const event = {
      id: `in_${crypto.randomUUID()}`,
      type: "message.received",
      from: maskPhone(input.from),
      to: input.to,
      body: input.body,
      provider: input.provider,
      metadata: input.metadata ?? {},
      received_at: new Date().toISOString(),
    };

    return json({
      event,
      signature: webhookSignature(event),
      signature_header: "x-simulator-signature",
    }, 202);
  } catch (error) {
    return errorResponse(error);
  }
}
