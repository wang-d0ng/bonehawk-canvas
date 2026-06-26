import type { CanvasClient } from "../canvas/canvasClient.js";
import type { CanvasAssignment, CanvasCourse } from "../canvas/types.js";
import { htmlToText, truncateText } from "../lib/html.js";
import { CanvasTaskService } from "./canvasTaskService.js";

export interface AssignmentInstructions {
  assignmentId: number;
  courseId: number;
  title: string;
  courseName: string;
  dueAt?: string;
  pointsPossible?: number | null;
  canvasUrl?: string;
  submissionTypes: string[];
  summary: string;
  requirements: string[];
  checklist: string[];
  suggestedWorkBlocks: string[];
}

export interface DoItForMeSupport {
  mode: "guided_support";
  academicIntegrityNotice: string;
  instructions: AssignmentInstructions;
  outline: string[];
  starterTemplate: string;
  nextBestAction: string;
}

export class AssignmentSupportService {
  private readonly taskService: CanvasTaskService;

  constructor(private readonly canvasClient: CanvasClient) {
    this.taskService = new CanvasTaskService(canvasClient);
  }

  async getInstructions(courseId: number, assignmentId: number): Promise<AssignmentInstructions> {
    const [course, assignment] = await Promise.all([
      this.taskService.findCourse(courseId),
      this.canvasClient.getAssignment(courseId, assignmentId)
    ]);

    return buildInstructions(course, assignment);
  }

  async createDoItForMeSupport(
    courseId: number,
    assignmentId: number
  ): Promise<DoItForMeSupport> {
    const instructions = await this.getInstructions(courseId, assignmentId);

    return {
      mode: "guided_support",
      academicIntegrityNotice:
        "This mode helps you understand, plan, outline, and draft your own work. It does not submit to Canvas or fabricate completed schoolwork for you.",
      instructions,
      outline: buildOutline(instructions),
      starterTemplate: buildStarterTemplate(instructions),
      nextBestAction: instructions.checklist[0] ?? "Open the assignment and identify the first concrete deliverable."
    };
  }
}

function buildInstructions(course: CanvasCourse, assignment: CanvasAssignment): AssignmentInstructions {
  const summary = truncateText(htmlToText(assignment.description), 900);
  const requirements = extractRequirements(summary, assignment);

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
    requirements,
    checklist: [
      "Read the assignment prompt and rubric from top to bottom.",
      "Write the exact deliverables in your own words.",
      "Gather source material, notes, files, or lecture references needed to complete it.",
      "Create a first version before polishing formatting or citations.",
      "Check submission type, file format, due time, and Canvas upload status."
    ],
    suggestedWorkBlocks: buildWorkBlocks(assignment)
  };
}

function extractRequirements(summary: string, assignment: CanvasAssignment): string[] {
  const sentences = summary
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  const requirementSentences = sentences.filter((sentence) =>
    /\b(submit|write|include|upload|answer|complete|read|cite|record|create|post)\b/i.test(sentence)
  );

  const requirements = requirementSentences.slice(0, 8);

  if (assignment.points_possible != null) {
    requirements.unshift(`Worth ${assignment.points_possible} point(s).`);
  }

  if (assignment.submission_types?.length) {
    requirements.push(`Submission type: ${assignment.submission_types.join(", ")}.`);
  }

  return requirements.length > 0 ? requirements : ["No explicit requirements were found in the Canvas description. Open Canvas and check attached rubrics or files."];
}

function buildWorkBlocks(assignment: CanvasAssignment): string[] {
  const isLarge = (assignment.points_possible ?? 0) >= 50;

  if (isLarge) {
    return [
      "25 minutes: break down the prompt and rubric.",
      "50 minutes: build the outline or solve the first section.",
      "50 minutes: complete the main work.",
      "25 minutes: revise, cite, export, and upload."
    ];
  }

  return [
    "15 minutes: identify what needs to be submitted.",
    "30 minutes: complete a first pass.",
    "15 minutes: check requirements and submit."
  ];
}

function buildOutline(instructions: AssignmentInstructions): string[] {
  return [
    `Goal: complete "${instructions.title}" for ${instructions.courseName}.`,
    "Inputs: assignment prompt, class notes, required readings, rubric, and any files attached in Canvas.",
    "Main work: answer each requirement one by one, keeping evidence or calculations close to the claim.",
    "Quality check: compare the finished work to the rubric and submission format.",
    "Submission: upload or enter the final work in Canvas, then confirm Canvas marks it as submitted."
  ];
}

function buildStarterTemplate(instructions: AssignmentInstructions): string {
  const requirements = instructions.requirements.map((item) => `- ${item}`).join("\n");

  return [
    `Title: ${instructions.title}`,
    `Course: ${instructions.courseName}`,
    instructions.dueAt ? `Due: ${instructions.dueAt}` : "Due: not listed in Canvas",
    "",
    "Requirements",
    requirements,
    "",
    "My Plan",
    "- First step:",
    "- Sources/materials I need:",
    "- Questions to clarify:",
    "- Final submission format:"
  ].join("\n");
}
