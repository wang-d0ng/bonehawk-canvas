import { describe, expect, it } from "vitest";
import type { CanvasAssignment, CanvasCourse } from "../src/canvas/types.js";
import { AssignmentSupportService } from "../src/services/assignmentSupportService.js";

describe("AssignmentSupportService", () => {
  it("creates guided support without claiming to submit completed work", async () => {
    const service = new AssignmentSupportService({
      listActiveCourses: async () => [course()],
      getAssignment: async () => assignment(),
      listCourseAssignments: async () => [assignment()]
    } as never);

    const support = await service.createDoItForMeSupport(1, 2);

    expect(support.mode).toBe("guided_support");
    expect(support.academicIntegrityNotice).toContain("does not submit");
    expect(support.instructions.requirements).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Worth 50 point"),
        expect.stringContaining("Submit a thesis")
      ])
    );
    expect(support.starterTemplate).toContain("My Plan");
  });
});

function course(): CanvasCourse {
  return {
    id: 1,
    name: "Writing"
  };
}

function assignment(): CanvasAssignment {
  return {
    id: 2,
    name: "Essay",
    description: "<p>Submit a thesis-driven essay. Include three sources.</p>",
    due_at: "2026-06-26T23:59:00Z",
    points_possible: 50,
    submission_types: ["online_upload"],
    html_url: "https://school.instructure.com/courses/1/assignments/2"
  };
}
