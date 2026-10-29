import { calculatePortfolio } from '../domain/calculate-portfolio.js';
import type { PortfolioReadSnapshot } from '../domain/portfolio-read-snapshot.js';
import { PortfolioError } from './errors/portfolio.error.js';
import type {
  GetPortfolioInput,
  GetPortfolioOutput,
  GetPortfolioUseCase,
} from './ports/in/get-portfolio.use-case.js';
import type { PortfolioSnapshotRepository } from './ports/out/portfolio-snapshot.repository.js';

/**
 * Internal portfolio use case. It reads one consistent snapshot, delegates
 * cash and reservations to the B02 calculation and derives cost, valuation and
 * returns in the portfolio domain. It does not expose HTTP, depend on Nest,
 * write data or log account details.
 */
export class GetPortfolioService implements GetPortfolioUseCase {
  constructor(private readonly snapshots: PortfolioSnapshotRepository) {}

  async execute(input: GetPortfolioInput): Promise<GetPortfolioOutput> {
    assertValidInput(input);

    let snapshot: PortfolioReadSnapshot | null;

    try {
      snapshot = await this.snapshots.findByUserId(input.userId);
    } catch (error) {
      throw new PortfolioError('read-failed', { cause: error });
    }

    if (snapshot === null) {
      throw new PortfolioError('user-not-found');
    }

    try {
      return calculatePortfolio(snapshot);
    } catch (error) {
      throw new PortfolioError('calculation-failed', { cause: error });
    }
  }
}

function assertValidInput(input: GetPortfolioInput): void {
  if (!Number.isSafeInteger(input.userId) || input.userId <= 0) {
    throw new PortfolioError('invalid-input');
  }
}
