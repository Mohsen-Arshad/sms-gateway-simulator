import { z } from "zod";
import {
  enforceRateLimit,
  errorResponse,
  json,
  phoneSchema,
  readJson,
  requireApiKey,
} from "@/lib/api";
import { providerFailureCode, type SimulatorProvider } from "@/lib/providers";
import { chooseFinalStatus, currentSmsStatus, maskPhone, seal, type SmsPayload } from "@/lib/simulator";

const metadataSchema = z.record(z.string().max(64), z.string().max(256))
  .refine((metadata) => Object.keys(metadata).length <= 20, "At most 20 metadata fields are allowed");

export const messageSchema = z.object({
  to: phoneSchema,
  body: z.string().min(1).max(1000),
  sender_id: z.string().min(1).max(20).regex(/^[A-Za-z0-9_-]+$/).default("DEMO"),
  provider: z.enum(["generic", "orange", "mtn", "moov"]).default("generic"),
  metadata: metadataSchema.optional(),
  simulation: z.object({
    latency_ms: z.number().int().min(0).max(30_000).default(700),
    delivery_delay_ms: z.number().int().min(0).max(60_000).default(1800),
    failure_rate: z.number().min(0).max(1).default(0.08),
    final_status: z.enum(["delivered", "failed"]).optional(),
    rate_limited: z.boolean().default(false),
    retry_after_seconds: z.number().int().min(1).max(3600).default(30),
  }).strict().optional(),
}).strict();

export function buildMessage(input: z.infer<typeof messageSchema>) {
  const simulation = input.simulation ?? {
    latency_ms: 700,
    delivery_delay_ms: 1800,
    failure_rate: 0.08,
    rate_limited: false,
    retry_after_seconds: 30,
  };

  if (simulation.rate_limited) {
    return {
      rateLimited: true as const,
      retryAfterSeconds: simulation.retry_after_seconds,
    };
  }

  const finalStatus = chooseFinalStatus(simulation.failure_rate, simulation.final_status);
  const provider = input.provider as SimulatorProvider;
  const payload: SmsPayload = {
    v: 1,
    type: "sms",
    createdAt: Date.now(),
    to: input.to,
    body: input.body,
    senderId: input.sender_id,
    latencyMs: simulation.latency_ms,
    deliveryDelayMs: simulation.delivery_delay_ms,
    finalStatus,
    failureCode: finalStatus === "failed" ? providerFailureCode(provider) : undefined,
    metadata: { ...input.metadata, provider },
  };

  const id = seal(payload, "sms");
  return {
    rateLimited: false as const,
    response: {
      id,
      status: currentSmsStatus(payload),
      to: maskPhone(payload.to),
      sender_id: payload.senderId,
      provider,
      created_at: new Date(payload.createdAt).toISOString(),
      simulation: {
        latency_ms: payload.latencyMs,
        delivery_delay_ms: payload.deliveryDelayMs,
        final_status: payload.finalStatus,
        failure_code: payload.failureCode ?? null,
      },
      links: { self: `/api/v1/messages/${id}`, events: `/api/v1/messages/${id}/events` },
    },
  };
}

export async function POST(request: Request) {
  const limited = enforceRateLimit(request, "messages", 60, 60_000);
  if (limited) return limited;

  const denied = requireApiKey(request);
  if (denied) return denied;

  try {
    const input = messageSchema.parse(await readJson(request, 64 * 1024));
    const result = buildMessage(input);

    if (result.rateLimited) {
      const response = json({
        error: "simulated_provider_rate_limit",
        message: "Simulated provider rate limit reached.",
        retry_after_seconds: result.retryAfterSeconds,
      }, 429);
      response.headers.set("retry-after", String(result.retryAfterSeconds));
      return response;
    }

    return json(result.response, 202);
  } catch (error) {
    return errorResponse(error);
  }
}
