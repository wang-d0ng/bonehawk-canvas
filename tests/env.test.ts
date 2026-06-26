import { describe, expect, it } from "vitest";
import { loadEnv } from "../src/config/env.js";

const baseEnv = {
  CANVAS_BASE_URL: "https://school.instructure.com",
  CANVAS_ACCESS_TOKEN: "token-with-enough-length",
  PORT: "3000"
};

describe("loadEnv", () => {
  it("loads console report configuration with defaults", () => {
    const env = loadEnv(baseEnv);

    expect(env.REPORT_CHANNEL).toBe("console");
    expect(env.PORT).toBe(3000);
    expect(env.RATE_LIMIT_MAX_REQUESTS).toBe(120);
  });

  it("rejects invalid Canvas configuration", () => {
    expect(() =>
      loadEnv({ ...baseEnv, CANVAS_BASE_URL: "not-a-url" })
    ).toThrow("Invalid environment configuration");
  });

  it("allows OAuth configuration without a prototype token", () => {
    const env = loadEnv({
      CANVAS_BASE_URL: "https://school.instructure.com",
      CANVAS_CLIENT_ID: "1000000001",
      CANVAS_CLIENT_SECRET: "client-secret",
      CANVAS_REDIRECT_URI: "http://localhost:3000/api/auth/canvas/callback",
      OAUTH_STATE_SECRET: "oauth-state-secret-with-at-least-32-chars"
    });

    expect(env.CANVAS_ACCESS_TOKEN).toBeUndefined();
    expect(env.CANVAS_CLIENT_ID).toBe("1000000001");
  });

  it("allows startup before Canvas auth is configured", () => {
    const env = loadEnv({ CANVAS_BASE_URL: "https://school.instructure.com" });

    expect(env.CANVAS_ACCESS_TOKEN).toBeUndefined();
    expect(env.CANVAS_CLIENT_ID).toBeUndefined();
  });

  it("requires a strong OAuth state secret", () => {
    expect(() =>
      loadEnv({
        CANVAS_BASE_URL: "https://school.instructure.com",
        CANVAS_CLIENT_ID: "1000000001",
        CANVAS_CLIENT_SECRET: "client-secret",
        CANVAS_REDIRECT_URI: "http://localhost:3000/api/auth/canvas/callback",
        OAUTH_STATE_SECRET: "short"
      })
    ).toThrow("OAUTH_STATE_SECRET");
  });

  it("requires SMTP settings for email reports", () => {
    expect(() =>
      loadEnv({ ...baseEnv, REPORT_CHANNEL: "email" })
    ).toThrow("Email reports require");
  });

  it("loads complete email report settings", () => {
    const env = loadEnv({
      ...baseEnv,
      REPORT_CHANNEL: "email",
      REPORT_RECIPIENT_EMAIL: "student@example.com",
      SMTP_HOST: "smtp.example.com",
      SMTP_USER: "user",
      SMTP_PASS: "pass",
      SMTP_FROM: "bot@example.com"
    });

    expect(env.REPORT_RECIPIENT_EMAIL).toBe("student@example.com");
  });
});
