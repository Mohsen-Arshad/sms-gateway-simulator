import { afterEach, describe, expect, it } from "vitest";
import {
  enforceRateLimit,
  errorResponse,
  hasValidProductionConfig,
  readJson,
  requireApiKey,
  resetRateLimitsForTests,
} from "./api";

const originalNodeEnv = process.env.NODE_ENV;
const originalApiKey = process.env.SIMULATOR_API_KEY;
const originalSimulatorSecret = process.env.SIMULATOR_SECRET;

afterEach(() => {
  process.env.NODE_ENV = originalNodeEnv;
  if (originalApiKey === undefined) delete process.env.SIMULATOR_API_KEY;
  else process.env.SIMULATOR_API_KEY = originalApiKey;
  if (originalSimulatorSecret === undefined) delete process.env.SIMULATOR_SECRET;
  else process.env.SIMULATOR_SECRET = originalSimulatorSecret;
  resetRateLimitsForTests();
});

describe("API security helpers", () => {
  it("fails closed when production API key or secret is missing", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.SIMULATOR_API_KEY;
    delete process.env.SIMULATOR_SECRET;

    expect(hasValidProductionConfig()).toBe(false);
    const response = requireApiKey(new Request("https://example.test"));
    expect(response?.status).toBe(503);
    await expect(response?.json()).resolves.toMatchObject({ error: "server_misconfigured" });
  });

  it("rejects weak or reused production secrets", () => {
    process.env.NODE_ENV = "production";
    process.env.SIMULATOR_API_KEY = "short";
    process.env.SIMULATOR_SECRET = "a-different-secret-that-is-long-enough";
    expect(hasValidProductionConfig()).toBe(false);
    expect(requireApiKey(new Request("https://example.test"))?.status).toBe(503);

    process.env.SIMULATOR_API_KEY = process.env.SIMULATOR_SECRET;
    expect(hasValidProductionConfig()).toBe(false);
  });

  it("accepts independent strong production secrets", () => {
    process.env.NODE_ENV = "production";
    process.env.SIMULATOR_API_KEY = "api-key-that-is-32-characters-or-more";
    process.env.SIMULATOR_SECRET = "simulator-secret-is-also-32-characters";
    expect(hasValidProductionConfig()).toBe(true);
  });

  it("rejects invalid API keys and accepts the exact bearer key", () => {
    process.env.NODE_ENV = "test";
    process.env.SIMULATOR_API_KEY = "local-test-api-key";

    const unauthorized = requireApiKey(new Request("https://example.test"));
    expect(unauthorized?.status).toBe(401);

    const authorized = requireApiKey(new Request("https://example.test", {
      headers: { authorization: "Bearer local-test-api-key" },
    }));
    expect(authorized).toBeNull();
  });

  it("rejects requests without JSON content type", async () => {
    const request = new Request("https://example.test", {
      method: "POST",
      body: "{}",
    });
    await expect(readJson(request)).rejects.toMatchObject({ status: 415 });
  });

  it("rejects bodies larger than the configured limit while streaming", async () => {
    const request = new Request("https://example.test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ payload: "too large" }),
    });
    await expect(readJson(request, 4)).rejects.toMatchObject({ status: 413 });
  });

  it("rejects malformed JSON with a client error", async () => {
    const request = new Request("https://example.test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });
    await expect(readJson(request)).rejects.toMatchObject({ status: 400, code: "invalid_json" });
  });

  it("returns a rate-limit response after the configured allowance", async () => {
    const request = new Request("https://example.test", {
      headers: { "x-real-ip": "192.0.2.20" },
    });

    expect(enforceRateLimit(request, "test", 1, 60_000)).toBeNull();
    const response = enforceRateLimit(request, "test", 1, 60_000);

    expect(response?.status).toBe(429);
    expect(response?.headers.get("retry-after")).toBeTruthy();
  });

  it("does not leak exception messages to API clients", async () => {
    const response = errorResponse(new Error("private database connection string"));
    expect(response.status).toBe(500);
    const body = await response.json();

    expect(body).toEqual({ error: "internal_error" });
    expect(JSON.stringify(body)).not.toContain("private database connection string");
  });

  it("maps invalid opaque IDs to not found instead of an internal error", async () => {
    const response = errorResponse(new Error("Invalid token"));
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "invalid_id" });
  });
});
