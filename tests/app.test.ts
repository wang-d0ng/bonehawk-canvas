import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/api/app.js";
import { CanvasOAuthService } from "../src/auth/canvasOAuthService.js";
import { MemoryTokenStore } from "../src/auth/tokenStore.js";
import { MemoryImportedCanvasStore, type ImportedCanvasSnapshot } from "../src/import/importedCanvasStore.js";
import type { Reporter } from "../src/reporters/reporter.js";
import { MemoryUploadedSyllabusStore } from "../src/syllabi/uploadedSyllabusStore.js";

describe("createApp", () => {
  it("returns health status", async () => {
    const app = createTestApp();

    const response = await request(app).get("/health").expect(200);

    expect(response.body).toEqual({ success: true, data: { status: "ok" } });
  });

  it("reports OAuth connection status", async () => {
    const app = createTestApp({
      authService: oauthService()
    });

    const response = await request(app).get("/api/auth/status").expect(200);

    expect(response.body.data).toMatchObject({
      connected: false,
      oauthConfigured: true,
      connectUrl: "/api/auth/canvas/start"
    });
  });

  it("starts the Canvas OAuth flow with an httpOnly state cookie", async () => {
    const app = createTestApp({
      authService: oauthService()
    });

    const response = await request(app).get("/api/auth/canvas/start").expect(302);

    expect(response.headers.location).toContain("https://school.instructure.com/login/oauth2/auth");
    expect(response.headers.location).toContain("response_type=code");
    expect(cookieHeader(response)).toContain("cw_oauth_state=");
    expect(cookieHeader(response)).toContain("HttpOnly");
  });

  it("rejects OAuth callbacks with mismatched state", async () => {
    const app = createTestApp({
      authService: oauthService()
    });

    const response = await request(app)
      .get("/api/auth/canvas/callback?state=bad&code=abc")
      .set("Cookie", "cw_oauth_state=bad-signature")
      .expect(400);

    expect(response.body.code).toBe("OAUTH_STATE_MISMATCH");
  });

  it("completes the Canvas OAuth callback and sets a session cookie", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(
        JSON.stringify({
          access_token: "access-token",
          refresh_token: "refresh-token",
          expires_in: 3600
        }),
        { status: 200 }
      )
    );
    const app = createTestApp({
      authService: oauthService(fetchImpl as unknown as typeof fetch)
    });
    const start = await request(app).get("/api/auth/canvas/start").expect(302);
    const state = new URL(start.headers.location).searchParams.get("state");

    const response = await request(app)
      .get(`/api/auth/canvas/callback?state=${state}&code=code-123`)
      .set("Cookie", requestCookies(start))
      .expect(302);

    expect(response.headers.location).toBe("/overview.html?connected=1");
    expect(cookieHeader(response)).toContain("cw_session=");
    expect(String(fetchImpl.mock.calls[0]?.[1]?.body)).toContain("code=code-123");
  });

  it("reports connected status after OAuth callback", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(
        JSON.stringify({
          access_token: "access-token",
          refresh_token: "refresh-token",
          expires_in: 3600
        }),
        { status: 200 }
      )
    );
    const app = createTestApp({
      authService: oauthService(fetchImpl as unknown as typeof fetch)
    });
    const start = await request(app).get("/api/auth/canvas/start").expect(302);
    const state = new URL(start.headers.location).searchParams.get("state");
    const callback = await request(app)
      .get(`/api/auth/canvas/callback?state=${state}&code=code-123`)
      .set("Cookie", requestCookies(start))
      .expect(302);

    const response = await request(app)
      .get("/api/auth/status")
      .set("Cookie", requestCookies(callback))
      .expect(200);

    expect(response.body.data.connected).toBe(true);
  });

  it("rejects OAuth callbacks denied by Canvas", async () => {
    const app = createTestApp({
      authService: oauthService()
    });
    const start = await request(app).get("/api/auth/canvas/start").expect(302);
    const state = new URL(start.headers.location).searchParams.get("state");

    const response = await request(app)
      .get(`/api/auth/canvas/callback?state=${state}&error=access_denied`)
      .set("Cookie", requestCookies(start))
      .expect(400);

    expect(response.body.code).toBe("OAUTH_ACCESS_DENIED");
  });

  it("rejects OAuth callbacks missing a code", async () => {
    const app = createTestApp({
      authService: oauthService()
    });
    const start = await request(app).get("/api/auth/canvas/start").expect(302);
    const state = new URL(start.headers.location).searchParams.get("state");

    const response = await request(app)
      .get(`/api/auth/canvas/callback?state=${state}`)
      .set("Cookie", requestCookies(start))
      .expect(400);

    expect(response.body.code).toBe("OAUTH_CODE_MISSING");
  });

  it("returns a clear error when OAuth start is not configured", async () => {
    const response = await request(createTestApp())
      .get("/api/auth/canvas/start")
      .expect(501);

    expect(response.body.code).toBe("OAUTH_NOT_CONFIGURED");
  });

  it("requires connection when OAuth is enabled without prototype token", async () => {
    const app = createTestApp({
      env: {
        ALLOWED_ORIGINS: "http://localhost:5173",
        RATE_LIMIT_WINDOW_MS: 60_000,
        RATE_LIMIT_MAX_REQUESTS: 100,
        CANVAS_BASE_URL: "https://school.instructure.com",
        OAUTH_STATE_SECRET: "test-cookie-secret-that-is-at-least-thirty-two"
      },
      authService: oauthService()
    });

    const response = await request(app).get("/api/tasks").expect(401);

    expect(response.body.code).toBe("CANVAS_NOT_CONNECTED");
  });

  it("imports a no-admin Canvas snapshot and serves tasks from it", async () => {
    const importedCanvasStore = new MemoryImportedCanvasStore();
    const app = createTestApp({
      env: {
        ALLOWED_ORIGINS: "http://localhost:5173",
        RATE_LIMIT_WINDOW_MS: 60_000,
        RATE_LIMIT_MAX_REQUESTS: 100,
        CANVAS_BASE_URL: "https://school.instructure.com",
        OAUTH_STATE_SECRET: "test-cookie-secret-that-is-at-least-thirty-two"
      },
      importedCanvasStore
    });

    await request(app)
      .post("/api/import/canvas-snapshot")
      .send(importSnapshot())
      .expect(200);

    const tasks = await request(app).get("/api/tasks").expect(200);
    const report = await request(app).get("/api/report/daily?date=2026-06-25").expect(200);

    expect(tasks.body.data[0]).toMatchObject({
      title: "Imported Lab",
      courseName: "Imported Biology"
    });
    expect(report.body.data.summary.dueToday).toBe(1);
  });

  it("hides completed imported assignments from task and dashboard surfaces", async () => {
    const importedCanvasStore = new MemoryImportedCanvasStore();
    await importedCanvasStore.set(importSnapshot({
      assignmentsByCourse: {
        "42": [
          {
            id: 100,
            course_id: 42,
            name: "Imported Lab",
            description: "<p>Submit a lab reflection.</p>",
            due_at: "2026-06-25T20:00:00+09:00",
            points_possible: 20,
            submission_types: ["online_upload"]
          },
          {
            id: 101,
            course_id: 42,
            name: "Completed Quiz",
            description: "<p>Already submitted.</p>",
            due_at: "2026-06-25T19:00:00+09:00",
            points_possible: 10,
            submission_types: ["online_quiz"],
            has_submitted_submissions: true,
            submission: {
              submitted_at: "2026-06-25T10:00:00+09:00",
              workflow_state: "submitted"
            }
          }
        ]
      }
    }));
    const app = createTestApp({
      env: {
        ALLOWED_ORIGINS: "http://localhost:5173",
        RATE_LIMIT_WINDOW_MS: 60_000,
        RATE_LIMIT_MAX_REQUESTS: 100,
        CANVAS_BASE_URL: "https://school.instructure.com",
        OAUTH_STATE_SECRET: "test-cookie-secret-that-is-at-least-thirty-two"
      },
      importedCanvasStore
    });

    const tasks = await request(app).get("/api/tasks").expect(200);
    const focusedTasks = await request(app).get("/api/tasks?courseIds=42").expect(200);
    const dashboard = await request(app).get("/api/dashboard?date=2026-06-25").expect(200);

    expect(tasks.body.data.map((task: { title: string }) => task.title)).toEqual(["Imported Lab"]);
    expect(focusedTasks.body.data.map((task: { title: string }) => task.title)).toEqual(["Imported Lab"]);
    expect(dashboard.body.data.courseSummaries[0]).toMatchObject({
      totalTasks: 1,
      openTasks: 1,
      dueToday: 1
    });
  });

  it("filters imported Canvas data to selected focus courses", async () => {
    const importedCanvasStore = new MemoryImportedCanvasStore();
    await importedCanvasStore.set(importSnapshot({
      courses: [
        {
          id: 42,
          name: "Imported Biology",
          syllabus_body: "<p>Lab portfolio due 6/30.</p>"
        },
        {
          id: 99,
          name: "Imported History",
          syllabus_body: "<p>Research presentation window opens soon.</p>"
        }
      ],
      assignmentsByCourse: {
        "42": [
          {
            id: 100,
            course_id: 42,
            name: "Imported Lab",
            description: "<p>Submit a lab reflection.</p>",
            due_at: "2026-06-25T20:00:00+09:00",
            points_possible: 20,
            submission_types: ["online_upload"]
          }
        ],
        "99": [
          {
            id: 200,
            course_id: 99,
            name: "History Essay",
            description: "<p>Write the essay.</p>",
            due_at: "2026-06-25T22:00:00+09:00",
            points_possible: 40,
            submission_types: ["online_text_entry"]
          }
        ]
      }
    }));
    const app = createTestApp({
      env: {
        ALLOWED_ORIGINS: "http://localhost:5173",
        RATE_LIMIT_WINDOW_MS: 60_000,
        RATE_LIMIT_MAX_REQUESTS: 100,
        CANVAS_BASE_URL: "https://school.instructure.com",
        OAUTH_STATE_SECRET: "test-cookie-secret-that-is-at-least-thirty-two"
      },
      importedCanvasStore
    });

    const tasks = await request(app).get("/api/tasks?courseIds=42").expect(200);
    const report = await request(app).get("/api/report/daily?date=2026-06-25&courseIds=42").expect(200);
    const dashboard = await request(app).get("/api/dashboard?date=2026-06-25&courseIds=42").expect(200);

    expect(tasks.body.data).toHaveLength(1);
    expect(tasks.body.data[0].courseName).toBe("Imported Biology");
    expect(report.body.data.summary.dueToday).toBe(1);
    expect(report.body.data.sections.dueToday.map((task: { courseName: string }) => task.courseName)).toEqual([
      "Imported Biology"
    ]);
    expect(dashboard.body.data.focus.courseIds).toEqual([42]);
    expect(dashboard.body.data.courseSummaries).toEqual([
      {
        id: 42,
        name: "Imported Biology",
        courseCode: undefined,
        term: undefined,
        totalTasks: 1,
        openTasks: 1,
        dueToday: 1,
        overdue: 0,
        upcoming: 0,
        syllabusMentions: 1,
        focused: true
      }
    ]);
  });

  it("rejects invalid focus course ids", async () => {
    const response = await request(createTestApp())
      .get("/api/report/daily?courseIds=1,nope")
      .expect(400);

    expect(response.body.code).toBe("INVALID_COURSE_IDS");
  });

  it("reports import connection status", async () => {
    const importedCanvasStore = new MemoryImportedCanvasStore();
    await importedCanvasStore.set(importSnapshot());

    const response = await request(createTestApp({ importedCanvasStore }))
      .get("/api/auth/status")
      .expect(200);

    expect(response.body.data.importConnected).toBe(true);
    expect(response.body.data.importedSyncedAt).toBe("2026-06-25T12:00:00.000Z");
  });

  it("reports setup health with synced Canvas and local syllabus counts", async () => {
    const importedCanvasStore = new MemoryImportedCanvasStore();
    const uploadedSyllabusStore = new MemoryUploadedSyllabusStore();
    await importedCanvasStore.set(importSnapshot());
    await uploadedSyllabusStore.add({
      title: "Biology syllabus",
      text: "Portfolio due 6/30."
    });

    const response = await request(createTestApp({ importedCanvasStore, uploadedSyllabusStore }))
      .get("/api/setup/health")
      .expect(200);

    expect(response.body.data).toMatchObject({
      status: "ready",
      importConnected: true,
      importedSyncedAt: "2026-06-25T12:00:00.000Z",
      canvasBaseUrl: "https://school.instructure.com",
      extension: {
        syncUrl: "http://localhost:3000/api/import/canvas-snapshot",
        guideUrl: "/extension/README.md"
      },
      snapshot: {
        courses: 1,
        assignments: 1,
        openAssignments: 1
      },
      localData: {
        hasImportedSnapshot: true,
        hasUploadedSyllabi: true,
        uploadedSyllabi: 1
      }
    });
    expect(response.body.data.nextSteps).toContain("Open Overview to review today's report.");
  });

  it("clears imported Canvas snapshots", async () => {
    const importedCanvasStore = new MemoryImportedCanvasStore();
    await importedCanvasStore.set(importSnapshot());

    await request(createTestApp({ importedCanvasStore }))
      .delete("/api/import/canvas-snapshot")
      .expect(200);

    await expect(importedCanvasStore.get()).resolves.toBeUndefined();
  });

  it("clears all local Canvas and syllabus data", async () => {
    const importedCanvasStore = new MemoryImportedCanvasStore();
    const uploadedSyllabusStore = new MemoryUploadedSyllabusStore();
    await importedCanvasStore.set(importSnapshot());
    await uploadedSyllabusStore.add({
      title: "Old syllabus",
      text: "Essay due 7/1."
    });

    const response = await request(createTestApp({ importedCanvasStore, uploadedSyllabusStore }))
      .delete("/api/local-data")
      .expect(200);

    expect(response.body.data).toEqual({
      connected: false,
      imported: false,
      uploadedSyllabi: 0
    });
    await expect(importedCanvasStore.get()).resolves.toBeUndefined();
    await expect(uploadedSyllabusStore.list()).resolves.toEqual([]);
  });

  it("disconnects the current Canvas session", async () => {
    const app = createTestApp({
      authService: oauthService()
    });

    const response = await request(app).post("/api/auth/logout").expect(200);

    expect(response.body.data.connected).toBe(false);
    expect(cookieHeader(response)).toContain("cw_session=");
  });

  it("serves the UI template", async () => {
    const app = createTestApp();

    const response = await request(app).get("/").expect(200);

    expect(response.text).toContain("Canvas Workbench");
    expect(response.text).toContain("canvas-workbench.js");
  });

  it("serves the bundled extension setup guide", async () => {
    const response = await request(createTestApp())
      .get("/extension/README.md")
      .expect(200);

    expect(response.text).toContain("Canvas Workbench Sync Extension");
  });

  it("serves daily reports in API envelope format", async () => {
    const app = createTestApp();

    const response = await request(app).get("/api/report/daily?date=2026-06-25").expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data.summary.dueToday).toBe(1);
  });

  it("serves homepage dashboard data from the daily report", async () => {
    const response = await request(createTestApp())
      .get("/api/dashboard?date=2026-06-25")
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data.report.summary.dueToday).toBe(1);
    expect(response.body.data.courseSummaries[0]).toMatchObject({
      id: 1,
      name: "Biology",
      totalTasks: 1,
      dueToday: 1
    });
  });

  it("serves calendar events from focused open Canvas work", async () => {
    const response = await request(createTestApp())
      .get("/api/calendar?date=2026-06-25")
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data.events).toEqual([
      expect.objectContaining({
        id: "1:3",
        title: "Field Notes",
        courseName: "Biology",
        startsAt: "2026-06-27T20:00:00.000Z",
        type: "assignment"
      })
    ]);
  });

  it("stores uploaded syllabi and folds them into daily reports", async () => {
    const uploadedSyllabusStore = new MemoryUploadedSyllabusStore();
    const app = createTestApp({ uploadedSyllabusStore });

    const upload = await request(app)
      .post("/api/syllabi")
      .send({
        title: "Biology syllabus",
        courseName: "Biology",
        text: "Final portfolio project due 6/30. Quiz review opens next week."
      })
      .expect(200);
    const list = await request(app).get("/api/syllabi").expect(200);
    const report = await request(app).get("/api/report/daily?date=2026-06-25").expect(200);

    expect(upload.body.data).toMatchObject({
      title: "Biology syllabus",
      courseName: "Biology"
    });
    expect(list.body.data).toHaveLength(1);
    expect(report.body.data.sections.syllabusMentions).toEqual([
      expect.objectContaining({
        id: `uploaded-syllabus-${upload.body.data.id}-0`,
        courseName: "Biology",
        text: "Biology syllabus: Final portfolio project due 6/30."
      }),
      expect.objectContaining({
        id: `uploaded-syllabus-${upload.body.data.id}-1`,
        courseName: "Biology",
        text: "Biology syllabus: Quiz review opens next week."
      })
    ]);
  });

  it("stores uploaded syllabus files through multipart upload", async () => {
    const uploadedSyllabusStore = new MemoryUploadedSyllabusStore();
    const app = createTestApp({ uploadedSyllabusStore });

    const upload = await request(app)
      .post("/api/syllabi/upload")
      .field("title", "History syllabus")
      .field("courseName", "History")
      .attach("file", Buffer.from("Research paper due 7/8. Midterm exam on July 10."), {
        filename: "history-syllabus.txt",
        contentType: "text/plain"
      })
      .expect(200);
    const report = await request(app).get("/api/report/daily?date=2026-06-25").expect(200);

    expect(upload.body.data).toMatchObject({
      title: "History syllabus",
      courseName: "History"
    });
    expect(report.body.data.sections.syllabusMentions).toEqual([
      expect.objectContaining({
        courseName: "History",
        text: "History syllabus: Research paper due 7/8."
      }),
      expect.objectContaining({
        courseName: "History",
        text: "History syllabus: Midterm exam on July 10."
      })
    ]);
  });

  it("rejects unsupported syllabus file uploads", async () => {
    const app = createTestApp({
      uploadedSyllabusStore: new MemoryUploadedSyllabusStore()
    });

    const response = await request(app)
      .post("/api/syllabi/upload")
      .field("title", "Bad file")
      .attach("file", Buffer.from("not a syllabus"), {
        filename: "syllabus.exe",
        contentType: "application/octet-stream"
      })
      .expect(400);

    expect(response.body.code).toBe("UNSUPPORTED_SYLLABUS_FILE");
  });

  it("rejects invalid uploaded syllabi", async () => {
    const app = createTestApp({
      uploadedSyllabusStore: new MemoryUploadedSyllabusStore()
    });

    const response = await request(app)
      .post("/api/syllabi")
      .send({ title: "", text: "" })
      .expect(400);

    expect(response.body.code).toBe("INVALID_SYLLABUS");
  });

  it("deletes uploaded syllabi", async () => {
    const uploadedSyllabusStore = new MemoryUploadedSyllabusStore();
    const app = createTestApp({ uploadedSyllabusStore });
    const upload = await request(app)
      .post("/api/syllabi")
      .send({ title: "Old syllabus", text: "Essay due 7/1." })
      .expect(200);

    await request(app).delete(`/api/syllabi/${upload.body.data.id}`).expect(200);

    const list = await request(app).get("/api/syllabi").expect(200);
    expect(list.body.data).toEqual([]);
  });

  it("lists courses without exposing credentials", async () => {
    const response = await request(createTestApp()).get("/api/courses").expect(200);

    expect(response.body.data[0]).toEqual({
      id: 1,
      name: "Biology"
    });
    expect(JSON.stringify(response.body)).not.toContain("token");
  });

  it("lists normalized tasks", async () => {
    const app = createTestApp({
      taskService: {
        loadSnapshot: async () => ({
          courses: [{ id: 1, name: "Biology" }],
          assignmentsByCourse: new Map()
        }),
        listTasks: async () => [{ id: "1:2", title: "Lab" }],
        buildDailyReport: async () => dailyReport()
      } as never
    });

    const response = await request(app).get("/api/tasks").expect(200);

    expect(response.body.data[0].title).toBe("Lab");
  });

  it("does not list completed normalized tasks", async () => {
    const app = createTestApp({
      taskService: {
        loadSnapshot: async () => ({
          courses: [{ id: 1, name: "Biology" }],
          assignmentsByCourse: new Map()
        }),
        listTasks: async () => [
          { id: "1:2", title: "Lab", status: "due_today" },
          { id: "1:3", title: "Submitted Quiz", status: "completed" }
        ],
        buildDailyReport: async () => dailyReport()
      } as never
    });

    const response = await request(app).get("/api/tasks").expect(200);

    expect(response.body.data.map((task: { title: string }) => task.title)).toEqual(["Lab"]);
  });

  it("sends the daily report through the configured reporter", async () => {
    const reporter: Reporter = { sendDailyReport: vi.fn(async () => undefined) };
    const app = createTestApp({ reporter });

    await request(app).post("/api/report/daily/send").send({ date: "2026-06-25" }).expect(200);

    expect(reporter.sendDailyReport).toHaveBeenCalledTimes(1);
  });

  it("validates assignment ids", async () => {
    const app = createTestApp();

    const response = await request(app)
      .get("/api/assignments/nope/2/instructions")
      .expect(400);

    expect(response.body.code).toBe("INVALID_ASSIGNMENT_PARAMS");
  });

  it("returns assignment instructions", async () => {
    const response = await request(createTestApp())
      .get("/api/assignments/1/2/instructions")
      .expect(200);

    expect(response.body.data.title).toBe("Lab");
  });

  it("returns guided support for the do-it-for-me endpoint", async () => {
    const response = await request(createTestApp())
      .post("/api/assignments/1/2/do-it-for-me")
      .expect(200);

    expect(response.body.data.mode).toBe("guided_support");
  });

  it("rejects invalid report dates", async () => {
    const response = await request(createTestApp())
      .get("/api/report/daily?date=not-a-date")
      .expect(400);

    expect(response.body.code).toBe("INVALID_DATE");
  });

  it("rejects disallowed CORS origins", async () => {
    const response = await request(createTestApp())
      .get("/health")
      .set("Origin", "http://not-allowed.local")
      .expect(403);

    expect(response.body.code).toBe("CORS_FORBIDDEN");
  });

  it("allows Canvas school origins for no-admin extension sync", async () => {
    const response = await request(createTestApp())
      .get("/health")
      .set("Origin", "https://templeu.instructure.com")
      .expect(200);

    expect(response.headers["access-control-allow-origin"]).toBe("https://templeu.instructure.com");
  });

  it("allows browser extension origins for no-admin extension sync", async () => {
    const response = await request(createTestApp())
      .get("/health")
      .set("Origin", "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
      .expect(200);

    expect(response.headers["access-control-allow-origin"]).toBe("chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  });

  it("returns a generic error for unexpected failures", async () => {
    const app = createTestApp({
      taskService: {
        loadSnapshot: async () => ({
          courses: [],
          assignmentsByCourse: new Map()
        }),
        listTasks: async () => {
          throw new Error("internal secret");
        },
        buildDailyReport: async () => dailyReport()
      } as never
    });

    const response = await request(app).get("/api/tasks").expect(500);

    expect(response.body.error).toBe("Something went wrong. Please try again.");
    expect(response.body.error).not.toContain("internal secret");
  });
});

function createTestApp(overrides: Partial<Parameters<typeof createApp>[0]> = {}) {
  return createApp({
    env: {
      ALLOWED_ORIGINS: "http://localhost:5173",
      RATE_LIMIT_WINDOW_MS: 60_000,
      RATE_LIMIT_MAX_REQUESTS: 100,
      CANVAS_BASE_URL: "https://school.instructure.com",
      CANVAS_ACCESS_TOKEN: "token-with-enough-length",
      OAUTH_STATE_SECRET: "test-cookie-secret-that-is-at-least-thirty-two"
    },
    taskService: {
      loadSnapshot: async () => ({
        courses: [{ id: 1, name: "Biology" }],
        assignmentsByCourse: new Map([
          [
            1,
            [
              {
                id: 2,
                course_id: 1,
                name: "Lab",
                description: "<p>Submit lab.</p>",
                due_at: "2026-06-25T20:00:00+09:00",
                points_possible: 20,
                submission_types: ["online_upload"]
              }
            ]
          ]
        ])
      }),
      listTasks: async () => [
        {
          id: "1:2",
          assignmentId: 2,
          courseId: 1,
          courseName: "Biology",
          title: "Lab",
          details: "Submit lab.",
          dueAt: "2026-06-25T20:00:00+09:00",
          pointsPossible: 20,
          submissionTypes: ["online_upload"],
          status: "due_today",
          priority: "high",
          estimatedMinutes: 40,
          action: "Finish today."
        }
      ],
      buildDailyReport: async () => dailyReport()
    } as never,
    supportService: {
      getInstructions: async () => ({
        assignmentId: 2,
        courseId: 1,
        title: "Lab",
        courseName: "Biology",
        submissionTypes: ["online_upload"],
        summary: "Submit lab.",
        requirements: ["Submit lab."],
        checklist: ["Read prompt."],
        suggestedWorkBlocks: ["30 minutes: complete."]
      }),
      createDoItForMeSupport: async () => ({
        mode: "guided_support",
        academicIntegrityNotice: "Guided support only.",
        instructions: {
          assignmentId: 2,
          courseId: 1,
          title: "Lab",
          courseName: "Biology",
          submissionTypes: ["online_upload"],
          summary: "Submit lab.",
          requirements: ["Submit lab."],
          checklist: ["Read prompt."],
          suggestedWorkBlocks: ["30 minutes: complete."]
        },
        outline: [],
        starterTemplate: "",
        nextBestAction: "Read prompt."
      })
    } as never,
    reporter: { sendDailyReport: vi.fn(async () => undefined) },
    now: () => new Date("2026-06-25T09:00:00"),
    ...overrides
  });
}

function oauthService(fetchImpl?: typeof fetch) {
  return new CanvasOAuthService(
    {
      canvasBaseUrl: "https://school.instructure.com",
      clientId: "client-id",
      clientSecret: "client-secret",
      redirectUri: "http://localhost:3000/api/auth/canvas/callback"
    },
    new MemoryTokenStore(),
    fetchImpl
  );
}

function importSnapshot(overrides: Partial<ImportedCanvasSnapshot> = {}): ImportedCanvasSnapshot {
  return {
    source: "canvas-extension",
    syncedAt: "2026-06-25T12:00:00.000Z",
    canvasBaseUrl: "https://school.instructure.com",
    courses: [
      {
        id: 42,
        name: "Imported Biology",
        syllabus_body: "<p>Lab portfolio due 6/30.</p>"
      }
    ],
    assignmentsByCourse: {
      "42": [
        {
          id: 100,
          course_id: 42,
          name: "Imported Lab",
          description: "<p>Submit a lab reflection.</p>",
          due_at: "2026-06-25T20:00:00+09:00",
          points_possible: 20,
          submission_types: ["online_upload"]
        }
      ]
    },
    ...overrides
  };
}

function dailyReport() {
  return {
    generatedAt: "2026-06-25T12:00:00.000Z",
    reportDate: "2026-06-25T00:00:00.000Z",
    summary: {
      totalOpen: 1,
      dueToday: 1,
      overdue: 0,
      upcoming: 0,
      undated: 0
    },
    sections: {
      overdue: [],
      dueToday: [],
      upcoming: [
        {
          id: "1:3",
          assignmentId: 3,
          courseId: 1,
          courseName: "Biology",
          title: "Field Notes",
          details: "Submit notes.",
          dueAt: "2026-06-27T20:00:00.000Z",
          submissionTypes: ["online_upload"],
          status: "upcoming",
          priority: "medium",
          estimatedMinutes: 40,
          action: "Start now."
        }
      ],
      undated: [],
      completedToday: [],
      syllabusMentions: []
    }
  };
}

function cookieHeader(response: request.Response): string {
  const header = response.headers["set-cookie"];
  return Array.isArray(header) ? header.join(" ") : String(header ?? "");
}

function requestCookies(response: request.Response): string {
  const header = response.headers["set-cookie"];
  const cookies = Array.isArray(header) ? header : [String(header ?? "")];
  return cookies.map((cookie) => cookie.split(";")[0]).join("; ");
}
