/**
 * Per-child prompt scoping for the Phoenix prompt-management loop.
 *
 * Each child profile gets their own scene-prompt lineage
 * ("<base>--<child-slug>") so the reviewer's improvements for one child never
 * leak into another child's cartoons. New children inherit the shared
 * baseline ("<base>") until their first improved version is published.
 */

/** Lowercase, ascii-only, hyphenated slug (max 40 chars) of a child name. */
export function childSlug(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/** Resolve the prompt name for a child; falls back to the base name. */
export function childScopedPromptName(baseName: string, childName?: string | null): string {
  const slug = childName ? childSlug(childName) : "";
  return slug ? `${baseName}--${slug}` : baseName;
}
