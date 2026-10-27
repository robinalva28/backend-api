import type { Instrument } from '../../../domain/instrument.js';

export interface InstrumentSearchRepository {
  searchByText(text: string): Promise<Instrument[]>;
}
