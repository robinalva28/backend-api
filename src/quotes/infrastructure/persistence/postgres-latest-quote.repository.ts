import type { QueryResult, QueryResultRow } from 'pg';
import type { LatestQuoteRepository } from '../../application/ports/out/latest-quote.repository.js';
import type { LatestQuote } from '../../domain/latest-quote.js';

export interface PostgresQueryable {
  query<Row extends QueryResultRow>(
    text: string,
    values: unknown[],
  ): Promise<QueryResult<Row>>;
}

interface LatestQuoteRow extends QueryResultRow {
  id: number;
  instrument_id: number;
  date: string;
  close: string | null;
  previous_close: string | null;
}

const LATEST_QUOTE_SQL = `
  SELECT
    id,
    instrumentid AS instrument_id,
    to_char(date, 'YYYY-MM-DD') AS date,
    close::text AS close,
    previousclose::text AS previous_close
  FROM marketdata
  WHERE instrumentid = $1
    AND date IS NOT NULL
  ORDER BY marketdata.date DESC, marketdata.id DESC
  LIMIT 1
`;

export class PostgresLatestQuoteRepository implements LatestQuoteRepository {
  constructor(private readonly queryable: PostgresQueryable) {}

  async findLatestByInstrumentId(
    instrumentId: number,
  ): Promise<LatestQuote | null> {
    const result = await this.queryable.query<LatestQuoteRow>(
      LATEST_QUOTE_SQL,
      [instrumentId],
    );
    const row = result.rows[0];

    if (row === undefined) {
      return null;
    }

    return {
      id: row.id,
      instrumentId: row.instrument_id,
      date: row.date,
      close: row.close,
      previousClose: row.previous_close,
    };
  }
}
