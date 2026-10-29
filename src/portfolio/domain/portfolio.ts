export interface PortfolioPosition {
  readonly instrumentId: number;
  readonly ticker: string | null;
  readonly name: string | null;
  readonly quantity: number;
  readonly positionValue: string;
  readonly totalReturnPercent: number | null;
  readonly dailyReturnPercent: number | null;
}

export interface Portfolio {
  readonly totalValue: string;
  readonly availableCash: string;
  readonly positions: readonly PortfolioPosition[];
}
