import { enforceRateLimit, json, requireApiKey } from "@/lib/api";
import { providerCatalog } from "@/lib/providers";

export async function GET(request: Request) {
  const limited = enforceRateLimit(request, "providers", 30, 60_000);
  if (limited) return limited;

  const denied = requireApiKey(request);
  if (denied) return denied;

  return json({
    providers: providerCatalog(),
    note: "These are simulator-only error codes and are not official operator specifications.",
  });
}
