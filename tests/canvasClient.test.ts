import { describe, expect, it, vi } from "vitest";
import { CanvasClient } from "../src/canvas/canvasClient.js";

describe("CanvasClient", () => {
  it("requests active courses with syllabus details and auth header", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(JSON.stringify([{ id: 1, name: "History", syllabus_body: "<p>Read chapter 1</p>" }]), {
        status: 200
      })
    );
    const client = new CanvasClient({
      baseUrl: "https://school.instructure.com",
      accessToken: "test-token-with-enough-length",
      fetchImpl: fetchImpl as unknown as typeof fetch
    });

    const courses = await client.listActiveCourses();
    const [url, init] = fetchImpl.mock.calls[0];

    expect(courses).toHaveLength(1);
    expect(url).toContain("/api/v1/courses");
    expect(url).toContain("enrollment_state=active");
    expect(url).toContain("include%5B%5D=syllabus_body");
    expect(((init ?? {}).headers as Record<string, string>).Authorization).toBe(
      "Bearer test-token-with-enough-length"
    );
  });

  it("follows Canvas pagination links", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ id: 1, name: "One" }]), {
          status: 200,
          headers: {
            Link: '<https://school.instructure.com/api/v1/courses?page=2>; rel="next"'
          }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ id: 2, name: "Two" }]), {
          status: 200
        })
      );

    const client = new CanvasClient({
      baseUrl: "https://school.instructure.com",
      accessToken: "test-token-with-enough-length",
      fetchImpl: fetchImpl as unknown as typeof fetch
    });

    const courses = await client.listActiveCourses();

    expect(courses.map((course) => course.name)).toEqual(["One", "Two"]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("reads course assignments and stamps course id", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(JSON.stringify([{ id: 5, name: "Quiz" }]), { status: 200 })
    );
    const client = new CanvasClient({
      baseUrl: "https://school.instructure.com",
      accessToken: "test-token-with-enough-length",
      fetchImpl: fetchImpl as unknown as typeof fetch
    });

    const assignments = await client.listCourseAssignments(12);
    const url = String(fetchImpl.mock.calls[0]?.[0]);

    expect(url).toContain("/api/v1/courses/12/assignments");
    expect(url).toContain("include%5B%5D=submission");
    expect(assignments[0]).toMatchObject({ id: 5, course_id: 12 });
  });

  it("reads one assignment with submission details", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(JSON.stringify({ id: 5, name: "Quiz" }), { status: 200 })
    );
    const client = new CanvasClient({
      baseUrl: "https://school.instructure.com",
      accessToken: "test-token-with-enough-length",
      fetchImpl: fetchImpl as unknown as typeof fetch
    });

    const assignment = await client.getAssignment(12, 5);
    const url = String(fetchImpl.mock.calls[0]?.[0]);

    expect(url).toContain("/api/v1/courses/12/assignments/5");
    expect(url).toContain("include%5B%5D=submission");
    expect(assignment).toMatchObject({ id: 5, course_id: 12 });
  });

  it("throws a generic Canvas error on failed requests", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ error: "secret details" }), { status: 401 })
    );
    const client = new CanvasClient({
      baseUrl: "https://school.instructure.com",
      accessToken: "test-token-with-enough-length",
      fetchImpl: fetchImpl as unknown as typeof fetch
    });

    await expect(client.listActiveCourses()).rejects.toThrow("Canvas request failed with status 401");
  });

  it("requires either a token or token provider", async () => {
    const client = new CanvasClient({
      baseUrl: "https://school.instructure.com"
    });

    await expect(client.listActiveCourses()).rejects.toThrow("Canvas is not connected");
  });
});
