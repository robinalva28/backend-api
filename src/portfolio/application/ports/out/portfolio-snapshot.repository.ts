import type { PortfolioReadSnapshot } from '../../../domain/portfolio-read-snapshot.js';

export interface PortfolioSnapshotRepository {
  /**
   * Returns `null` only when the user does not exist. An existing user without
   * movements is represented by a snapshot with empty arrays, so the caller
   * can distinguish both cases and return zero values for the latter.
   *
   * The snapshot must be a single consistent, read-only view. Its `movements`
   * sequence must be ordered by `datetime` ascending and then by `id`
   * ascending, preserving the timestamp text without losing microseconds.
   */
  findByUserId(userId: number): Promise<PortfolioReadSnapshot | null>;
}
