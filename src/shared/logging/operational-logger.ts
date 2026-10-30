import { currentRequestLogContext } from './request-context.js';
import {
  isLogLevelEnabled,
  readLogLevel,
  type LogLevel,
} from './log-level.js';

export interface OperationalLogFields {
  readonly requestId?: string;
  readonly method?: string;
  readonly route?: string;
  readonly status?: number;
  readonly durationMs?: number;
  readonly accountUserId?: number;
  readonly orderId?: number;
  readonly orderStatus?: string;
  readonly connectionMode?: 'local' | 'remote';
  readonly port?: number;
  readonly thresholdMs?: number;
  readonly attempt?: number;
  readonly delayMs?: number;
  readonly stage?: string;
  readonly commitOutcome?: string;
  readonly code?: string;
  readonly diagnostic?: string;
  readonly rollbackFailed?: boolean;
  readonly releaseFailed?: boolean;
}

export interface OperationalLogger {
  info(event: string, fields?: OperationalLogFields): void;
  warn(event: string, fields?: OperationalLogFields): void;
  error(event: string, fields?: OperationalLogFields): void;
}

export interface JsonOperationalLoggerOptions {
  readonly level: LogLevel;
  readonly sink?: (line: string) => void;
}

const EVENT_PATTERN = /^[a-z][a-z0-9_.-]{0,63}$/;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,64}$/;
const METHOD_PATTERN = /^[A-Z]{1,16}$/;
const ROUTE_PATTERN = /^(?:\/[A-Za-z0-9_:/.*-]*|<unmatched>)$/;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;
const COMMIT_OUTCOMES = new Set([
  'not-attempted',
  'confirmed',
  'rolled-back',
  'uncertain',
]);

export class JsonOperationalLogger implements OperationalLogger {
  private readonly level: LogLevel;
  private readonly sink: (line: string) => void;

  constructor(options: JsonOperationalLoggerOptions) {
    this.level = options.level;
    this.sink = options.sink ?? writeToStdout;
  }

  info(event: string, fields: OperationalLogFields = {}): void {
    this.write('info', event, fields);
  }

  warn(event: string, fields: OperationalLogFields = {}): void {
    this.write('warn', event, fields);
  }

  error(event: string, fields: OperationalLogFields = {}): void {
    this.write('error', event, fields);
  }

  private write(
    level: LogLevel,
    event: string,
    fields: OperationalLogFields,
  ): void {
    if (!isLogLevelEnabled(this.level, level)) {
      return;
    }

    const context = currentRequestLogContext();
    const entry: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      level,
      event: EVENT_PATTERN.test(event) ? event : 'unknown-event',
    };
    const requestId = fields.requestId ?? context?.requestId;

    if (requestId !== undefined && REQUEST_ID_PATTERN.test(requestId)) {
      entry['requestId'] = requestId;
    }

    writeString(entry, 'method', fields.method, METHOD_PATTERN);
    writeString(entry, 'route', fields.route, ROUTE_PATTERN);
    writeNumber(entry, 'status', fields.status, 100, 599);
    writeNumber(entry, 'durationMs', fields.durationMs, 0, 86_400_000);
    writeNumber(
      entry,
      'accountUserId',
      fields.accountUserId ?? context?.accountUserId,
      1,
      2_147_483_647,
    );
    writeNumber(
      entry,
      'orderId',
      fields.orderId ?? context?.orderId,
      1,
      2_147_483_647,
    );
    writeString(entry, 'orderStatus', fields.orderStatus, METHOD_PATTERN);
    writeString(
      entry,
      'connectionMode',
      fields.connectionMode,
      /^(?:local|remote)$/,
    );
    writeNumber(entry, 'port', fields.port, 1, 65_535);
    writeNumber(entry, 'thresholdMs', fields.thresholdMs, 0, 3_600_000);
    writeNumber(entry, 'attempt', fields.attempt, 1, 100);
    writeNumber(entry, 'delayMs', fields.delayMs, 0, 3_600_000);
    writeString(
      entry,
      'stage',
      fields.stage,
      /^(?:connection|begin|lock|work|commit|rollback|release)$/,
    );

    if (
      fields.commitOutcome !== undefined &&
      COMMIT_OUTCOMES.has(fields.commitOutcome)
    ) {
      entry['commitOutcome'] = fields.commitOutcome;
    }

    writeString(entry, 'code', fields.code, TOKEN_PATTERN);

    if (fields.diagnostic !== undefined) {
      entry['diagnostic'] = fields.diagnostic.slice(0, 1000);
    }

    if (fields.rollbackFailed === true) {
      entry['rollbackFailed'] = true;
    }

    if (fields.releaseFailed === true) {
      entry['releaseFailed'] = true;
    }

    try {
      this.sink(`${JSON.stringify(entry)}\n`);
    } catch {
      // Logging must never turn a request into a failure.
    }
  }
}

export const noopOperationalLogger: OperationalLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

let defaultLogger: JsonOperationalLogger | undefined;

export function getOperationalLogger(): JsonOperationalLogger {
  defaultLogger ??= new JsonOperationalLogger({
    level: readLogLevel(process.env['LOG_LEVEL']),
  });

  return defaultLogger;
}

export function resetOperationalLoggerForTests(): void {
  defaultLogger = undefined;
}

function writeToStdout(line: string): void {
  process.stdout.write(line);
}

function writeString(
  entry: Record<string, unknown>,
  key: string,
  value: string | undefined,
  pattern: RegExp,
): void {
  if (value !== undefined && pattern.test(value)) {
    entry[key] = value;
  }
}

function writeNumber(
  entry: Record<string, unknown>,
  key: string,
  value: number | undefined,
  minimum: number,
  maximum: number,
): void {
  if (
    value !== undefined &&
    Number.isInteger(value) &&
    value >= minimum &&
    value <= maximum
  ) {
    entry[key] = value;
  }
}
