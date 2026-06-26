import { describe, expect, it } from "vitest";
import { formatDailyReport } from "../src/reporters/formatReport.js";
import type { AssignmentTask, DailyReport } from "../src/services/taskPlanner.js";

describe("formatDailyReport", () => {
  it("formats empty report sections", () => {
    const text = formatDailyReport(report({ dueToday: [] }));

    expect(text).toContain("Due Today\n- Nothing here.");
  });

  it("formats tasks and syllabus mentions", () => {
    const text = formatDailyReport(
      report({
        dueToday: [task()],
        syllabusMentions: [
          {
            id: "s-1",
            courseId: 1,
            courseName: "Biology",
            text: "Quiz on Friday",
            mentionedDate: "Friday"
          }
        ]
      })
    );

    expect(text).toContain("[high] Biology: Lab");
    expect(text).toContain("Syllabus Mentions");
    expect(text).toContain("Biology (Friday): Quiz on Friday");
  });
});

function report(overrides: Partial<DailyReport["sections"]>): DailyReport {
  return {
    generatedAt: "2026-06-25T00:00:00.000Z",
    reportDate: "2026-06-25T00:00:00.000Z",
    summary: {
      totalOpen: 1,
      overdue: 0,
      dueToday: overrides.dueToday?.length ?? 0,
      upcoming: 0,
      undated: 0
    },
    sections: {
      overdue: [],
      dueToday: [],
      upcoming: [],
      undated: [],
      completedToday: [],
      syllabusMentions: [],
      ...overrides
    }
  };
}

function task(): AssignmentTask {
  return {
    id: "1:2",
    assignmentId: 2,
    courseId: 1,
    courseName: "Biology",
    title: "Lab",
    details: "Submit lab notes.",
    dueAt: "2026-06-25T20:00:00+09:00",
    submissionTypes: ["online_upload"],
    status: "due_today",
    priority: "high",
    estimatedMinutes: 60,
    action: "Finish today."
  };
}
