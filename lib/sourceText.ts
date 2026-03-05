import { createHash } from "node:crypto";

export type SourceLine = {
  lineNo: number;
  content: string;
};

export function normalizeSourceText(text: string): string {
  const normalizedNewlines = text.replace(/\r\n?/g, "\n");
  return normalizedNewlines
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n");
}

export function hashSourceText(text: string): string {
  const normalized = normalizeSourceText(text);
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}

export function buildLineIndex(text: string): SourceLine[] {
  const normalized = normalizeSourceText(text);
  return normalized.split("\n").map((content, index) => ({
    lineNo: index + 1,
    content,
  }));
}
