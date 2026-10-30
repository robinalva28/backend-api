import { Module } from '@nestjs/common';
import type { Pool } from 'pg';
import { DatabaseModule } from '../database/database.module.js';
import { PG_POOL } from '../database/database.tokens.js';
import { getOperationalLogger } from '../shared/logging/operational-logger.js';
import type { AccountTransactionRunner } from './application/ports/out/account-transaction.port.js';
import { PostgresAccountTransactionRunner } from './infrastructure/persistence/postgres-account-transaction.runner.js';
import { ACCOUNT_TRANSACTION_RUNNER } from './transactions.tokens.js';

@Module({
  imports: [DatabaseModule],
  providers: [
    {
      provide: ACCOUNT_TRANSACTION_RUNNER,
      inject: [PG_POOL],
      useFactory: (pool: Pool): AccountTransactionRunner =>
        new PostgresAccountTransactionRunner(pool, getOperationalLogger()),
    },
  ],
  exports: [ACCOUNT_TRANSACTION_RUNNER],
})
export class TransactionsModule {}
