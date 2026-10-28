import type { AccountMovement } from '../../../domain/account-movement.js';

export interface AccountMovementRepository {
  findByUserId(userId: number): Promise<readonly AccountMovement[]>;
}
