import { htmlToText, truncateText } from "../lib/html.js";
import type { SyllabusTask } from "../services/syllabusExtractor.js";
import type { UploadedSyllabus } from "./uploadedSyllabusStore.js";

const taskWords = /\b(assignment|due|exam|quiz|project|paper|essay|lab|reading|read|portfolio|presentation|discussion)\b/i;
const datePattern =
  /\b(?:\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2})\b/i;

export function buildUploadedSyllabusMentions(syllabi: UploadedSyllabus[]): SyllabusTask[] {
  return syllabi.flatMap((syllabus) => {
    const sourceText = htmlToText(syllabus.text);
    if (!sourceText) return [];

    return sourceText
      .split(/(?<=[.!?])\s+|\n+/)
      .map((line) => line.trim())
      .filter((line) => line.length > 8 && taskWords.test(line))
      .slice(0, 12)
      .map((line, index) => ({
        id: `uploaded-syllabus-${syllabus.id}-${index}`,
        courseId: 0,
        courseName: syllabus.courseName ?? syllabus.title,
        text: `${syllabus.title}: ${truncateText(line, 220)}`,
        mentionedDate: line.match(datePattern)?.[0]
      }));
  });
}
