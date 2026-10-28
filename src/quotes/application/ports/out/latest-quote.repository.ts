import type { LatestQuote } from '../../../domain/latest-quote.js';

export interface LatestQuoteRepository {
  findLatestByInstrumentId(instrumentId: number): Promise<LatestQuote | null>;
}
