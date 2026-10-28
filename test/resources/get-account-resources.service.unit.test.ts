import { describe, expect, it, vi } from 'vitest';
import { AccountResourcesError } from '../../src/resources/application/errors/account-resources.error.js';
import type { AccountMovementRepository } from '../../src/resources/application/ports/out/account-movement.repository.js';
import { GetAccountResourcesService } from '../../src/resources/application/get-account-resources.service.js';
import type { AccountMovement } from '../../src/resources/domain/account-movement.js';

function createService(): {
  service: GetAccountResourcesService;
  findByUserId: ReturnType<
    typeof vi.fn<AccountMovementRepository['findByUserId']>
  >;
} {
  const findByUserId = vi.fn<AccountMovementRepository['findByUserId']>();
  const repository: AccountMovementRepository = { findByUserId };

  return {
    service: new GetAccountResourcesService(repository),
    findByUserId,
  };
}

describe('GetAccountResourcesService', () => {
  it('reads the selected account through the output port and returns its resources', async () => {
    const { service, findByUserId } = createService();
    const movements: AccountMovement[] = [
      {
        id: 1,
        instrumentId: 47,
        side: 'BUY',
        status: 'FILLED',
        size: 2,
        price: '100',
      },
    ];
    findByUserId.mockResolvedValue(movements);

    const resources = await service.execute({ userId: 7 });

    expect(findByUserId).toHaveBeenCalledTimes(1);
    expect(findByUserId).toHaveBeenCalledWith(7);
    expect(resources.accountingCash.toFixed(2)).toBe('-200.00');
    expect(resources.availableCash.toFixed(2)).toBe('-200.00');
    expect(resources.instruments).toEqual([
      {
        instrumentId: 47,
        executedQuantity: 2,
        sellReservedQuantity: 0,
        availableQuantity: 2,
      },
    ]);
  });

  it('returns zero cash and no instruments when the account has no movements', async () => {
    const { service, findByUserId } = createService();
    findByUserId.mockResolvedValue([]);

    const resources = await service.execute({ userId: 1 });

    expect(resources.accountingCash.toFixed(2)).toBe('0.00');
    expect(resources.reservedBuyCash.toFixed(2)).toBe('0.00');
    expect(resources.availableCash.toFixed(2)).toBe('0.00');
    expect(resources.instruments).toEqual([]);
  });

  it('wraps a repository failure instead of returning an empty account', async () => {
    const { service, findByUserId } = createService();
    const cause = new Error('driver failure');
    findByUserId.mockRejectedValue(cause);

    let caught: unknown;

    try {
      await service.execute({ userId: 1 });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AccountResourcesError);
    expect((caught as Error).message).toBe(
      'Account resources could not be calculated.',
    );
    expect((caught as { cause?: unknown }).cause).toBe(cause);
  });

  it('wraps invalid movement data instead of silently using zero', async () => {
    const { service, findByUserId } = createService();
    findByUserId.mockResolvedValue([
      {
        id: 1,
        instrumentId: 47,
        side: 'BUY',
        status: 'FILLED',
        size: 3,
        price: null,
      },
    ]);

    await expect(service.execute({ userId: 1 })).rejects.toBeInstanceOf(
      AccountResourcesError,
    );
  });
});
