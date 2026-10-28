const MAX_TOTAL_LENGTH = 1000;
const MAX_CAUSES = 4;

const SAFE_OPERATION = /^[a-z][a-z0-9-]{0,63}$/;
const SAFE_CODE = /^[A-Za-z0-9_]{1,32}$/;

const SAFE_ERROR_NAMES = new Set([
  'Error',
  'TypeError',
  'RangeError',
  'SyntaxError',
  'ReferenceError',
  'EvalError',
  'URIError',
  'AggregateError',
  'SearchInstrumentsError',
  'AccountTransactionError',
  'TimeoutError',
  'AbortError',
  'ConnectionError',
  'DatabaseError',
  'QueryError',
  'PostgresError',
]);

const STATIC_CODE_DESCRIPTIONS: Readonly<Record<string, string>> = {
  ECONNREFUSED: 'connection refused',
  ECONNRESET: 'connection reset',
  ENOTFOUND: 'host not found',
  ETIMEDOUT: 'connection timed out',
  EAI_AGAIN: 'temporary name resolution failure',
  EPIPE: 'broken pipe',
  '08000': 'connection failure',
  '08001': 'connection failure',
  '08003': 'connection does not exist',
  '08004': 'server rejected connection',
  '08006': 'connection failure',
  '22003': 'numeric value out of range',
  '22007': 'invalid datetime',
  '22021': 'invalid text encoding',
  '22P02': 'invalid text representation',
  '23503': 'foreign key violation',
  '23505': 'unique constraint violation',
  '25P02': 'transaction aborted',
  '28P01': 'authentication failed',
  '3D000': 'database does not exist',
  '40001': 'serialization failure',
  '42501': 'permission denied',
  '42601': 'syntax error',
  '42703': 'column does not exist',
  '42P01': 'relation does not exist',
  '53300': 'too many connections',
  '57014': 'query canceled',
  '40P01': 'deadlock detected',
};

interface ErrorMetadata {
  readonly name: string;
  readonly code: string | undefined;
}

export function sanitizeDiagnostic(error: unknown, operation: string): string {
  const safeOperation =
    typeof operation === 'string' && SAFE_OPERATION.test(operation)
      ? operation
      : 'unknown-operation';
  const segments: string[] = [];
  const seen = new WeakSet<object>();
  let current: unknown = error;

  for (let depth = 0; depth < MAX_CAUSES; depth += 1) {
    if (current instanceof Error) {
      if (seen.has(current)) {
        segments.push('cycle detected');
        break;
      }

      seen.add(current);

      const metadata = readErrorMetadata(current);
      segments.push(formatErrorSegment(metadata));

      const cause = readCause(current);

      if (cause === undefined || cause === current) {
        break;
      }

      if (depth === MAX_CAUSES - 1) {
        segments.push('additional causes omitted');
        break;
      }

      current = cause;
      continue;
    }

    if (typeof current === 'string' || current !== undefined) {
      segments.push('non-error cause redacted');
    }

    break;
  }

  if (segments.length === 0) {
    segments.push('no diagnostic available');
  }

  return truncate(
    `operation=${safeOperation}; ${segments.join(' <- ')}`,
    MAX_TOTAL_LENGTH,
  );
}

function readErrorMetadata(error: Error): ErrorMetadata {
  const nameValue = readProperty(error, 'name');
  const codeValue = readProperty(error, 'code');
  const name =
    typeof nameValue === 'string' && SAFE_ERROR_NAMES.has(nameValue)
      ? nameValue
      : 'Error';

  return {
    name,
    code:
      typeof codeValue === 'string' &&
      SAFE_CODE.test(codeValue) &&
      Object.hasOwn(STATIC_CODE_DESCRIPTIONS, codeValue)
        ? codeValue
        : undefined,
  };
}

function readCause(error: Error): unknown {
  return readProperty(error, 'cause');
}

function readProperty(error: Error, property: string): unknown {
  try {
    return (error as unknown as Record<string, unknown>)[property];
  } catch {
    return undefined;
  }
}

function formatErrorSegment(metadata: ErrorMetadata): string {
  const codeSuffix = metadata.code ? ` [${metadata.code}]` : '';
  const description = metadata.code
    ? (STATIC_CODE_DESCRIPTIONS[metadata.code] ?? 'error message redacted')
    : 'error message redacted';

  return `${metadata.name}${codeSuffix}: ${description}`;
}

function truncate(value: string, maximum: number): string {
  if (value.length <= maximum) {
    return value;
  }

  return `${value.slice(0, maximum - 3)}...`;
}
