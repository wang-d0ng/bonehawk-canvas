import type { DailyReport } from "../services/taskPlanner.js";
import { formatDailyReport } from "./formatReport.js";
import type { Reporter } from "./reporter.js";

export class ConsoleReporter implements Reporter {
  async sendDailyReport(report: DailyReport): Promise<void> {
    console.log(formatDailyReport(report));
  }
}
