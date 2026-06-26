import { afterEach, describe, expect, it } from "vitest";
import type { StartedCanvasBotServer } from "../src/appRuntime.js";
import { startCanvasBotServer } from "../src/appRuntime.js";

const startedServers: StartedCanvasBotServer[] = [];

describe("startCanvasBotServer", () => {
  afterEach(async () => {
    await Promise.all(startedServers.splice(0).map((server) => server.close()));
  });

  it("starts the reusable app server on a dynamic port", async () => {
    const server = await startCanvasBotServer({
      env: runtimeEnv(),
      port: 0,
      enableScheduler: false,
      publicDir: "public"
    });
    startedServers.push(server);

    const health = await fetch(`${server.url}/health`).then((response) => response.json());
    const home = await fetch(`${server.url}/index.html`).then((response) => response.text());

    expect(health).toEqual({ success: true, data: { status: "ok" } });
    expect(home).toContain("Canvas Workbench");
  });
});

function runtimeEnv() {
  return {
    CANVAS_BASE_URL: "https://school.instructure.com",
    CANVAS_ACCESS_TOKEN: undefined,
    CANVAS_CLIENT_ID: undefined,
    CANVAS_CLIENT_SECRET: undefined,
    CANVAS_REDIRECT_URI: undefined,
    OAUTH_STATE_SECRET: "test-cookie-secret-that-is-at-least-thirty-two",
    TOKEN_STORE_PATH: ".data/test-canvas-oauth-tokens.json",
    IMPORT_STORE_PATH: ".data/test-imported-canvas-snapshot.json",
    SYLLABUS_STORE_PATH: ".data/test-uploaded-syllabi.json",
    PORT: 0,
    DAILY_REPORT_CRON: "0 7 * * *",
    REPORT_CHANNEL: "console",
    REPORT_RECIPIENT_EMAIL: undefined,
    SMTP_HOST: undefined,
    SMTP_PORT: 587,
    SMTP_USER: undefined,
    SMTP_PASS: undefined,
    SMTP_FROM: undefined,
    ALLOWED_ORIGINS: "http://localhost:3000,http://127.0.0.1:3000",
    RATE_LIMIT_WINDOW_MS: 60_000,
    RATE_LIMIT_MAX_REQUESTS: 120
  } as const;
}
