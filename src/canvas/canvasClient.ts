import { CanvasApiError } from "../lib/apiError.js";
import type { CanvasAssignment, CanvasCourse } from "./types.js";

type FetchLike = typeof fetch;

export interface CanvasClientOptions {
  baseUrl: string;
  accessToken?: string;
  accessTokenProvider?: () => Promise<string>;
  fetchImpl?: FetchLike;
}

export class CanvasClient {
  private readonly baseUrl: string;
  private readonly accessToken?: string;
  private readonly accessTokenProvider?: () => Promise<string>;
  private readonly fetchImpl: FetchLike;

  constructor(options: CanvasClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.accessToken = options.accessToken;
    this.accessTokenProvider = options.accessTokenProvider;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async listActiveCourses(): Promise<CanvasCourse[]> {
    return this.getPaginated<CanvasCourse>("/api/v1/courses", {
      enrollment_state: "active",
      include: ["syllabus_body", "term", "favorites"],
      per_page: "100"
    });
  }

  async listCourseAssignments(courseId: number): Promise<CanvasAssignment[]> {
    const assignments = await this.getPaginated<CanvasAssignment>(
      `/api/v1/courses/${courseId}/assignments`,
      {
        include: ["submission", "all_dates"],
        order_by: "due_at",
        per_page: "100"
      }
    );

    return assignments.map((assignment) => ({ ...assignment, course_id: courseId }));
  }

  async getAssignment(courseId: number, assignmentId: number): Promise<CanvasAssignment> {
    const assignment = await this.request<CanvasAssignment>(
      `/api/v1/courses/${courseId}/assignments/${assignmentId}`,
      {
        include: ["submission", "can_edit"],
        all_dates: "true"
      }
    );

    return { ...assignment, course_id: courseId };
  }

  private async getPaginated<T>(
    path: string,
    params: Record<string, string | string[]>
  ): Promise<T[]> {
    const results: T[] = [];
    let nextUrl: string | undefined = this.buildUrl(path, params);
    let pages = 0;

    while (nextUrl) {
      pages += 1;
      if (pages > 50) {
        throw new CanvasApiError(502, "Canvas pagination limit exceeded");
      }

      const response = await this.fetchJson<T[]>(nextUrl);
      results.push(...response.body);
      nextUrl = parseNextLink(response.headers.get("link"));
    }

    return results;
  }

  private async request<T>(
    path: string,
    params: Record<string, string | string[]>
  ): Promise<T> {
    const response = await this.fetchJson<T>(this.buildUrl(path, params));
    return response.body;
  }

  private async fetchJson<T>(url: string): Promise<{ body: T; headers: Headers }> {
    const accessToken = await this.getAccessToken();
    const response = await this.fetchImpl(url, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`
      }
    });

    if (!response.ok) {
      throw new CanvasApiError(
        response.status,
        `Canvas request failed with status ${response.status}`
      );
    }

    return {
      body: (await response.json()) as T,
      headers: response.headers
    };
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessTokenProvider) return this.accessTokenProvider();
    if (this.accessToken) return this.accessToken;
    throw new CanvasApiError(401, "Canvas is not connected");
  }

  private buildUrl(path: string, params: Record<string, string | string[]>): string {
    const url = new URL(path, this.baseUrl);

    for (const [key, value] of Object.entries(params)) {
      if (Array.isArray(value)) {
        for (const item of value) {
          url.searchParams.append(`${key}[]`, item);
        }
      } else {
        url.searchParams.set(key, value);
      }
    }

    return url.toString();
  }
}

function parseNextLink(linkHeader: string | null): string | undefined {
  if (!linkHeader) return undefined;

  const links = linkHeader.split(",");
  const next = links.find((link) => /rel="next"/.test(link));
  const match = next?.match(/<([^>]+)>/);

  return match?.[1];
}
