import { describe, expect, it } from "vitest";
import type { CanvasAssignment, CanvasCourse } from "../src/canvas/types.js";
import { ApiError } from "../src/lib/apiError.js";
import { CanvasTaskService } from "../src/services/canvasTaskService.js";

describe("CanvasTaskService", () => {
  it("loads courses and assignments into a snapshot", async () => {
    const service = new CanvasTaskService(client());

    const snapshot = await service.loadSnapshot();

    expect(snapshot.courses).toHaveLength(1);
    expect(snapshot.assignmentsByCourse.get(1)?.[0].name).toBe("Lab");
  });

  it("finds a course by id", async () => {
    const service = new CanvasTaskService(client());

    await expect(service.findCourse(1)).resolves.toMatchObject({ name: "Biology" });
  });

  it("throws a not found error for missing courses", async () => {
    const service = new CanvasTaskService(client());

    await expect(service.findCourse(99)).rejects.toBeInstanceOf(ApiError);
  });

  it("builds tasks from live snapshot data", async () => {
    const service = new CanvasTaskService(client());

    const tasks = await service.listTasks(new Date("2026-06-25T09:00:00+09:00"));

    expect(tasks[0]).toMatchObject({
      title: "Lab",
      courseName: "Biology",
      status: "due_today"
    });
  });
});

function client() {
  const course: CanvasCourse = { id: 1, name: "Biology" };
  const assignment: CanvasAssignment = {
    id: 2,
    name: "Lab",
    description: "<p>Submit lab notes.</p>",
    due_at: "2026-06-25T20:00:00+09:00",
    submission_types: ["online_upload"]
  };

  return {
    listActiveCourses: async () => [course],
    listCourseAssignments: async () => [assignment]
  } as never;
}
