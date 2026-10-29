import { Module } from '@nestjs/common';
import type { AccountTransactionRunner } from '../transactions/application/ports/out/account-transaction.port.js';
import { TransactionsModule } from '../transactions/transactions.module.js';
import { ACCOUNT_TRANSACTION_RUNNER } from '../transactions/transactions.tokens.js';
import { SubmitOrderService } from './application/submit-order.service.js';
import type { Clock } from './application/ports/out/clock.port.js';
import { SystemClock } from './infrastructure/system-clock.js';
import { CLOCK, SUBMIT_ORDER_USE_CASE } from './orders.tokens.js';

@Module({
  imports: [TransactionsModule],
  providers: [
    {
      provide: CLOCK,
      useFactory: (): Clock => new SystemClock(),
    },
    {
      provide: SUBMIT_ORDER_USE_CASE,
      inject: [ACCOUNT_TRANSACTION_RUNNER, CLOCK],
      useFactory: (
        runner: AccountTransactionRunner,
        clock: Clock,
      ): SubmitOrderService => new SubmitOrderService(runner, clock),
    },
  ],
  exports: [SUBMIT_ORDER_USE_CASE],
})
export class OrdersModule {}
