import { hasValidProductionConfig, json } from "@/lib/api";

export async function GET() {
  if (!hasValidProductionConfig()) {
    return json({ status: "misconfigured", service: "sms-gateway-simulator" }, 503);
  }

  return json({
    status: "ok",
    service: "sms-gateway-simulator",
    version: "1.0.0",
    stateless: true,
    timestamp: new Date().toISOString(),
  });
}
