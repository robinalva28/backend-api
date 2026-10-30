import { diagnosticCode, sanitizeDiagnostic } from '../diagnostics.js';
import type { OperationalLogFields } from './operational-logger.js';

const TRANSACTION_STAGES = new Set([
  'connection',
  'begin',
  'lock',
  'work',
  'commit',
  'rollback',
  'release',
]);
const COMMIT_OUTCOMES = new Set([
  'not-attempted',
  'confirmed',
  'rolled-back',
  'uncertain',
]);

/**
 * Builds the allow-listed fields for one failure event. It never returns the
 * original error, its message, SQL, request data or credentials.
 */
export function failureLogFields(
  error: unknown,
  operation: string,
): OperationalLogFields {
  const fields: MutableFailureFields = {
    diagnostic: sanitizeDiagnostic(error, operation),
  };
  const code = diagnosticCode(error);

  if (code !== undefined) {
    fields.code = code;
  }

  const record = readRecord(error);

  if (record === undefined) {
    return fields;
  }

  const stage = readToken(record['stage']);

  if (stage !== undefined && TRANSACTION_STAGES.has(stage)) {
    fields.stage = stage;
  }

  const commitOutcome = readToken(record['commitOutcome']);

  if (
    commitOutcome !== undefined &&
    COMMIT_OUTCOMES.has(commitOutcome)
  ) {
    fields.commitOutcome = commitOutcome;
  }

  if (record['rollbackError'] !== undefined) {
    fields.rollbackFailed = true;
  }

  if (record['releaseError'] !== undefined) {
    fields.releaseFailed = true;
  }

  return fields;
}

interface MutableFailureFields {
  diagnostic: string;
  code?: string;
  stage?: string;
  commitOutcome?: string;
  rollbackFailed?: boolean;
  releaseFailed?: boolean;
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : undefined;
}

function readToken(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
