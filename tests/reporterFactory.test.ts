import { describe, expect, it, vi } from "vitest";
import { createReporter } from "../src/reporters/createReporter.js";
import { ConsoleReporter } from "../src/reporters/consoleReporter.js";
import { EmailReporter } from "../src/reporters/emailReporter.js";

describe("createReporter", () => {
  it("creates console reporters by default", () => {
    expect(createReporter(env({ REPORT_CHANNEL: "console" }))).toBeInstanceOf(ConsoleReporter);
  });

  it("creates email reporters when configured", () => {
    expect(createReporter(env({ REPORT_CHANNEL: "email" }))).toBeInstanceOf(EmailReporter);
  });
});

describe("ConsoleReporter", () => {
  it("prints formatted reports", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await new ConsoleReporter().sendDailyReport({
      generatedAt: "2026-06-25T00:00:00.000Z",
      reportDate: "2026-06-25T00:00:00.000Z",
      summary: {
        totalOpen: 0,
        overdue: 0,
        dueToday: 0,
        upcoming: 0,
        undated: 0
      },
      sections: {
        overdue: [],
        dueToday: [],
        upcoming: [],
        undated: [],
        completedToday: [],
        syllabusMentions: []
      }
    });

    expect(spy).toHaveBeenCalledWith(expect.stringContaining("Canvas Daily Report"));
    spy.mockRestore();
  });
});

function env(overrides: Record<string, string>) {
  return {
    CANVAS_BASE_URL: "https://school.instructure.com",
    CANVAS_ACCESS_TOKEN: "token-with-enough-length",
    PORT: 3000,
    DAILY_REPORT_CRON: "0 7 * * *",
    REPORT_CHANNEL: "console",
    SMTP_PORT: 587,
    ALLOWED_ORIGINS: "http://localhost:5173",
    RATE_LIMIT_WINDOW_MS: 60_000,
    RATE_LIMIT_MAX_REQUESTS: 120,
    REPORT_RECIPIENT_EMAIL: "student@example.com",
    SMTP_HOST: "smtp.example.com",
    SMTP_USER: "user",
    SMTP_PASS: "pass",
    SMTP_FROM: "bot@example.com",
    ...overrides
  } as never;
}
