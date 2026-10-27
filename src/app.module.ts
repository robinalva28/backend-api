import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { InstrumentsModule } from './instruments/instruments.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate(environment: Record<string, unknown>) {
        const port = Number(environment['PORT'] ?? 3000);

        if (!Number.isInteger(port) || port < 1 || port > 65535) {
          throw new Error('PORT must be an integer between 1 and 65535.');
        }

        return { ...environment, PORT: port };
      },
    }),
    InstrumentsModule,
  ],
})
export class AppModule {}
