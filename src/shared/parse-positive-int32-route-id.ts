const MAX_INT32 = '2147483647';

/**
 * Parses a route identifier lexically before converting it to a number.
 * Only ASCII digits are accepted, leading zeroes are allowed and the value
 * must fit the positive INT range used by the database.
 */
export function parsePositiveInt32RouteId(value: unknown): number | null {
  if (typeof value !== 'string' || !/^[0-9]+$/.test(value)) {
    return null;
  }

  const normalized = value.replace(/^0+/, '');

  if (
    normalized.length === 0 ||
    normalized.length > MAX_INT32.length ||
    (normalized.length === MAX_INT32.length && normalized > MAX_INT32)
  ) {
    return null;
  }

  const parsed = Number(normalized);

  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}
