import { describe, expect, it } from "vitest";
import {
  currentSmsStatus,
  generateOtp,
  parseSmsPayload,
  seal,
  smsEvents,
  unseal,
  type SmsPayload,
} from "./simulator";

describe("simulator", () => {
  it("seals and validates an SMS payload", () => {
    const payload: SmsPayload = {
      v: 1,
      type: "sms",
      createdAt: 1_000,
      to: "+224612345678",
      body: "hello",
      senderId: "DEMO",
      latencyMs: 500,
      deliveryDelayMs: 1_000,
      finalStatus: "delivered",
    };
    const token = seal(payload, "sms");

    expect(parseSmsPayload(token)).toEqual(payload);
  });

  it("rejects a token with a different purpose prefix", () => {
    const token = seal({ hello: "world" }, "sms");
    expect(() => unseal(token.replace(/^sms_/, "otp_"), "otp")).toThrow("Invalid token");
  });

  it("rejects modified or malformed tokens", () => {
    const token = seal({ hello: "world" }, "sms");
    expect(() => unseal(token.slice(0, -2) + "xx", "sms")).toThrow("Invalid token");
    expect(() => unseal("sms_not-base64!", "sms")).toThrow("Invalid token");
  });

  it("derives message lifecycle from time", () => {
    const payload: SmsPayload = {
      v: 1,
      type: "sms",
      createdAt: 1_000,
      to: "+224612345678",
      body: "hello",
      senderId: "DEMO",
      latencyMs: 500,
      deliveryDelayMs: 1_000,
      finalStatus: "delivered",
    };

    expect(currentSmsStatus(payload, 1_200)).toBe("queued");
    expect(currentSmsStatus(payload, 1_600)).toBe("sent");
    expect(currentSmsStatus(payload, 2_600)).toBe("delivered");
    expect(smsEvents(payload, 2_600)).toHaveLength(3);
  });

  it("generates cryptographically random numeric OTPs with valid lengths", () => {
    expect(generateOtp(6)).toMatch(/^\d{6}$/);
    expect(() => generateOtp(3)).toThrow(RangeError);
    expect(() => generateOtp(9)).toThrow(RangeError);
  });
});
