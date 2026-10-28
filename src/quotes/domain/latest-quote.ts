export interface LatestQuote {
  readonly id: number;
  readonly instrumentId: number;
  /** Calendar date in ISO `YYYY-MM-DD` form, without time or time zone. */
  readonly date: string;
  readonly close: string | null;
  readonly previousClose: string | null;
}
