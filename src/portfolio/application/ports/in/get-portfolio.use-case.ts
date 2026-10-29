import type { Portfolio } from '../../../domain/portfolio.js';

export interface GetPortfolioInput {
  readonly userId: number;
}

export type GetPortfolioOutput = Portfolio;

export interface GetPortfolioUseCase {
  execute(input: GetPortfolioInput): Promise<GetPortfolioOutput>;
}
