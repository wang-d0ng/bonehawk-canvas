import type { CanvasAssignment, CanvasCourse } from "../canvas/types.js";
import { addDays, daysUntil, isSameLocalDay, startOfLocalDay } from "../lib/dateUtils.js";
import { htmlToText, truncateText } from "../lib/html.js";
import { extractSyllabusTasks, type SyllabusTask } from "./syllabusExtractor.js";

export type TaskStatus = "completed" | "missing" | "overdue" | "due_today" | "upcoming" | "undated";
export type TaskPriority = "high" | "medium" | "low";

export interface AssignmentTask {
  id: string;
  assignmentId: number;
  courseId: number;
  courseName: string;
  title: string;
  details: string;
  dueAt?: string;
  canvasUrl?: string;
  pointsPossible?: number | null;
  submissionTypes: string[];
  status: TaskStatus;
  priority: TaskPriority;
  estimatedMinutes: number;
  action: string;
}

export interface DailyReport {
  generatedAt: string;
  reportDate: string;
  summary: {
    totalOpen: number;
    dueToday: number;
    overdue: number;
    upcoming: number;
    undated: number;
  };
  sections: {
    overdue: AssignmentTask[];
    dueToday: AssignmentTask[];
    upcoming: AssignmentTask[];
    undated: AssignmentTask[];
    completedToday: AssignmentTask[];
    syllabusMentions: SyllabusTask[];
  };
}

export function buildAssignmentTasks(
  courses: CanvasCourse[],
  assignmentsByCourse: Map<number, CanvasAssignment[]>,
  now = new Date()
): AssignmentTask[] {
  return courses.flatMap((course) => {
    const assignments = assignmentsByCourse.get(course.id) ?? [];

    return assignments.map((assignment) => {
      const dueDate = assignment.due_at ? new Date(assignment.due_at) : undefined;
      const status = getTaskStatus(assignment, dueDate, now);
      const priority = getPriority(status, dueDate, now, assignment.points_possible);

      return {
        id: `${course.id}:${assignment.id}`,
        assignmentId: assignment.id,
        courseId: course.id,
        courseName: course.name,
        title: assignment.name,
        details: truncateText(htmlToText(assignment.description), 500),
        dueAt: assignment.due_at ?? undefined,
        canvasUrl: assignment.html_url,
        pointsPossible: assignment.points_possible,
        submissionTypes: assignment.submission_types ?? [],
        status,
        priority,
        estimatedMinutes: estimateMinutes(assignment, status),
        action: getRecommendedAction(status, dueDate, now)
      };
    });
  });
}

export function buildDailyReport(
  courses: CanvasCourse[],
  assignmentsByCourse: Map<number, CanvasAssignment[]>,
  options: { now?: Date; windowDays?: number } = {}
): DailyReport {
  const now = options.now ?? new Date();
  const windowDays = options.windowDays ?? 7;
  const tasks = buildAssignmentTasks(courses, assignmentsByCourse, now);
  const windowEnd = addDays(now, windowDays);

  const overdue = tasks.filter((task) => task.status === "overdue" || task.status === "missing");
  const dueToday = tasks.filter((task) => task.status === "due_today");
  const upcoming = tasks.filter((task) => {
    if (task.status !== "upcoming" || !task.dueAt) return false;
    const dueDate = new Date(task.dueAt);
    return dueDate <= windowEnd;
  });
  const undated = tasks.filter((task) => task.status === "undated");
  const completedToday = tasks.filter((task) => {
    const assignment = assignmentsByCourse
      .get(task.courseId)
      ?.find((item) => item.id === task.assignmentId);
    const submittedAt = assignment?.submission?.submitted_at;
    return task.status === "completed" && submittedAt
      ? isSameLocalDay(new Date(submittedAt), now)
      : false;
  });

  const sortByUrgency = (left: AssignmentTask, right: AssignmentTask): number => {
    const leftTime = left.dueAt ? new Date(left.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
    const rightTime = right.dueAt ? new Date(right.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
    return leftTime - rightTime || priorityRank(left.priority) - priorityRank(right.priority);
  };

  return {
    generatedAt: now.toISOString(),
    reportDate: startOfLocalDay(now).toISOString(),
    summary: {
      totalOpen: tasks.filter((task) => task.status !== "completed").length,
      dueToday: dueToday.length,
      overdue: overdue.length,
      upcoming: upcoming.length,
      undated: undated.length
    },
    sections: {
      overdue: sortTasks(overdue, sortByUrgency),
      dueToday: sortTasks(dueToday, sortByUrgency),
      upcoming: sortTasks(upcoming, sortByUrgency),
      undated: sortTasks(undated, sortByUrgency),
      completedToday: sortTasks(completedToday, sortByUrgency),
      syllabusMentions: extractSyllabusTasks(courses)
    }
  };
}

function sortTasks(
  tasks: AssignmentTask[],
  sorter: (left: AssignmentTask, right: AssignmentTask) => number
): AssignmentTask[] {
  return [...tasks].sort(sorter);
}

function getTaskStatus(
  assignment: CanvasAssignment,
  dueDate: Date | undefined,
  now: Date
): TaskStatus {
  if (isSubmitted(assignment)) return "completed";
  if (assignment.submission?.missing) return "missing";
  if (!dueDate) return "undated";
  if (isSameLocalDay(dueDate, now)) return "due_today";
  if (dueDate < now) return "overdue";
  return "upcoming";
}

function isSubmitted(assignment: CanvasAssignment): boolean {
  return Boolean(
    assignment.has_submitted_submissions ||
      assignment.submission?.submitted_at ||
      assignment.submission?.workflow_state === "submitted" ||
      assignment.submission?.workflow_state === "graded"
  );
}

function getPriority(
  status: TaskStatus,
  dueDate: Date | undefined,
  now: Date,
  pointsPossible?: number | null
): TaskPriority {
  if (status === "missing" || status === "overdue" || status === "due_today") return "high";
  if (!dueDate) return "low";
  const days = daysUntil(dueDate, now);
  if (days <= 2 || (pointsPossible ?? 0) >= 50) return "high";
  if (days <= 7 || (pointsPossible ?? 0) >= 20) return "medium";
  return "low";
}

function estimateMinutes(assignment: CanvasAssignment, status: TaskStatus): number {
  const descriptionLength = htmlToText(assignment.description).length;
  const points = assignment.points_possible ?? 0;
  const base = Math.max(20, Math.ceil(descriptionLength / 600) * 20);
  const pointWeight = points >= 80 ? 100 : points >= 40 ? 70 : points >= 15 ? 40 : 20;
  const urgency = status === "missing" || status === "overdue" ? 30 : 0;
  return Math.min(240, base + pointWeight + urgency);
}

function getRecommendedAction(status: TaskStatus, dueDate: Date | undefined, now: Date): string {
  if (status === "missing") return "Recover this first: open Canvas, confirm late policy, and submit the fastest acceptable version.";
  if (status === "overdue") return "Handle today: check instructions, contact instructor if needed, and submit before starting lower-priority work.";
  if (status === "due_today") return "Finish today: read the rubric, make a short plan, and leave time for upload or quiz submission.";
  if (status === "upcoming" && dueDate) {
    return `Start now: it is due in ${daysUntil(dueDate, now)} day(s), so block one focused work session.`;
  }
  if (status === "undated") return "Review details and add a personal deadline if this is still active.";
  return "No action needed.";
}

function priorityRank(priority: TaskPriority): number {
  if (priority === "high") return 0;
  if (priority === "medium") return 1;
  return 2;
}
