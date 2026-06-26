import type { AppEnv } from "../config/env.js";
import { ConsoleReporter } from "./consoleReporter.js";
import { EmailReporter } from "./emailReporter.js";
import type { Reporter } from "./reporter.js";

export function createReporter(env: AppEnv): Reporter {
  if (env.REPORT_CHANNEL === "email") {
    return new EmailReporter(env);
  }

  return new ConsoleReporter();
}
