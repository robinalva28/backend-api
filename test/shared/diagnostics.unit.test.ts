import { describe, expect, it } from 'vitest';
import { sanitizeDiagnostic } from '../../src/shared/diagnostics.js';

const operation = 'instrument-search';

describe('sanitizeDiagnostic', () => {
  it('emits static operation, validated name and mapped code without raw messages', () => {
    const error = Object.assign(
      new Error(
        'postgres://alice:secret@db.internal/backend_api password=hunter2\nsecond line',
      ),
      { code: 'ECONNREFUSED' },
    );

    const output = sanitizeDiagnostic(error, operation);

    expect(output).toContain('operation=instrument-search');
    expect(output).toContain('Error [ECONNREFUSED]: connection refused');
    expect(output).not.toContain('alice');
    expect(output).not.toContain('secret');
    expect(output).not.toContain('hunter2');
    expect(output).not.toContain('\n');
  });

  it('does not emit arbitrary message values or credentials', () => {
    const output = sanitizeDiagnostic(
      new Error(
        'customer alice@example.com password=hunter2 request=request-123',
      ),
      operation,
    );

    expect(output).toContain('Error: error message redacted');
    expect(output).not.toContain('alice@example.com');
    expect(output).not.toContain('hunter2');
    expect(output).not.toContain('request-123');
  });

  it('recognizes the account transaction error name without exposing its message', () => {
    const error = Object.assign(new Error('password=secret-value'), {
      name: 'AccountTransactionError',
    });

    const output = sanitizeDiagnostic(error, 'account-transaction');

    expect(output).toContain(
      'AccountTransactionError: error message redacted',
    );
    expect(output).not.toContain('secret-value');
  });

  it('recognizes the submit order error name without exposing its message', () => {
    const error = Object.assign(new Error('password=secret-value'), {
      name: 'SubmitOrderError',
    });

    const output = sanitizeDiagnostic(error, 'order-submission');

    expect(output).toContain('SubmitOrderError: error message redacted');
    expect(output).not.toContain('secret-value');
  });

  it('maps known SQLSTATE codes and rejects invalid metadata', () => {
    const known = Object.assign(new Error('duplicate value'), {
      name: 'QueryError',
      code: '23505',
    });
    const invalidCode = Object.assign(new Error('duplicate value'), {
      code: 'BAD\nCODE',
    });
    const unknownMetadata = Object.assign(new Error('duplicate value'), {
      name: 'SecretName',
      code: 'X123',
    });

    const knownOutput = sanitizeDiagnostic(known, operation);
    const invalidCodeOutput = sanitizeDiagnostic(invalidCode, operation);
    const unknownMetadataOutput = sanitizeDiagnostic(unknownMetadata, operation);

    expect(knownOutput).toContain(
      'QueryError [23505]: unique constraint violation',
    );
    expect(invalidCodeOutput).toContain('Error: error message redacted');
    expect(invalidCodeOutput).not.toContain('BAD');
    expect(unknownMetadataOutput).toContain('Error: error message redacted');
    expect(unknownMetadataOutput).not.toContain('SecretName');
    expect(unknownMetadataOutput).not.toContain('X123');
  });

  it('walks nested causes, stops cycles and redacts non-error causes', () => {
    const root = new Error('root secret');
    const first = new Error('first secret');
    const second = new Error('second secret');

    root.cause = first;
    first.cause = second;
    second.cause = root;

    const output = sanitizeDiagnostic(root, operation);

    expect(output).toContain('cycle detected');
    expect(output).not.toContain('root secret');
    expect(output).not.toContain('first secret');
    expect(output).not.toContain('second secret');

    const stringCause = new Error('root');
    stringCause.cause = 'password=secret-value';

    expect(sanitizeDiagnostic(stringCause, operation)).toContain(
      'non-error cause redacted',
    );
    expect(sanitizeDiagnostic(stringCause, operation)).not.toContain(
      'secret-value',
    );
  });

  it('bounds total output and omits additional causes', () => {
    let current = new Error('value 0');
    const root = current;

    for (let index = 1; index <= 6; index += 1) {
      const next = new Error(`value ${index}`);
      current.cause = next;
      current = next;
    }

    const output = sanitizeDiagnostic(root, operation);

    expect(output.length).toBeLessThanOrEqual(1000);
    expect(output).toContain('additional causes omitted');
    expect(output).not.toContain('value 6');
  });

  it('rejects untrusted operation names and control characters', () => {
    const error = Object.assign(new Error('message'), {
      name: 'Evil\nName',
      code: 'CODE\u001b[31m',
    });

    const output = sanitizeDiagnostic(error, 'instrument-search\ninjected');

    expect(output).toContain('operation=unknown-operation');
    expect(output).not.toContain('Evil');
    expect(output).not.toContain('CODE');
    expect(output).not.toMatch(/[\u0000-\u001F\u007F-\u009F\u2028\u2029]/);
  });

  it('returns a bounded diagnostic when no error is available', () => {
    const output = sanitizeDiagnostic(undefined, operation);

    expect(output).toContain('operation=instrument-search');
    expect(output).toContain('no diagnostic available');
    expect(output).not.toMatch(/[\u0000-\u001F\u007F-\u009F\u2028\u2029]/);
  });

  it('does not throw when metadata getters fail', () => {
    const error = new Error('message');

    Object.defineProperty(error, 'name', {
      configurable: true,
      get() {
        throw new Error('name getter');
      },
    });
    Object.defineProperty(error, 'code', {
      configurable: true,
      get() {
        throw new Error('code getter');
      },
    });
    Object.defineProperty(error, 'cause', {
      configurable: true,
      get() {
        throw new Error('cause getter');
      },
    });

    const output = sanitizeDiagnostic(error, operation);

    expect(output).toContain('Error: error message redacted');
    expect(output).not.toContain('getter');
  });
});
