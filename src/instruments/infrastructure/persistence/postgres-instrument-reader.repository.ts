import type { QueryResult, QueryResultRow } from 'pg';
import type { InstrumentReader } from '../../application/ports/out/instrument-reader.js';
import type { InstrumentDetails } from '../../domain/instrument-details.js';

export interface PostgresQueryable {
  query<Row extends QueryResultRow>(
    text: string,
    values: unknown[],
  ): Promise<QueryResult<Row>>;
}

interface InstrumentRow extends QueryResultRow {
  id: number;
  type: string | null;
}

const FIND_INSTRUMENT_BY_ID_SQL = `
  SELECT id, type
  FROM instruments
  WHERE id = $1
`;

export class PostgresInstrumentReader implements InstrumentReader {
  constructor(private readonly queryable: PostgresQueryable) {}

  async findById(instrumentId: number): Promise<InstrumentDetails | null> {
    const result = await this.queryable.query<InstrumentRow>(
      FIND_INSTRUMENT_BY_ID_SQL,
      [instrumentId],
    );
    const row = result.rows[0];

    if (row === undefined) {
      return null;
    }

    return {
      id: row.id,
      type: row.type,
    };
  }
}
