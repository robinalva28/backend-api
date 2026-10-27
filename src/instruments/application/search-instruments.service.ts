import { SearchInstrumentsError } from './errors/search-instruments.error.js';
import type {
  SearchInstrumentsInput,
  SearchInstrumentsOutput,
  SearchInstrumentsUseCase,
} from './ports/in/search-instruments.use-case.js';
import type { InstrumentSearchRepository } from './ports/out/instrument-search.repository.js';

export class SearchInstrumentsService implements SearchInstrumentsUseCase {
  constructor(private readonly repository: InstrumentSearchRepository) {}

  async execute(
    input: SearchInstrumentsInput,
  ): Promise<SearchInstrumentsOutput> {
    try {
      return await this.repository.searchByText(input.query);
    } catch (error) {
      throw new SearchInstrumentsError(error);
    }
  }
}
