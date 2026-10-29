import { Module } from '@nestjs/common';
import type { Pool } from 'pg';
import { DatabaseModule } from '../database/database.module.js';
import { PG_POOL } from '../database/database.tokens.js';
import { GetPortfolioService } from './application/get-portfolio.service.js';
import type { PortfolioSnapshotRepository } from './application/ports/out/portfolio-snapshot.repository.js';
import { PortfolioController } from './infrastructure/http/portfolio.controller.js';
import { PostgresPortfolioSnapshotRepository } from './infrastructure/persistence/postgres-portfolio-snapshot.repository.js';
import {
  GET_PORTFOLIO_USE_CASE,
  PORTFOLIO_SNAPSHOT_REPOSITORY,
} from './portfolio.tokens.js';

@Module({
  imports: [DatabaseModule],
  controllers: [PortfolioController],
  providers: [
    {
      provide: PORTFOLIO_SNAPSHOT_REPOSITORY,
      inject: [PG_POOL],
      useFactory: (pool: Pool): PortfolioSnapshotRepository =>
        new PostgresPortfolioSnapshotRepository(pool),
    },
    {
      provide: GET_PORTFOLIO_USE_CASE,
      inject: [PORTFOLIO_SNAPSHOT_REPOSITORY],
      useFactory: (
        snapshots: PortfolioSnapshotRepository,
      ): GetPortfolioService => new GetPortfolioService(snapshots),
    },
  ],
  exports: [GET_PORTFOLIO_USE_CASE],
})
export class PortfolioModule {}
