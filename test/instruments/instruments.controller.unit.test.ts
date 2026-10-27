import { describe, expect, it, vi } from 'vitest';
import type { SearchInstrumentsUseCase } from '../../src/instruments/application/ports/in/search-instruments.use-case.js';
import type { Instrument } from '../../src/instruments/domain/instrument.js';
import { InstrumentsController } from '../../src/instruments/infrastructure/http/instruments.controller.js';

function createController(): {
  controller: InstrumentsController;
  execute: ReturnType<typeof vi.fn<SearchInstrumentsUseCase['execute']>>;
} {
  const execute = vi.fn<SearchInstrumentsUseCase['execute']>();
  const useCase: SearchInstrumentsUseCase = { execute };

  return {
    controller: new InstrumentsController(useCase),
    execute,
  };
}

describe('InstrumentsController', () => {
  it('delegates the validated query to the input port and returns its result', async () => {
    const { controller, execute } = createController();
    const instruments: Instrument[] = [
      { id: 47, ticker: 'PAMP', name: 'Pampa Holding S.A.' },
    ];
    execute.mockResolvedValue(instruments);

    await expect(controller.search({ query: 'PAMP' })).resolves.toBe(
      instruments,
    );
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith({ query: 'PAMP' });
  });

  it('returns an empty collection from the input port', async () => {
    const { controller, execute } = createController();
    execute.mockResolvedValue([]);

    await expect(controller.search({ query: 'missing' })).resolves.toEqual([]);
  });

  it('propagates an input-port failure without translating it', async () => {
    const { controller, execute } = createController();
    const failure = new Error('application failure');
    execute.mockRejectedValue(failure);

    await expect(controller.search({ query: 'PAMP' })).rejects.toBe(failure);
  });
});
