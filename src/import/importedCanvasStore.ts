import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import type { CanvasAssignment, CanvasCourse } from "../canvas/types.js";

export const importedCanvasSnapshotSchema = z.object({
  source: z.literal("canvas-extension").default("canvas-extension"),
  syncedAt: z.string().datetime().default(() => new Date().toISOString()),
  canvasBaseUrl: z.string().url(),
  courses: z.array(
    z.object({
      id: z.number().int(),
      name: z.string().min(1),
      course_code: z.string().optional(),
      workflow_state: z.string().optional(),
      syllabus_body: z.string().nullable().optional(),
      html_url: z.string().optional()
    })
  ),
  assignmentsByCourse: z.record(
    z.string(),
    z.array(
      z.object({
        id: z.number().int(),
        course_id: z.number().int().optional(),
        name: z.string().min(1),
        description: z.string().nullable().optional(),
        due_at: z.string().nullable().optional(),
        lock_at: z.string().nullable().optional(),
        unlock_at: z.string().nullable().optional(),
        points_possible: z.number().nullable().optional(),
        html_url: z.string().optional(),
        submission_types: z.array(z.string()).optional(),
        has_submitted_submissions: z.boolean().optional(),
        submission: z
          .object({
            submitted_at: z.string().nullable().optional(),
            workflow_state: z.string().optional(),
            missing: z.boolean().optional(),
            late: z.boolean().optional(),
            score: z.number().nullable().optional(),
            attempt: z.number().nullable().optional()
          })
          .nullable()
          .optional()
      })
    )
  )
});

export type ImportedCanvasSnapshot = z.infer<typeof importedCanvasSnapshotSchema>;

export interface ImportedCanvasStore {
  get(): Promise<ImportedCanvasSnapshot | undefined>;
  set(snapshot: ImportedCanvasSnapshot): Promise<void>;
  clear(): Promise<void>;
}

export class MemoryImportedCanvasStore implements ImportedCanvasStore {
  private snapshot: ImportedCanvasSnapshot | undefined;

  async get(): Promise<ImportedCanvasSnapshot | undefined> {
    return this.snapshot;
  }

  async set(snapshot: ImportedCanvasSnapshot): Promise<void> {
    this.snapshot = snapshot;
  }

  async clear(): Promise<void> {
    this.snapshot = undefined;
  }
}

export class FileImportedCanvasStore implements ImportedCanvasStore {
  constructor(private readonly filePath: string) {}

  async get(): Promise<ImportedCanvasSnapshot | undefined> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      return importedCanvasSnapshotSchema.parse(JSON.parse(raw));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  async set(snapshot: ImportedCanvasSnapshot): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, `${JSON.stringify(snapshot, null, 2)}\n`, {
      mode: 0o600
    });
  }

  async clear(): Promise<void> {
    await rm(this.filePath, { force: true });
  }
}

export function toCanvasMaps(snapshot: ImportedCanvasSnapshot): {
  courses: CanvasCourse[];
  assignmentsByCourse: Map<number, CanvasAssignment[]>;
} {
  const assignmentsByCourse = new Map<number, CanvasAssignment[]>();

  for (const [courseId, assignments] of Object.entries(snapshot.assignmentsByCourse)) {
    const numericCourseId = Number.parseInt(courseId, 10);
    assignmentsByCourse.set(
      numericCourseId,
      assignments.map((assignment) => ({
        ...assignment,
        course_id: assignment.course_id ?? numericCourseId
      }))
    );
  }

  return {
    courses: snapshot.courses,
    assignmentsByCourse
  };
}
