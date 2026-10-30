import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { InstrumentsModule } from './instruments/instruments.module.js';
import { OrdersModule } from './orders/orders.module.js';
import { PortfolioModule } from './portfolio/portfolio.module.js';
import { QuotesModule } from './quotes/quotes.module.js';
import { ResourcesModule } from './resources/resources.module.js';
import {
  readLogLevel,
  readSlowRequestThresholdMs,
} from './shared/logging/log-level.js';
import { TransactionsModule } from './transactions/transactions.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate(environment: Record<string, unknown>) {
        const port = Number(environment['PORT'] ?? 3000);

        if (!Number.isInteger(port) || port < 1 || port > 65535) {
          throw new Error('PORT must be an integer between 1 and 65535.');
        }

        const logLevel = readLogLevel(readOptionalString(environment, 'LOG_LEVEL'));
        const slowRequestThresholdMs = readSlowRequestThresholdMs(
          readOptionalString(environment, 'SLOW_REQUEST_THRESHOLD_MS'),
        );

        return {
          ...environment,
          PORT: port,
          LOG_LEVEL: logLevel,
          SLOW_REQUEST_THRESHOLD_MS: slowRequestThresholdMs,
        };
      },
    }),
    InstrumentsModule,
    OrdersModule,
    PortfolioModule,
    QuotesModule,
    ResourcesModule,
    TransactionsModule,
  ],
})
export class AppModule {}

function readOptionalString(
  environment: Record<string, unknown>,
  variable: string,
): string | undefined {
  const value = environment[variable];

  return typeof value === 'string' ? value : undefined;
}
