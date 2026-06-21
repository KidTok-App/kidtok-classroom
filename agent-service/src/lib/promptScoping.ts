/**
 * Per-child prompt scoping for the Phoenix prompt-management loop.
 *
 * Each child profile gets their own scene-prompt lineage
 * ("<base>--<child-slug>") so the reviewer's improvements for one child never
 * leak into another child's cartoons. New children inherit the shared
 * baseline ("<base>") until their first improved version is published.
 */

/** Lowercase, ascii-only, hyphenated slug (max 40 chars) of a name. */
export function toSlug(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export function childSlug(name: string): string {
  return toSlug(name);
}

/** Resolve the prompt name for a parent-child pair; falls back to the base name. */
export function childScopedPromptName(
  baseName: string,
  childName?: string | null,
  userId?: string | null
): string {
  const userSlug = userId ? toSlug(userId) : "";
  const kidSlug = childName ? toSlug(childName) : "";

  if (userSlug && kidSlug) {
    return `${baseName}--${userSlug}--${kidSlug}`;
  } else if (kidSlug) {
    return `${baseName}--${kidSlug}`;
  } else if (userSlug) {
    return `${baseName}--${userSlug}`;
  }
  return baseName;
}

