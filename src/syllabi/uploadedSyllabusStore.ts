import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";

export const uploadedSyllabusInputSchema = z.object({
  title: z.string().trim().min(1).max(160),
  courseName: z.string().trim().min(1).max(160).optional(),
  text: z.string().trim().min(1).max(500_000)
});

export type UploadedSyllabusInput = z.infer<typeof uploadedSyllabusInputSchema>;

export interface UploadedSyllabus extends UploadedSyllabusInput {
  id: string;
  uploadedAt: string;
}

export interface UploadedSyllabusStore {
  list(): Promise<UploadedSyllabus[]>;
  add(input: UploadedSyllabusInput): Promise<UploadedSyllabus>;
  remove(id: string): Promise<boolean>;
}

export class MemoryUploadedSyllabusStore implements UploadedSyllabusStore {
  private syllabi: UploadedSyllabus[];

  constructor(initialSyllabi: UploadedSyllabus[] = []) {
    this.syllabi = [...initialSyllabi];
  }

  async list(): Promise<UploadedSyllabus[]> {
    return [...this.syllabi];
  }

  async add(input: UploadedSyllabusInput): Promise<UploadedSyllabus> {
    const syllabus = createUploadedSyllabus(input);
    this.syllabi = [...this.syllabi, syllabus];
    return syllabus;
  }

  async remove(id: string): Promise<boolean> {
    const next = this.syllabi.filter((syllabus) => syllabus.id !== id);
    const removed = next.length !== this.syllabi.length;
    this.syllabi = next;
    return removed;
  }
}

export class FileUploadedSyllabusStore implements UploadedSyllabusStore {
  constructor(private readonly filePath: string) {}

  async list(): Promise<UploadedSyllabus[]> {
    return this.readAll();
  }

  async add(input: UploadedSyllabusInput): Promise<UploadedSyllabus> {
    const syllabus = createUploadedSyllabus(input);
    const syllabi = await this.readAll();
    await this.writeAll([...syllabi, syllabus]);
    return syllabus;
  }

  async remove(id: string): Promise<boolean> {
    const syllabi = await this.readAll();
    const next = syllabi.filter((syllabus) => syllabus.id !== id);
    if (next.length === syllabi.length) return false;

    await this.writeAll(next);
    return true;
  }

  private async readAll(): Promise<UploadedSyllabus[]> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = z.array(uploadedSyllabusSchema).parse(JSON.parse(raw));
      return parsed;
    } catch (error) {
      if (isMissingFile(error)) return [];
      throw error;
    }
  }

  private async writeAll(syllabi: UploadedSyllabus[]): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, `${JSON.stringify(syllabi, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600
    });
  }
}

const uploadedSyllabusSchema = uploadedSyllabusInputSchema.extend({
  id: z.string().uuid(),
  uploadedAt: z.string().datetime()
});

function createUploadedSyllabus(input: UploadedSyllabusInput): UploadedSyllabus {
  return {
    id: randomUUID(),
    uploadedAt: new Date().toISOString(),
    title: input.title,
    courseName: input.courseName,
    text: input.text
  };
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}
