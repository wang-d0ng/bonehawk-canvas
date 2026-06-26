import cron from "node-cron";
import type { Reporter } from "../reporters/reporter.js";
import type { CanvasTaskService } from "../services/canvasTaskService.js";

export function startDailyReportScheduler(
  cronExpression: string,
  taskService: CanvasTaskService,
  reporter: Reporter
) {
  return cron.schedule(cronExpression, async () => {
    try {
      const report = await taskService.buildDailyReport();
      await reporter.sendDailyReport(report);
    } catch (error) {
      console.error("Daily report failed", error);
    }
  });
}
