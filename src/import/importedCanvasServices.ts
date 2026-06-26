import { ApiError } from "../lib/apiError.js";
import { htmlToText, truncateText } from "../lib/html.js";
import type { AssignmentInstructions, DoItForMeSupport } from "../services/assignmentSupportService.js";
import { buildAssignmentTasks, buildDailyReport, type DailyReport } from "../services/taskPlanner.js";
import type { ImportedCanvasStore } from "./importedCanvasStore.js";
import { toCanvasMaps } from "./importedCanvasStore.js";

export class ImportedCanvasTaskService {
  constructor(private readonly store: ImportedCanvasStore) {}

  async loadSnapshot() {
    const snapshot = await this.requireSnapshot();
    return toCanvasMaps(snapshot);
  }

  async listTasks(now = new Date()) {
    const snapshot = await this.loadSnapshot();
    return buildAssignmentTasks(snapshot.courses, snapshot.assignmentsByCourse, now);
  }

  async buildDailyReport(now = new Date()): Promise<DailyReport> {
    const snapshot = await this.loadSnapshot();
    return buildDailyReport(snapshot.courses, snapshot.assignmentsByCourse, { now });
  }

  private async requireSnapshot() {
    const snapshot = await this.store.get();
    if (!snapshot) {
      throw new ApiError(401, "Run no-admin Canvas sync before using this feature.", "CANVAS_IMPORT_REQUIRED");
    }
    return snapshot;
  }
}

export class ImportedAssignmentSupportService {
  constructor(private readonly store: ImportedCanvasStore) {}

  async getInstructions(courseId: number, assignmentId: number): Promise<AssignmentInstructions> {
    const snapshot = await this.store.get();
    if (!snapshot) {
      throw new ApiError(401, "Run no-admin Canvas sync before using this feature.", "CANVAS_IMPORT_REQUIRED");
    }

    const { courses, assignmentsByCourse } = toCanvasMaps(snapshot);
    const course = courses.find((item) => item.id === courseId);
    const assignment = assignmentsByCourse.get(courseId)?.find((item) => item.id === assignmentId);

    if (!course || !assignment) {
      throw new ApiError(404, "Imported assignment not found", "IMPORTED_ASSIGNMENT_NOT_FOUND");
    }

    const summary = truncateText(htmlToText(assignment.description), 900);
    return {
      assignmentId: assignment.id,
      courseId: course.id,
      title: assignment.name,
      courseName: course.name,
      dueAt: assignment.due_at ?? undefined,
      pointsPossible: assignment.points_possible,
      canvasUrl: assignment.html_url,
      submissionTypes: assignment.submission_types ?? [],
      summary,
      requirements: buildRequirements(summary, assignment.points_possible, assignment.submission_types),
      checklist: [
        "Open the Canvas assignment and confirm the prompt still matches this synced copy.",
        "Write the exact deliverables in your own words.",
        "Gather notes, readings, files, or lecture references needed to complete it.",
        "Create a first version before formatting or citations.",
        "Submit in Canvas and confirm the submitted status."
      ],
      suggestedWorkBlocks: [
        "15 minutes: confirm requirements.",
        "45 minutes: complete the first pass.",
        "15 minutes: check format and submit."
      ]
    };
  }

  async createDoItForMeSupport(courseId: number, assignmentId: number): Promise<DoItForMeSupport> {
    const instructions = await this.getInstructions(courseId, assignmentId);

    return {
      mode: "guided_support",
      academicIntegrityNotice:
        "This mode helps you understand, plan, outline, and draft your own work. It does not submit to Canvas or fabricate completed schoolwork for you.",
      instructions,
      outline: [
        `Goal: complete "${instructions.title}" for ${instructions.courseName}.`,
        "Inputs: Canvas prompt, rubric, class notes, readings, and any attached files.",
        "Main work: complete each requirement in order.",
        "Quality check: compare the draft to Canvas instructions.",
        "Submission: upload or enter the final work in Canvas."
      ],
      starterTemplate: [
        `Title: ${instructions.title}`,
        `Course: ${instructions.courseName}`,
        instructions.dueAt ? `Due: ${instructions.dueAt}` : "Due: not listed in Canvas",
        "",
        "My Plan",
        "- First step:",
        "- Materials I need:",
        "- Questions to clarify:",
        "- Final submission format:"
      ].join("\n"),
      nextBestAction: "Open the Canvas assignment and confirm the synced instructions are current."
    };
  }
}

function buildRequirements(
  summary: string,
  pointsPossible?: number | null,
  submissionTypes?: string[]
): string[] {
  const requirements = summary
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => /\b(submit|write|include|upload|answer|complete|read|cite|post)\b/i.test(sentence))
    .slice(0, 8);

  if (pointsPossible != null) requirements.unshift(`Worth ${pointsPossible} point(s).`);
  if (submissionTypes?.length) requirements.push(`Submission type: ${submissionTypes.join(", ")}.`);

  return requirements.length > 0
    ? requirements
    : ["No explicit requirements were found in the synced Canvas description."];
}
