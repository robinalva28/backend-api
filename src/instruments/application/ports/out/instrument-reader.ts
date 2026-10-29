import type { InstrumentDetails } from '../../../domain/instrument-details.js';

/**
 * Minimal instrument read used by order submission. It does not search,
 * validate prices or expose persistence entities.
 */
export interface InstrumentReader {
  findById(instrumentId: number): Promise<InstrumentDetails | null>;
}
