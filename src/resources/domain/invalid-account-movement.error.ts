export class InvalidAccountMovementError extends Error {
  constructor(movementId: number, reason: string) {
    super(`Invalid account movement ${movementId}: ${reason}.`);
    this.name = 'InvalidAccountMovementError';
  }
}
