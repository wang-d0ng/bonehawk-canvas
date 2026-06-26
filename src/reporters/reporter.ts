import type { DailyReport } from "../services/taskPlanner.js";

export interface Reporter {
  sendDailyReport(report: DailyReport): Promise<void>;
}
