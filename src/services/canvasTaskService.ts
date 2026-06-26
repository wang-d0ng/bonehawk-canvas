import type { CanvasClient } from "../canvas/canvasClient.js";
import type { CanvasAssignment, CanvasCourse } from "../canvas/types.js";
import { ApiError } from "../lib/apiError.js";
import { buildAssignmentTasks, buildDailyReport, type DailyReport } from "./taskPlanner.js";

export interface CanvasSnapshot {
  courses: CanvasCourse[];
  assignmentsByCourse: Map<number, CanvasAssignment[]>;
}

export class CanvasTaskService {
  constructor(private readonly canvasClient: CanvasClient) {}

  async loadSnapshot(): Promise<CanvasSnapshot> {
    const courses = await this.canvasClient.listActiveCourses();
    const assignmentPairs = await Promise.all(
      courses.map(async (course) => [
        course.id,
        await this.canvasClient.listCourseAssignments(course.id)
      ] as const)
    );

    return {
      courses,
      assignmentsByCourse: new Map(assignmentPairs)
    };
  }

  async listTasks(now = new Date()) {
    const snapshot = await this.loadSnapshot();
    return buildAssignmentTasks(snapshot.courses, snapshot.assignmentsByCourse, now);
  }

  async buildDailyReport(now = new Date()): Promise<DailyReport> {
    const snapshot = await this.loadSnapshot();
    return buildDailyReport(snapshot.courses, snapshot.assignmentsByCourse, { now });
  }

  async findCourse(courseId: number): Promise<CanvasCourse> {
    const courses = await this.canvasClient.listActiveCourses();
    const course = courses.find((item) => item.id === courseId);

    if (!course) {
      throw new ApiError(404, "Course not found", "COURSE_NOT_FOUND");
    }

    return course;
  }
}
