import nodemailer from "nodemailer";
import type { AppEnv } from "../config/env.js";
import type { DailyReport } from "../services/taskPlanner.js";
import { formatDailyReport } from "./formatReport.js";
import type { Reporter } from "./reporter.js";

export class EmailReporter implements Reporter {
  private readonly transporter: nodemailer.Transporter;

  constructor(private readonly env: AppEnv) {
    this.transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      auth: {
        user: env.SMTP_USER,
        pass: env.SMTP_PASS
      }
    });
  }

  async sendDailyReport(report: DailyReport): Promise<void> {
    await this.transporter.sendMail({
      to: this.env.REPORT_RECIPIENT_EMAIL,
      from: this.env.SMTP_FROM,
      subject: `Canvas Daily Report - ${report.reportDate.slice(0, 10)}`,
      text: formatDailyReport(report)
    });
  }
}
