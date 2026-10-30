import { Module } from '@nestjs/common';
import { getOperationalLogger } from '../shared/logging/operational-logger.js';
import type { AccountTransactionRunner } from '../transactions/application/ports/out/account-transaction.port.js';
import { TransactionsModule } from '../transactions/transactions.module.js';
import { ACCOUNT_TRANSACTION_RUNNER } from '../transactions/transactions.tokens.js';
import { CancelOrderService } from './application/cancel-order.service.js';
import { OrderReplayRecoveryService } from './application/order-replay-recovery.service.js';
import { RetryingSubmitOrderRunner } from './application/retrying-submit-order.runner.js';
import { SubmitOrderService } from './application/submit-order.service.js';
import type { Clock } from './application/ports/out/clock.port.js';
import type { SubmitOrderRecovery } from './application/ports/out/submit-order-recovery.port.js';
import { CancelOrderController } from './infrastructure/http/cancel-order.controller.js';
import { SubmitOrderBodyPipe } from './infrastructure/http/submit-order-body.pipe.js';
import { SubmitOrderController } from './infrastructure/http/submit-order.controller.js';
import { SystemClock } from './infrastructure/system-clock.js';
import {
  CANCEL_ORDER_USE_CASE,
  CLOCK,
  SUBMIT_ORDER_RECOVERY,
  SUBMIT_ORDER_USE_CASE,
} from './orders.tokens.js';

@Module({
  imports: [TransactionsModule],
  controllers: [SubmitOrderController, CancelOrderController],
  providers: [
    SubmitOrderBodyPipe,
    {
      provide: CLOCK,
      useFactory: (): Clock => new SystemClock(),
    },
    {
      provide: SUBMIT_ORDER_RECOVERY,
      inject: [ACCOUNT_TRANSACTION_RUNNER],
      useFactory: (
        runner: AccountTransactionRunner,
      ): SubmitOrderRecovery => new OrderReplayRecoveryService(runner),
    },
    {
      provide: SUBMIT_ORDER_USE_CASE,
      inject: [ACCOUNT_TRANSACTION_RUNNER, CLOCK, SUBMIT_ORDER_RECOVERY],
      useFactory: (
        runner: AccountTransactionRunner,
        clock: Clock,
        recovery: SubmitOrderRecovery,
      ): SubmitOrderService =>
        new SubmitOrderService(
          new RetryingSubmitOrderRunner(
            runner,
            undefined,
            getOperationalLogger(),
          ),
          clock,
          recovery,
          getOperationalLogger(),
        ),
    },
    {
      provide: CANCEL_ORDER_USE_CASE,
      inject: [ACCOUNT_TRANSACTION_RUNNER],
      useFactory: (runner: AccountTransactionRunner): CancelOrderService =>
        new CancelOrderService(runner),
    },
  ],
  exports: [SUBMIT_ORDER_USE_CASE, CANCEL_ORDER_USE_CASE],
})
export class OrdersModule {}
