import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";
import { clearSessionCookie, clearStateCookie, readSessionCookie, readStateCookie, writeSessionCookie, writeStateCookie } from "../auth/cookies.js";
import type { CanvasOAuthService } from "../auth/canvasOAuthService.js";
import { CanvasClient } from "../canvas/canvasClient.js";
import type { CanvasAssignment } from "../canvas/types.js";
import type { AppEnv } from "../config/env.js";
import { ImportedAssignmentSupportService, ImportedCanvasTaskService } from "../import/importedCanvasServices.js";
import { importedCanvasSnapshotSchema, type ImportedCanvasStore } from "../import/importedCanvasStore.js";
import { ApiError } from "../lib/apiError.js";
import type { Reporter } from "../reporters/reporter.js";
import { AssignmentSupportService } from "../services/assignmentSupportService.js";
import { CanvasTaskService, type CanvasSnapshot } from "../services/canvasTaskService.js";
import { buildAssignmentTasks, buildDailyReport, type AssignmentTask, type DailyReport } from "../services/taskPlanner.js";
import { buildUploadedSyllabusMentions } from "../syllabi/uploadedSyllabusReferences.js";
import { uploadedSyllabusInputSchema, type UploadedSyllabusStore } from "../syllabi/uploadedSyllabusStore.js";
import { createRateLimiter } from "./rateLimiter.js";

export interface CreateAppOptions {
  env: Pick<
    AppEnv,
    | "ALLOWED_ORIGINS"
    | "RATE_LIMIT_WINDOW_MS"
    | "RATE_LIMIT_MAX_REQUESTS"
    | "CANVAS_BASE_URL"
    | "CANVAS_ACCESS_TOKEN"
    | "OAUTH_STATE_SECRET"
  >;
  taskService: CanvasTaskService;
  supportService: AssignmentSupportService;
  reporter: Reporter;
  importedCanvasStore?: ImportedCanvasStore;
  uploadedSyllabusStore?: UploadedSyllabusStore;
  authService?: CanvasOAuthService;
  now?: () => Date;
}

export function createApp(options: CreateAppOptions) {
  const app = express();
  const allowedOrigins = [
    ...options.env.ALLOWED_ORIGINS.split(",").map((origin) => origin.trim()),
    options.env.CANVAS_BASE_URL.replace(/\/+$/, "")
  ];
  const now = options.now ?? (() => new Date());

  app.use(helmet());
  app.use(express.static("public"));
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || allowedOrigins.includes(origin)) {
          callback(null, true);
          return;
        }

        callback(new ApiError(403, "Origin is not allowed", "CORS_FORBIDDEN"));
      }
    })
  );
  app.use(express.json({ limit: "5mb" }));
  app.use(
    createRateLimiter({
      windowMs: options.env.RATE_LIMIT_WINDOW_MS,
      maxRequests: options.env.RATE_LIMIT_MAX_REQUESTS
    })
  );

  app.get("/health", (_request, response) => {
    response.json({ success: true, data: { status: "ok" } });
  });

  app.get("/api/auth/status", asyncHandler(async (request, response) => {
    const sessionId = getSessionId(request, options);
    const connected = options.authService
      ? await options.authService.isConnected(sessionId)
      : Boolean(options.env.CANVAS_ACCESS_TOKEN);
    const importedSnapshot = await options.importedCanvasStore?.get();

    response.json({
      success: true,
      data: {
        connected,
        importConnected: Boolean(importedSnapshot),
        importedSyncedAt: importedSnapshot?.syncedAt,
        oauthConfigured: Boolean(options.authService?.isConfigured()),
        prototypeTokenEnabled: Boolean(options.env.CANVAS_ACCESS_TOKEN),
        canvasBaseUrl: options.env.CANVAS_BASE_URL,
        connectUrl: "/api/auth/canvas/start",
        importUrl: "/api/import/canvas-snapshot"
      }
    });
  }));

  app.get("/api/auth/canvas/start", asyncHandler(async (_request, response) => {
    if (!options.authService) {
      throw new ApiError(501, "Canvas OAuth is not configured.", "OAUTH_NOT_CONFIGURED");
    }

    const state = options.authService.createState();
    writeStateCookie(response, state, cookieConfig(options));
    response.redirect(options.authService.createAuthorizationUrl(state));
  }));

  app.get("/api/auth/canvas/callback", asyncHandler(async (request, response) => {
    if (!options.authService) {
      throw new ApiError(501, "Canvas OAuth is not configured.", "OAUTH_NOT_CONFIGURED");
    }

    const expectedState = readStateCookie(request, cookieConfig(options));
    const receivedState = firstQueryValue(request.query.state);
    const error = firstQueryValue(request.query.error);
    const code = firstQueryValue(request.query.code);
    clearStateCookie(response, cookieConfig(options));

    if (!expectedState || !receivedState || expectedState !== receivedState) {
      throw new ApiError(400, "Canvas OAuth state did not match.", "OAUTH_STATE_MISMATCH");
    }

    if (error) {
      throw new ApiError(400, "Canvas access was not approved.", "OAUTH_ACCESS_DENIED");
    }

    if (!code) {
      throw new ApiError(400, "Canvas OAuth callback did not include a code.", "OAUTH_CODE_MISSING");
    }

    const sessionId = options.authService.createSessionId();
    await options.authService.exchangeCode(sessionId, code);
    writeSessionCookie(response, sessionId, cookieConfig(options));
    response.redirect("/overview.html?connected=1");
  }));

  app.post("/api/auth/logout", asyncHandler(async (request, response) => {
    await options.authService?.disconnect(getSessionId(request, options));
    clearSessionCookie(response, cookieConfig(options));
    response.json({ success: true, data: { connected: false } });
  }));

  app.post("/api/import/canvas-snapshot", asyncHandler(async (request, response) => {
    if (!options.importedCanvasStore) {
      throw new ApiError(501, "Canvas import storage is not configured.", "IMPORT_NOT_CONFIGURED");
    }

    const snapshot = importedCanvasSnapshotSchema.parse(request.body);
    await options.importedCanvasStore.set(snapshot);
    response.json({
      success: true,
      data: {
        imported: true,
        syncedAt: snapshot.syncedAt,
        courses: snapshot.courses.length,
        assignments: Object.values(snapshot.assignmentsByCourse).reduce(
          (total, assignments) => total + assignments.length,
          0
        )
      }
    });
  }));

  app.delete("/api/import/canvas-snapshot", asyncHandler(async (_request, response) => {
    await options.importedCanvasStore?.clear();
    response.json({ success: true, data: { imported: false } });
  }));

  app.get("/api/courses", asyncHandler(async (request, response) => {
    const { taskService } = createRequestServices(request, options);
    const snapshot = await taskService.loadSnapshot();
    response.json({
      success: true,
      data: snapshot.courses.map((course) => ({
        id: course.id,
        name: course.name,
        courseCode: course.course_code,
        term: course.term
      }))
    });
  }));

  app.get("/api/tasks", asyncHandler(async (request, response) => {
    const { taskService } = createRequestServices(request, options);
    const focusedCourseIds = parseCourseIds(request.query.courseIds);
    if (!focusedCourseIds) {
      response.json({ success: true, data: visibleTasks(await taskService.listTasks(now())) });
      return;
    }

    const snapshot = filterSnapshotByCourseIds(await taskService.loadSnapshot(), focusedCourseIds);
    const tasks = visibleTasks(buildAssignmentTasks(snapshot.courses, snapshot.assignmentsByCourse, now()));
    response.json({ success: true, data: tasks });
  }));

  app.get("/api/report/daily", asyncHandler(async (request, response) => {
    const { taskService } = createRequestServices(request, options);
    const reportDate = parseReportDate(request.query.date, now());
    const focusedCourseIds = parseCourseIds(request.query.courseIds);
    let report: DailyReport;
    if (!focusedCourseIds) {
      report = await taskService.buildDailyReport(reportDate);
    } else {
      const snapshot = filterSnapshotByCourseIds(await taskService.loadSnapshot(), focusedCourseIds);
      report = buildDailyReportFromSnapshot(snapshot, reportDate);
    }

    response.json({ success: true, data: await withUploadedSyllabusMentions(report, options) });
  }));

  app.get("/api/dashboard", asyncHandler(async (request, response) => {
    const { taskService } = createRequestServices(request, options);
    const reportDate = parseReportDate(request.query.date, now());
    const focusedCourseIds = parseCourseIds(request.query.courseIds);
    const fullSnapshot = await taskService.loadSnapshot();
    const focusedSnapshot = filterSnapshotByCourseIds(fullSnapshot, focusedCourseIds);
    const report = await withUploadedSyllabusMentions(buildDailyReportFromSnapshot(focusedSnapshot, reportDate), options);
    const tasks = visibleTasks(buildAssignmentTasks(focusedSnapshot.courses, focusedSnapshot.assignmentsByCourse, reportDate));

    response.json({
      success: true,
      data: {
        generatedAt: report.generatedAt,
        focus: {
          courseIds: focusedCourseIds ?? fullSnapshot.courses.map((course) => course.id),
          allCoursesSelected: !focusedCourseIds
        },
        availableCourses: fullSnapshot.courses.map((course) => ({
          id: course.id,
          name: course.name,
          courseCode: course.course_code,
          term: course.term,
          focused: focusedCourseIds ? focusedCourseIds.includes(course.id) : true
        })),
        report,
        courseSummaries: buildCourseSummaries(focusedSnapshot.courses, tasks, report)
      }
    });
  }));

  app.get("/api/calendar", asyncHandler(async (request, response) => {
    const { taskService } = createRequestServices(request, options);
    const reportDate = parseReportDate(request.query.date, now());
    const focusedCourseIds = parseCourseIds(request.query.courseIds);
    const report = focusedCourseIds
      ? buildDailyReportFromSnapshot(
          filterSnapshotByCourseIds(await taskService.loadSnapshot(), focusedCourseIds),
          reportDate
        )
      : await taskService.buildDailyReport(reportDate);
    const reportWithUploads = await withUploadedSyllabusMentions(report, options);

    response.json({
      success: true,
      data: {
        generatedAt: reportWithUploads.generatedAt,
        reportDate: reportWithUploads.reportDate,
        events: buildCalendarEvents(reportWithUploads)
      }
    });
  }));

  app.get("/api/syllabi", asyncHandler(async (_request, response) => {
    response.json({ success: true, data: await listUploadedSyllabi(options) });
  }));

  app.post("/api/syllabi", asyncHandler(async (request, response) => {
    if (!options.uploadedSyllabusStore) {
      throw new ApiError(501, "Syllabus uploads are not configured.", "SYLLABUS_UPLOAD_NOT_CONFIGURED");
    }

    const parsed = uploadedSyllabusInputSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ApiError(400, "Add a title and syllabus text before uploading.", "INVALID_SYLLABUS");
    }

    response.json({ success: true, data: await options.uploadedSyllabusStore.add(parsed.data) });
  }));

  app.delete("/api/syllabi/:id", asyncHandler(async (request, response) => {
    if (!options.uploadedSyllabusStore) {
      throw new ApiError(501, "Syllabus uploads are not configured.", "SYLLABUS_UPLOAD_NOT_CONFIGURED");
    }

    const id = firstParam(request.params.id);
    if (!isUuid(id)) {
      throw new ApiError(400, "Syllabus id is invalid.", "INVALID_SYLLABUS_ID");
    }

    response.json({ success: true, data: { deleted: await options.uploadedSyllabusStore.remove(id) } });
  }));

  app.post("/api/report/daily/send", asyncHandler(async (request, response) => {
    const { taskService } = createRequestServices(request, options);
    const reportDate = parseReportDate(request.body?.date, now());
    const focusedCourseIds = parseCourseIds(request.body?.courseIds);
    const report = focusedCourseIds
      ? buildDailyReportFromSnapshot(
          filterSnapshotByCourseIds(await taskService.loadSnapshot(), focusedCourseIds),
          reportDate
        )
      : await taskService.buildDailyReport(reportDate);
    await options.reporter.sendDailyReport(await withUploadedSyllabusMentions(report, options));
    response.json({ success: true, data: { sent: true, reportDate: report.reportDate } });
  }));

  app.get("/api/assignments/:courseId/:assignmentId/instructions", asyncHandler(
    async (request, response) => {
      const { supportService } = createRequestServices(request, options);
      const { courseId, assignmentId } = parseAssignmentParams(request);
      const instructions = await supportService.getInstructions(courseId, assignmentId);
      response.json({ success: true, data: instructions });
    }
  ));

  app.post("/api/assignments/:courseId/:assignmentId/do-it-for-me", asyncHandler(
    async (request, response) => {
      const { supportService } = createRequestServices(request, options);
      const { courseId, assignmentId } = parseAssignmentParams(request);
      const support = await supportService.createDoItForMeSupport(courseId, assignmentId);
      response.json({ success: true, data: support });
    }
  ));

  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    if (isPayloadTooLarge(error)) {
      response.status(413).json({
        success: false,
        error: "Canvas sync snapshot is too large. Refresh Canvas and try syncing again.",
        code: "IMPORT_PAYLOAD_TOO_LARGE"
      });
      return;
    }

    if (error instanceof ApiError) {
      response.status(error.statusCode).json({
        success: false,
        error: error.message,
        code: error.code
      });
      return;
    }

    console.error("Unhandled API error", error);
    response.status(500).json({
      success: false,
      error: "Something went wrong. Please try again."
    });
  });

  return app;
}

function asyncHandler(
  handler: (request: Request, response: Response, next: NextFunction) => Promise<void>
) {
  return (request: Request, response: Response, next: NextFunction) => {
    handler(request, response, next).catch(next);
  };
}

function parseReportDate(value: unknown, fallback: Date): Date {
  if (typeof value !== "string" || value.trim().length === 0) return fallback;

  const parsed = new Date(`${value}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    throw new ApiError(400, "Invalid report date. Use YYYY-MM-DD.", "INVALID_DATE");
  }

  return parsed;
}

function parseCourseIds(value: unknown): number[] | undefined {
  if (value == null || value === "") return undefined;

  const values = Array.isArray(value) ? value : [value];
  const ids = values
    .flatMap((entry) => String(entry).split(","))
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => Number.parseInt(entry, 10));

  const invalid = ids.some((id) => !Number.isSafeInteger(id) || id < 1);
  const sourceHasInvalidToken = values
    .flatMap((entry) => String(entry).split(","))
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .some((entry) => !/^\d+$/.test(entry));

  if (invalid || sourceHasInvalidToken) {
    throw new ApiError(400, "Course ids must be comma-separated numbers.", "INVALID_COURSE_IDS");
  }

  return ids.length > 0 ? [...new Set(ids)] : undefined;
}

function filterSnapshotByCourseIds(snapshot: CanvasSnapshot, courseIds: number[] | undefined): CanvasSnapshot {
  if (!courseIds) return snapshot;

  const selected = new Set(courseIds);
  const courses = snapshot.courses.filter((course) => selected.has(course.id));
  const assignmentsByCourse = new Map<number, CanvasAssignment[]>();

  for (const course of courses) {
    assignmentsByCourse.set(course.id, snapshot.assignmentsByCourse.get(course.id) ?? []);
  }

  return { courses, assignmentsByCourse };
}

function buildDailyReportFromSnapshot(snapshot: CanvasSnapshot, reportDate: Date): DailyReport {
  return buildDailyReport(snapshot.courses, snapshot.assignmentsByCourse, { now: reportDate });
}

function buildCourseSummaries(
  courses: CanvasSnapshot["courses"],
  tasks: AssignmentTask[],
  report: DailyReport
) {
  return courses.map((course) => {
    const courseTasks = tasks.filter((task) => task.courseId === course.id);
    return {
      id: course.id,
      name: course.name,
      courseCode: course.course_code,
      term: course.term,
      totalTasks: courseTasks.length,
      openTasks: courseTasks.filter((task) => task.status !== "completed").length,
      dueToday: courseTasks.filter((task) => task.status === "due_today").length,
      overdue: courseTasks.filter((task) => task.status === "overdue" || task.status === "missing").length,
      upcoming: courseTasks.filter((task) => task.status === "upcoming").length,
      syllabusMentions: report.sections.syllabusMentions.filter((mention) => mention.courseId === course.id).length,
      focused: true
    };
  });
}

function visibleTasks<T extends { status?: string }>(tasks: T[]): T[] {
  return tasks.filter((task) => task.status !== "completed");
}

async function withUploadedSyllabusMentions(
  report: DailyReport,
  options: CreateAppOptions
): Promise<DailyReport> {
  const uploadedSyllabi = await listUploadedSyllabi(options);
  const uploadedMentions = buildUploadedSyllabusMentions(uploadedSyllabi);
  if (uploadedMentions.length === 0) return report;

  return {
    ...report,
    sections: {
      ...report.sections,
      syllabusMentions: [...report.sections.syllabusMentions, ...uploadedMentions]
    }
  };
}

async function listUploadedSyllabi(options: CreateAppOptions) {
  return options.uploadedSyllabusStore?.list() ?? [];
}

function buildCalendarEvents(report: DailyReport) {
  return [
    ...report.sections.overdue,
    ...report.sections.dueToday,
    ...report.sections.upcoming
  ]
    .filter((task) => task.dueAt)
    .map((task) => ({
      id: task.id,
      type: "assignment" as const,
      title: task.title,
      courseName: task.courseName,
      startsAt: task.dueAt,
      status: task.status,
      priority: task.priority,
      estimatedMinutes: task.estimatedMinutes,
      action: task.action,
      canvasUrl: task.canvasUrl
    }));
}

function parseAssignmentParams(request: Request): { courseId: number; assignmentId: number } {
  const courseParam = firstParam(request.params.courseId);
  const assignmentParam = firstParam(request.params.assignmentId);
  const courseId = Number.parseInt(courseParam, 10);
  const assignmentId = Number.parseInt(assignmentParam, 10);

  if (!Number.isInteger(courseId) || !Number.isInteger(assignmentId)) {
    throw new ApiError(400, "Course and assignment ids must be numbers.", "INVALID_ASSIGNMENT_PARAMS");
  }

  return { courseId, assignmentId };
}

function firstParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isPayloadTooLarge(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "type" in error &&
    (error as { type?: unknown }).type === "entity.too.large"
  );
}

function firstQueryValue(value: unknown): string | undefined {
  if (Array.isArray(value)) return typeof value[0] === "string" ? value[0] : undefined;
  return typeof value === "string" ? value : undefined;
}

function createRequestServices(request: Request, options: CreateAppOptions): {
  taskService: CanvasTaskService | ImportedCanvasTaskService;
  supportService: AssignmentSupportService | ImportedAssignmentSupportService;
} {
  if (!options.authService) {
    if (!options.env.CANVAS_ACCESS_TOKEN) {
      if (options.importedCanvasStore) {
        return {
          taskService: new ImportedCanvasTaskService(options.importedCanvasStore),
          supportService: new ImportedAssignmentSupportService(options.importedCanvasStore)
        };
      }

      throw new ApiError(401, "Run no-admin Canvas sync before using this feature.", "CANVAS_IMPORT_REQUIRED");
    }

    return {
      taskService: options.taskService,
      supportService: options.supportService
    };
  }

  const sessionId = getSessionId(request, options);
  if (!sessionId) {
    if (options.env.CANVAS_ACCESS_TOKEN) {
      return {
        taskService: options.taskService,
        supportService: options.supportService
      };
    }

    if (options.importedCanvasStore) {
      return {
        taskService: new ImportedCanvasTaskService(options.importedCanvasStore),
        supportService: new ImportedAssignmentSupportService(options.importedCanvasStore)
      };
    }

    throw new ApiError(401, "Connect Canvas before using this feature.", "CANVAS_NOT_CONNECTED");
  }

  const canvasClient = new CanvasClient({
    baseUrl: options.env.CANVAS_BASE_URL,
    accessTokenProvider: () => options.authService!.getUsableAccessToken(sessionId)
  });

  return {
    taskService: new CanvasTaskService(canvasClient),
    supportService: new AssignmentSupportService(canvasClient)
  };
}

function getSessionId(request: Request, options: CreateAppOptions): string | undefined {
  const config = cookieConfig(options);
  return config.secret ? readSessionCookie(request, config) : undefined;
}

function cookieConfig(options: CreateAppOptions) {
  return {
    secret: options.env.OAUTH_STATE_SECRET ?? "test-only-cookie-secret-that-is-long-enough",
    secure: false
  };
}
