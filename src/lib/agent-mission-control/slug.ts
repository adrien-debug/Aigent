/**
 * Pure, dependency-free slug utilities for Agent Mission Control.
 *
 * Used by both the create-agent form (client-side slug derivation as the
 * user types a name) and authoring-writes (server-side id generation for
 * new records). Kept dependency-free and deterministic (no randomness, no
 * Date.now()) so both call sites produce identical output for identical
 * input and can be unit-tested trivially.
 */

/**
 * Convert an arbitrary string into a URL/id-safe slug.
 *
 * - Lowercases the input.
 * - Trims leading/trailing whitespace.
 * - Replaces any run of one or more non-alphanumeric characters with a
 *   single hyphen.
 * - Strips leading/trailing hyphens left over from the replacement.
 *
 * @example
 * slugify("  My Copilot!! v2  ") // "my-copilot-v2"
 * slugify("Ops_Assistant/Draft") // "ops-assistant-draft"
 */
export function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Build a deterministic id from a fixed prefix and a slug, e.g. for
 * generating `copilot-my-copilot` style ids without any randomness.
 *
 * @example
 * makeId("copilot", "my-copilot") // "copilot-my-copilot"
 */
export function makeId(prefix: string, slug: string): string {
  return `${prefix}-${slug}`;
}
