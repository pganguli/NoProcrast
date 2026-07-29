/**
 * Parses a user-entered optional integer. Returns undefined for blank or
 * unparseable input — meaning "inherit the default" for the override fields
 * that use this — otherwise the value clamped to the given minimum.
 * @param {string} raw
 * @param {number} min
 * @returns {number|undefined}
 */
export function parseOptionalInt(raw, min) {
  const trimmed = raw.trim();
  if (trimmed === '') { return undefined; }
  const val = parseInt(trimmed, 10);
  return isNaN(val) ? undefined : Math.max(min, val);
}
