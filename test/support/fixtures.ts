import type { Pool } from 'pg';

export interface InstrumentFixture {
  id: number;
  ticker: string | null;
  name: string | null;
  type: 'ACCIONES' | 'MONEDA';
}

export async function resetInstruments(
  pool: Pool,
  fromId: number,
  toId: number,
): Promise<void> {
  await pool.query('DELETE FROM instruments WHERE id BETWEEN $1 AND $2', [
    fromId,
    toId,
  ]);
}

export async function insertInstruments(
  pool: Pool,
  fixtures: readonly InstrumentFixture[],
): Promise<void> {
  for (const fixture of fixtures) {
    await pool.query(
      'INSERT INTO instruments (id, ticker, name, type) VALUES ($1, $2, $3, $4)',
      [fixture.id, fixture.ticker, fixture.name, fixture.type],
    );
  }
}
