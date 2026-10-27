import type { Instrument } from '../../../domain/instrument.js';

export interface SearchInstrumentsInput {
  readonly query: string;
}

export type SearchInstrumentsOutput = Instrument[];

export interface SearchInstrumentsUseCase {
  execute(input: SearchInstrumentsInput): Promise<SearchInstrumentsOutput>;
}
