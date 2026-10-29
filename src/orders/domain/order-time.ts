/**
 * Formats a date as the UTC calendar used by the existing `orders.datetime`
 * `TIMESTAMP` column: `YYYY-MM-DDTHH:mm:ss[.fraction]`, without a zone suffix.
 * Timestamps already stored by the seed are not reinterpreted.
 */
export function formatUtcTimestamp(date: Date): string {
  const iso = date.toISOString();

  return iso.endsWith('Z') ? iso.slice(0, -1) : iso;
}
