/**
 * Scaffold Templating Helper
 *
 * Ported from agent-service/legacy-reference/scaffoldTemplating.ts (verbatim logic).
 * Lightweight `{token}` substitution used when rendering the scene-prompt
 * template fetched from Phoenix prompt management. Empty/unknown tokens are
 * replaced with an empty string so a partial template never crashes the
 * pipeline, and `assertNoUnresolvedTokens` fails loud-and-early when a
 * template uses a malformed token shape (e.g. `{age-style}`) that would
 * otherwise ship verbatim to the image model and silently degrade quality.
 */

export function applyScaffold(
  template: string,
  vars: Record<string, string | number | undefined | null>,
): string {
  return template.replace(/\{(\w+)\}/g, (_match, key: string) => {
    const v = vars[key];
    if (v === undefined || v === null) return "";
    return String(v);
  });
}

export class UnresolvedScaffoldTokenError extends Error {
  public readonly code = "UNRESOLVED_SCAFFOLD_TOKEN" as const;
  constructor(
    public readonly tokens: string[],
    public readonly site: string,
  ) {
    super(`Unresolved scaffold token(s) at ${site}: ${tokens.join(", ")}`);
    this.name = "UnresolvedScaffoldTokenError";
  }
}

// Catches hyphenated, dotted, mixedCase, or otherwise non-`\w` brace tokens
// that `applyScaffold`'s `\{(\w+)\}` regex skips over. Examples it detects:
//   {audio-clause}, {age.style}, {TODO}, {character description}
// Heuristic: a brace pair surrounding a token-like identifier with no
// surrounding whitespace and at least one alphabetic character.
const UNRESOLVED_TOKEN_RE = /\{(?=[^{}\s]*[A-Za-z])[^{}\s]+\}/g;

export function assertNoUnresolvedTokens(rendered: string, site: string): void {
  const matches = rendered.match(UNRESOLVED_TOKEN_RE);
  if (!matches || matches.length === 0) return;
  const unique = Array.from(new Set(matches));
  throw new UnresolvedScaffoldTokenError(unique, site);
}
