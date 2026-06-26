import type { CanvasCourse } from "../canvas/types.js";
import { htmlToText, truncateText } from "../lib/html.js";

export interface SyllabusTask {
  id: string;
  courseId: number;
  courseName: string;
  text: string;
  mentionedDate?: string;
}

const taskWords = /\b(assignment|due|exam|quiz|project|paper|essay|lab|reading|read|presentation|discussion)\b/i;
const datePattern =
  /\b(?:\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2})\b/i;

export function extractSyllabusTasks(courses: CanvasCourse[]): SyllabusTask[] {
  return courses.flatMap((course) => {
    const text = htmlToText(course.syllabus_body);
    if (!text) return [];

    return text
      .split(/(?<=[.!?])\s+|\n+/)
      .map((line) => line.trim())
      .filter((line) => line.length > 10 && taskWords.test(line))
      .slice(0, 20)
      .map((line, index) => ({
        id: `syllabus-${course.id}-${index}`,
        courseId: course.id,
        courseName: course.name,
        text: truncateText(line, 240),
        mentionedDate: line.match(datePattern)?.[0]
      }));
  });
}
