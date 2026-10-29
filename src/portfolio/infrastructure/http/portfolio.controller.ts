import {
  Controller,
  Get,
  Inject,
  Param,
  UseFilters,
} from '@nestjs/common';
import type {
  GetPortfolioOutput,
  GetPortfolioUseCase,
} from '../../application/ports/in/get-portfolio.use-case.js';
import { GET_PORTFOLIO_USE_CASE } from '../../portfolio.tokens.js';
import { requirePortfolioRouteId } from './parse-portfolio-route-id.js';
import { PortfolioExceptionFilter } from './portfolio-exception.filter.js';

@Controller('users')
@UseFilters(PortfolioExceptionFilter)
export class PortfolioController {
  constructor(
    @Inject(GET_PORTFOLIO_USE_CASE)
    private readonly getPortfolio: GetPortfolioUseCase,
  ) {}

  @Get(':userId/portfolio')
  async get(
    @Param('userId') userIdText: string,
  ): Promise<GetPortfolioOutput> {
    const userId = requirePortfolioRouteId(userIdText);

    return this.getPortfolio.execute({ userId });
  }
}
