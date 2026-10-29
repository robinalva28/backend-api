import { describe, expect, it, vi } from 'vitest';
import { PortfolioError } from '../../src/portfolio/application/errors/portfolio.error.js';
import { GetPortfolioService } from '../../src/portfolio/application/get-portfolio.service.js';
import type { PortfolioSnapshotRepository } from '../../src/portfolio/application/ports/out/portfolio-snapshot.repository.js';
import type { PortfolioMovement } from '../../src/portfolio/domain/portfolio-movement.js';
import type { PortfolioReadSnapshot } from '../../src/portfolio/domain/portfolio-read-snapshot.js';

function createService(): {
  service: GetPortfolioService;
  findByUserId: ReturnType<
    typeof vi.fn<PortfolioSnapshotRepository['findByUserId']>
  >;
} {
  const findByUserId = vi.fn<PortfolioSnapshotRepository['findByUserId']>();
  const repository: PortfolioSnapshotRepository = { findByUserId };

  return {
    service: new GetPortfolioService(repository),
    findByUserId,
  };
}

function validSnapshot(): PortfolioReadSnapshot {
  const movements: PortfolioMovement[] = [
    {
      id: 1,
      instrumentId: 66,
      side: 'CASH_IN',
      status: 'FILLED',
      size: 10_000,
      price: '1',
      type: 'MARKET',
      datetime: '2023-07-12 12:11:20.000001',
    },
    {
      id: 2,
      instrumentId: 47,
      side: 'BUY',
      status: 'FILLED',
      size: 10,
      price: '100',
      type: 'MARKET',
      datetime: '2023-07-12 12:31:20.000002',
    },
    {
      id: 3,
      instrumentId: 47,
      side: 'BUY',
      status: 'FILLED',
      size: 10,
      price: '200',
      type: 'LIMIT',
      datetime: '2023-07-12 12:41:20.000003',
    },
    {
      id: 4,
      instrumentId: 47,
      side: 'SELL',
      status: 'FILLED',
      size: 5,
      price: '180',
      type: 'MARKET',
      datetime: '2023-07-12 14:51:20.000004',
    },
  ];

  return {
    movements,
    instruments: [{ id: 47, ticker: 'PAMP', name: 'Pampa Holding S.A.' }],
    quotes: [
      {
        id: 1,
        instrumentId: 47,
        date: '2023-07-14',
        close: '180',
        previousClose: '175',
      },
    ],
  };
}

describe('GetPortfolioService', () => {
  it('reads one typed snapshot and returns the calculated contract', async () => {
    const { service, findByUserId } = createService();
    findByUserId.mockResolvedValue(validSnapshot());

    const portfolio = await service.execute({ userId: 7 });

    expect(findByUserId).toHaveBeenCalledTimes(1);
    expect(findByUserId).toHaveBeenCalledWith(7);
    expect(portfolio).toEqual({
      totalValue: '10600.00',
      availableCash: '7900.00',
      positions: [
        {
          instrumentId: 47,
          ticker: 'PAMP',
          name: 'Pampa Holding S.A.',
          quantity: 15,
          positionValue: '2700.00',
          totalReturnPercent: 20,
          dailyReturnPercent: 2.86,
        },
      ],
    });
  });

  it('distinguishes a missing user from an existing user without movements', async () => {
    const missing = createService();
    missing.findByUserId.mockResolvedValue(null);

    let missingError: unknown;

    try {
      await missing.service.execute({ userId: 1 });
    } catch (error) {
      missingError = error;
    }

    expect(missingError).toBeInstanceOf(PortfolioError);
    expect((missingError as PortfolioError).code).toBe('user-not-found');

    const empty = createService();
    empty.findByUserId.mockResolvedValue({
      movements: [],
      instruments: [],
      quotes: [],
    });

    await expect(empty.service.execute({ userId: 2 })).resolves.toEqual({
      totalValue: '0.00',
      availableCash: '0.00',
      positions: [],
    });
  });

  it('wraps snapshot read failures without returning zero values', async () => {
    const { service, findByUserId } = createService();
    const cause = new Error('read failure');
    findByUserId.mockRejectedValue(cause);

    let caught: unknown;

    try {
      await service.execute({ userId: 1 });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(PortfolioError);
    expect((caught as PortfolioError).code).toBe('read-failed');
    expect((caught as { cause?: unknown }).cause).toBe(cause);
  });

  it('wraps calculation failures without returning partial totals', async () => {
    const { service, findByUserId } = createService();
    findByUserId.mockResolvedValue({ ...validSnapshot(), quotes: [] });

    let caught: unknown;

    try {
      await service.execute({ userId: 1 });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(PortfolioError);
    expect((caught as PortfolioError).code).toBe('calculation-failed');
    expect((caught as { cause?: unknown }).cause).toBeDefined();
  });

  it('rejects an invalid account identifier before reading the snapshot', async () => {
    const { service, findByUserId } = createService();

    await expect(service.execute({ userId: 0 })).rejects.toMatchObject({
      name: 'PortfolioError',
      code: 'invalid-input',
    });
    expect(findByUserId).not.toHaveBeenCalled();
  });
});
