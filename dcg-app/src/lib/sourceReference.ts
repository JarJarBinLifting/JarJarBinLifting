import type { SourceReference } from "./types";

export const MIN_SOURCE_EXCERPT_LENGTH = 20;

export function sourceReferenceFrom(value: unknown): SourceReference | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  const extrait = typeof data.extrait === "string" ? data.extrait.trim() : "";
  if (!extrait) return null;
  const section = typeof data.section === "string" && data.section.trim() ? data.section.trim() : undefined;
  return { extrait, section };
}

export function hasUsableSourceReference(value: unknown): value is SourceReference {
  const reference = sourceReferenceFrom(value);
  return Boolean(reference && reference.extrait.length >= MIN_SOURCE_EXCERPT_LENGTH);
}
