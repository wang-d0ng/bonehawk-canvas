import { extname } from "node:path";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import { htmlToText } from "../lib/html.js";

export const MAX_SYLLABUS_FILE_BYTES = 10 * 1024 * 1024;

export interface SyllabusFileInput {
  buffer: Buffer;
  mimeType: string;
  originalName: string;
}

export class UnsupportedSyllabusFileError extends Error {}
export class EmptySyllabusFileError extends Error {}

const textExtensions = new Set([".txt", ".md", ".markdown", ".csv", ".rtf"]);
const htmlExtensions = new Set([".html", ".htm"]);

export async function extractTextFromSyllabusFile(file: SyllabusFileInput): Promise<string> {
  const extension = extname(file.originalName).toLowerCase();
  const text = await extractRawText(file, extension);
  const normalized = normalizeExtractedText(text);

  if (normalized.length === 0) {
    throw new EmptySyllabusFileError("No readable syllabus text found.");
  }

  return normalized;
}

export function titleFromSyllabusFileName(fileName: string): string {
  const withoutPath = fileName.split(/[\\/]/).pop() ?? "Uploaded syllabus";
  return withoutPath.replace(/\.[^.]+$/, "").trim() || "Uploaded syllabus";
}

async function extractRawText(file: SyllabusFileInput, extension: string): Promise<string> {
  if (extension === ".pdf" || file.mimeType === "application/pdf") {
    return extractPdfText(file.buffer);
  }

  if (
    extension === ".docx" ||
    file.mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    const result = await mammoth.extractRawText({ buffer: file.buffer });
    return result.value;
  }

  if (htmlExtensions.has(extension) || file.mimeType === "text/html") {
    return htmlToText(file.buffer.toString("utf8"));
  }

  if (textExtensions.has(extension) || file.mimeType.startsWith("text/")) {
    return file.buffer.toString("utf8");
  }

  throw new UnsupportedSyllabusFileError("Unsupported syllabus file type.");
}

async function extractPdfText(buffer: Buffer): Promise<string> {
  const parser = new PDFParse({
    data: new Uint8Array(buffer),
    disableFontFace: true,
    useSystemFonts: false
  });

  try {
    const result = await parser.getText();
    return result.text;
  } finally {
    await parser.destroy();
  }
}

function normalizeExtractedText(text: string): string {
  return text
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
