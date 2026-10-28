import { Module } from '@nestjs/common';
import type { Pool } from 'pg';
import { DatabaseModule } from '../database/database.module.js';
import { PG_POOL } from '../database/database.tokens.js';
import { GetAccountResourcesService } from './application/get-account-resources.service.js';
import type { AccountMovementRepository } from './application/ports/out/account-movement.repository.js';
import { PostgresAccountMovementRepository } from './infrastructure/persistence/postgres-account-movement.repository.js';
import {
  ACCOUNT_MOVEMENT_REPOSITORY,
  GET_ACCOUNT_RESOURCES_USE_CASE,
} from './resources.tokens.js';

@Module({
  imports: [DatabaseModule],
  providers: [
    {
      provide: ACCOUNT_MOVEMENT_REPOSITORY,
      inject: [PG_POOL],
      useFactory: (pool: Pool): PostgresAccountMovementRepository =>
        new PostgresAccountMovementRepository(pool),
    },
    {
      provide: GET_ACCOUNT_RESOURCES_USE_CASE,
      inject: [ACCOUNT_MOVEMENT_REPOSITORY],
      useFactory: (
        repository: AccountMovementRepository,
      ): GetAccountResourcesService =>
        new GetAccountResourcesService(repository),
    },
  ],
  exports: [ACCOUNT_MOVEMENT_REPOSITORY, GET_ACCOUNT_RESOURCES_USE_CASE],
})
export class ResourcesModule {}
