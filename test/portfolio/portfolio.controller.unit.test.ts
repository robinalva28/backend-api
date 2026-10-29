import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { GetPortfolioUseCase } from '../../src/portfolio/application/ports/in/get-portfolio.use-case.js';
import type { Portfolio } from '../../src/portfolio/domain/portfolio.js';
import { PortfolioController } from '../../src/portfolio/infrastructure/http/portfolio.controller.js';

const PORTFOLIO: Portfolio = {
  totalValue: '889756.00',
  availableCash: '627500.00',
  positions: [
    {
      instrumentId: 31,
      ticker: 'DYCA',
      name: 'Dycasa S.A.',
      quantity: -10,
      positionValue: '-15028.00',
      totalReturnPercent: null,
      dailyReturnPercent: -1.15,
    },
  ],
};

function createController(): {
  readonly controller: PortfolioController;
  readonly execute: ReturnType<typeof vi.fn<GetPortfolioUseCase['execute']>>;
} {
  const execute = vi.fn<GetPortfolioUseCase['execute']>();
  execute.mockResolvedValue(PORTFOLIO);

  return {
    controller: new PortfolioController({ execute }),
    execute,
  };
}

describe('PortfolioController', () => {
  it('forwards the parsed account id and returns the direct portfolio object', async () => {
    const { controller, execute } = createController();

    await expect(controller.get('0001')).resolves.toBe(PORTFOLIO);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith({ userId: 1 });
  });

  it.each([
    ['zero', '0'],
    ['leading zeroes only', '000'],
    ['negative', '-1'],
    ['signed', '+1'],
    ['fraction', '1.0'],
    ['exponent', '1e3'],
    ['hexadecimal', '0x10'],
    ['text', 'abc'],
    ['out of range', '2147483648'],
    ['huge', '999999999999999999999'],
    ['non-ASCII digits', '１２３'],
  ])('rejects %s before invoking the use case', async (_label, value) => {
    const { controller, execute } = createController();

    await expect(controller.get(value)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it('accepts the INT upper boundary', async () => {
    const { controller, execute } = createController();

    await controller.get('0002147483647');

    expect(execute).toHaveBeenCalledWith({ userId: 2_147_483_647 });
  });

  it('propagates use-case failures for the HTTP exception filter', async () => {
    const { controller, execute } = createController();
    const failure = new Error('portfolio failure');
    execute.mockRejectedValueOnce(failure);

    await expect(controller.get('7')).rejects.toBe(failure);
  });
});
