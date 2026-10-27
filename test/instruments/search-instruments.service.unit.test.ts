import { describe, expect, it, vi } from 'vitest';
import { SearchInstrumentsError } from '../../src/instruments/application/errors/search-instruments.error.js';
import type { InstrumentSearchRepository } from '../../src/instruments/application/ports/out/instrument-search.repository.js';
import { SearchInstrumentsService } from '../../src/instruments/application/search-instruments.service.js';
import type { Instrument } from '../../src/instruments/domain/instrument.js';

function createService(): {
  service: SearchInstrumentsService;
  searchByText: ReturnType<
    typeof vi.fn<InstrumentSearchRepository['searchByText']>
  >;
} {
  const searchByText = vi.fn<InstrumentSearchRepository['searchByText']>();
  const repository: InstrumentSearchRepository = { searchByText };

  return {
    service: new SearchInstrumentsService(repository),
    searchByText,
  };
}

describe('SearchInstrumentsService', () => {
  it('delegates the query to the output port and returns its result', async () => {
    const { service, searchByText } = createService();
    const instruments: Instrument[] = [
      { id: 47, ticker: 'PAMP', name: 'Pampa Holding S.A.' },
    ];
    searchByText.mockResolvedValue(instruments);

    await expect(service.execute({ query: 'PAMP' })).resolves.toBe(instruments);
    expect(searchByText).toHaveBeenCalledTimes(1);
    expect(searchByText).toHaveBeenCalledWith('PAMP');
  });

  it('returns an empty collection from the output port', async () => {
    const { service, searchByText } = createService();
    searchByText.mockResolvedValue([]);

    await expect(service.execute({ query: 'missing' })).resolves.toEqual([]);
  });

  it('wraps a repository failure in the application error and preserves its cause', async () => {
    const { service, searchByText } = createService();
    const cause = new Error('driver failure');
    searchByText.mockRejectedValue(cause);

    let caught: unknown;

    try {
      await service.execute({ query: 'PAMP' });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(SearchInstrumentsError);
    expect((caught as Error).message).toBe(
      'Instrument search could not be completed.',
    );
    expect((caught as { cause?: unknown }).cause).toBe(cause);
  });
});
