import { describe, expect, it } from "vitest";
import type { CanvasAssignment, CanvasCourse } from "../src/canvas/types.js";
import { buildDailyReport } from "../src/services/taskPlanner.js";

const courses: CanvasCourse[] = [
  {
    id: 10,
    name: "English",
    syllabus_body: "<p>Essay due 6/27. Quiz on June 28.</p>"
  }
];

describe("taskPlanner", () => {
  it("categorizes assignments into daily report sections", () => {
    const now = new Date("2026-06-25T09:00:00+09:00");
    const assignments: CanvasAssignment[] = [
      assignment({ id: 1, name: "Late Paper", due_at: "2026-06-24T10:00:00+09:00" }),
      assignment({ id: 2, name: "Today Quiz", due_at: "2026-06-25T23:00:00+09:00" }),
      assignment({ id: 3, name: "Next Project", due_at: "2026-06-27T23:00:00+09:00" }),
      assignment({ id: 4, name: "Submitted Lab", due_at: "2026-06-25T18:00:00+09:00", submission: { submitted_at: "2026-06-25T08:00:00+09:00" } }),
      assignment({ id: 5, name: "Undated Reading", due_at: null })
    ];

    const report = buildDailyReport(courses, new Map([[10, assignments]]), { now });

    expect(report.summary).toMatchObject({
      totalOpen: 4,
      overdue: 1,
      dueToday: 1,
      upcoming: 1,
      undated: 1
    });
    expect(report.sections.overdue[0].title).toBe("Late Paper");
    expect(report.sections.dueToday[0].title).toBe("Today Quiz");
    expect(report.sections.completedToday[0].title).toBe("Submitted Lab");
    expect(report.sections.syllabusMentions).toHaveLength(2);
  });

  it("treats Canvas missing submissions as high priority recovery work", () => {
    const now = new Date("2026-06-25T09:00:00+09:00");
    const report = buildDailyReport(
      courses,
      new Map([
        [
          10,
          [
            assignment({
              id: 9,
              name: "Missing Discussion",
              due_at: "2026-06-23T20:00:00Z",
              submission: { missing: true }
            })
          ]
        ]
      ]),
      { now }
    );

    expect(report.sections.overdue[0]).toMatchObject({
      status: "missing",
      priority: "high"
    });
    expect(report.sections.overdue[0].action).toContain("Recover this first");
  });

  it("scores priority and effort across point ranges", () => {
    const now = new Date("2026-06-25T09:00:00+09:00");
    const report = buildDailyReport(
      courses,
      new Map([
        [
          10,
          [
            assignment({
              id: 11,
              name: "Major Project",
              due_at: "2026-07-10T20:00:00+09:00",
              points_possible: 90
            }),
            assignment({
              id: 12,
              name: "Medium Discussion",
              due_at: "2026-06-30T20:00:00+09:00",
              points_possible: 20
            }),
            assignment({
              id: 13,
              name: "Tiny Check",
              due_at: "2026-07-20T20:00:00+09:00",
              points_possible: 5
            })
          ]
        ]
      ]),
      { now, windowDays: 30 }
    );

    expect(report.sections.upcoming.map((task) => [task.title, task.priority])).toEqual([
      ["Medium Discussion", "medium"],
      ["Major Project", "high"],
      ["Tiny Check", "low"]
    ]);
    expect(report.sections.upcoming.find((task) => task.title === "Major Project")?.estimatedMinutes).toBeGreaterThan(100);
  });

  it("marks graded Canvas submissions as completed", () => {
    const report = buildDailyReport(
      courses,
      new Map([
        [
          10,
          [
            assignment({
              id: 14,
              name: "Graded Work",
              due_at: "2026-06-25T20:00:00+09:00",
              submission: { workflow_state: "graded", submitted_at: "2026-06-24T20:00:00+09:00" }
            })
          ]
        ]
      ]),
      { now: new Date("2026-06-25T09:00:00+09:00") }
    );

    expect(report.summary.totalOpen).toBe(0);
  });
});

function assignment(overrides: Partial<CanvasAssignment>): CanvasAssignment {
  return {
    id: 1,
    name: "Assignment",
    description: "<p>Submit a response and cite your sources.</p>",
    due_at: null,
    points_possible: 20,
    submission_types: ["online_text_entry"],
    ...overrides
  };
}
