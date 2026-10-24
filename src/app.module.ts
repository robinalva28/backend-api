import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate(environment: Record<string, unknown>) {
        const port = Number(environment['PORT'] ?? 3000);

        if (!Number.isInteger(port) || port < 1 || port > 65535) {
          throw new Error('PORT debe ser un entero entre 1 y 65535.');
        }

        return { ...environment, PORT: port };
      },
    }),
  ],
})
export class AppModule {}
