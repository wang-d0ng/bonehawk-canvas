import { z } from "zod";

const optionalEmailSchema = z
  .string()
  .trim()
  .transform((value) => (value.length === 0 ? undefined : value))
  .optional();

const optionalSecretSchema = z
  .preprocess(
    (value) => (typeof value === "string" && value.trim().length === 0 ? undefined : value),
    z.string().trim().min(1).optional()
  );

export const envSchema = z.object({
  CANVAS_BASE_URL: z.string().url(),
  CANVAS_ACCESS_TOKEN: optionalSecretSchema,
  CANVAS_CLIENT_ID: optionalSecretSchema,
  CANVAS_CLIENT_SECRET: optionalSecretSchema,
  CANVAS_REDIRECT_URI: z.preprocess(
    (value) => (typeof value === "string" && value.trim().length === 0 ? undefined : value),
    z.string().trim().url().optional()
  ),
  OAUTH_STATE_SECRET: optionalSecretSchema,
  TOKEN_STORE_PATH: z.string().default(".data/canvas-oauth-tokens.json"),
  IMPORT_STORE_PATH: z.string().default(".data/imported-canvas-snapshot.json"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DAILY_REPORT_CRON: z.string().default("0 7 * * *"),
  REPORT_CHANNEL: z.enum(["console", "email"]).default("console"),
  REPORT_RECIPIENT_EMAIL: optionalEmailSchema,
  SMTP_HOST: optionalEmailSchema,
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_USER: optionalEmailSchema,
  SMTP_PASS: optionalEmailSchema,
  SMTP_FROM: optionalEmailSchema,
  ALLOWED_ORIGINS: z.string().default("http://localhost:5173,http://localhost:3000"),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(120)
});

export type AppEnv = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  const parsed = envSchema.safeParse(source);

  if (!parsed.success) {
    const message = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration: ${message}`);
  }

  const env = parsed.data;

  if (env.OAUTH_STATE_SECRET && env.OAUTH_STATE_SECRET.length < 32) {
    throw new Error("OAUTH_STATE_SECRET must be at least 32 characters.");
  }

  if (env.REPORT_CHANNEL === "email") {
    const missing = [
      ["REPORT_RECIPIENT_EMAIL", env.REPORT_RECIPIENT_EMAIL],
      ["SMTP_HOST", env.SMTP_HOST],
      ["SMTP_USER", env.SMTP_USER],
      ["SMTP_PASS", env.SMTP_PASS],
      ["SMTP_FROM", env.SMTP_FROM]
    ]
      .filter(([, value]) => !value)
      .map(([key]) => key);

    if (missing.length > 0) {
      throw new Error(`Email reports require: ${missing.join(", ")}`);
    }
  }

  return env;
}
