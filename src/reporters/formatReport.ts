import type { AssignmentTask, DailyReport } from "../services/taskPlanner.js";

export function formatDailyReport(report: DailyReport): string {
  const lines = [
    `Canvas Daily Report - ${report.reportDate.slice(0, 10)}`,
    "",
    `Open: ${report.summary.totalOpen} | Overdue: ${report.summary.overdue} | Due today: ${report.summary.dueToday} | Upcoming: ${report.summary.upcoming} | Undated: ${report.summary.undated}`,
    "",
    formatSection("Overdue / Missing", report.sections.overdue),
    formatSection("Due Today", report.sections.dueToday),
    formatSection("Upcoming", report.sections.upcoming),
    formatSection("Undated", report.sections.undated)
  ];

  if (report.sections.syllabusMentions.length > 0) {
    lines.push(
      "",
      "Syllabus Mentions",
      ...report.sections.syllabusMentions.slice(0, 10).map((item) => {
        const date = item.mentionedDate ? ` (${item.mentionedDate})` : "";
        return `- ${item.courseName}${date}: ${item.text}`;
      })
    );
  }

  return lines.join("\n");
}

function formatSection(title: string, tasks: AssignmentTask[]): string {
  if (tasks.length === 0) return `${title}\n- Nothing here.`;

  return [
    title,
    ...tasks.map((task) => {
      const due = task.dueAt ? ` due ${task.dueAt}` : "";
      return `- [${task.priority}] ${task.courseName}: ${task.title}${due}. ${task.action}`;
    })
  ].join("\n");
}
