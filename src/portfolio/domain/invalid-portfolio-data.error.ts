export class InvalidPortfolioDataError extends Error {
  constructor(reason: string) {
    super(`Invalid portfolio data: ${reason}.`);
    this.name = 'InvalidPortfolioDataError';
  }
}
