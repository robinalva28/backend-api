import type { Pool, QueryResultRow } from 'pg';
import type { InstrumentSearchRepository } from '../../application/ports/out/instrument-search.repository.js';
import type { Instrument } from '../../domain/instrument.js';

interface InstrumentRow extends QueryResultRow {
  id: number;
  ticker: string | null;
  name: string | null;
}

const SEARCH_INSTRUMENTS_SQL = `
  SELECT id, ticker, name
  FROM instruments
  WHERE type = 'ACCIONES'
    AND (ticker ILIKE $1 ESCAPE '!' OR name ILIKE $1 ESCAPE '!')
  ORDER BY ticker ASC, id ASC
`;

export class PostgresInstrumentSearchRepository
  implements InstrumentSearchRepository
{
  constructor(private readonly pool: Pool) {}

  async searchByText(text: string): Promise<Instrument[]> {
    const result = await this.pool.query<InstrumentRow>(
      SEARCH_INSTRUMENTS_SQL,
      [toLiteralContainsPattern(text)],
    );

    return result.rows.map((row) => ({
      id: row.id,
      ticker: row.ticker,
      name: row.name,
    }));
  }
}

export function toLiteralContainsPattern(text: string): string {
  const escaped = text.replace(/[!%_]/g, (character) => `!${character}`);

  return `%${escaped}%`;
}
