import { Logger } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatabaseModule } from '../../src/database/database.module.js';
import { PG_POOL } from '../../src/database/database.tokens.js';

const pgMock = vi.hoisted(() => {
  const created: FakePool[] = [];

  class FakePool {
    readonly config: unknown;
    readonly errorHandlers: Array<(error: Error) => void> = [];
    ended = 0;

    constructor(config: unknown) {
      this.config = config;
      created.push(this);
    }

    on(event: string, handler: (error: Error) => void): this {
      if (event === 'error') {
        this.errorHandlers.push(handler);
      }

      return this;
    }

    async end(): Promise<void> {
      this.ended += 1;
    }
  }

  return { created, FakePool };
});

vi.mock('pg', () => ({ Pool: pgMock.FakePool }));

afterEach(() => {
  pgMock.created.length = 0;
});

describe('DatabaseModule', () => {
  it('creates the configured pool, emits sanitized idle errors and closes it', async () => {
    const log = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          ignoreEnvVars: true,
          load: [
            () => ({
              PGHOST: 'db.internal',
              PGPORT: '5433',
              PGDATABASE: 'cocos_test',
              PGUSER: 'tester',
              PGPASSWORD: 'local-password',
            }),
          ],
        }),
        DatabaseModule,
      ],
    }).compile();
    const app = moduleRef.createNestApplication();

    await app.init();

    const pool = app.get(PG_POOL) as InstanceType<typeof pgMock.FakePool>;

    expect(pgMock.created).toHaveLength(1);
    expect(pool.config).toEqual({
      host: 'db.internal',
      port: 5433,
      database: 'cocos_test',
      user: 'tester',
      password: 'local-password',
    });
    expect(pool.errorHandlers).toHaveLength(1);

    const error = Object.assign(
      new Error(
        'postgres://alice:secret@db.internal/cocos password=hunter2\nnext line',
      ),
      { code: 'ECONNREFUSED' },
    );
    pool.errorHandlers[0]?.(error);

    expect(log).toHaveBeenCalledTimes(1);

    const logged = String(log.mock.calls[0]?.[0]);
    expect(logged).toContain('operation=postgres-idle-client');
    expect(logged).toContain('ECONNREFUSED');
    expect(logged).toContain('connection refused');
    expect(logged).not.toContain('alice');
    expect(logged).not.toContain('secret');
    expect(logged).not.toContain('hunter2');
    expect(logged).not.toContain('\n');

    await app.close();

    expect(pool.ended).toBe(1);
  });
});
