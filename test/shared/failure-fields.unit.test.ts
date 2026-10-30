import { describe, expect, it } from 'vitest';
import { failureLogFields } from '../../src/shared/logging/failure-fields.js';
import { AccountTransactionError } from '../../src/transactions/application/errors/account-transaction.error.js';

describe('failureLogFields', () => {
  it('extracts only transaction metadata and a sanitized diagnostic', () => {
    const error = new AccountTransactionError({
      stage: 'commit',
      commitOutcome: 'uncertain',
      clientDisposition: 'discarded',
      cause: Object.assign(
        new Error('postgres://alice:secret@host/database password=hunter2'),
        { code: '40001' },
      ),
      rollbackError: new Error('rollback failed'),
    });

    const fields = failureLogFields(error, 'order-submission');
    const serialized = JSON.stringify(fields);

    expect(fields).toMatchObject({
      stage: 'commit',
      commitOutcome: 'uncertain',
      code: '40001',
      rollbackFailed: true,
    });
    expect(fields.diagnostic).toContain('operation=order-submission');
    expect(fields.diagnostic).toContain('AccountTransactionError');
    expect(fields.diagnostic).toContain('40001');
    expect(serialized).not.toContain('alice');
    expect(serialized).not.toContain('secret');
    expect(serialized).not.toContain('hunter2');
    expect(serialized).not.toContain('rollback failed');
  });

  it('redacts non-error causes', () => {
    const fields = failureLogFields('password=secret-value', 'portfolio-read');

    expect(fields.diagnostic).toContain('non-error cause redacted');
    expect(JSON.stringify(fields)).not.toContain('secret-value');
    expect(fields).not.toHaveProperty('stage');
    expect(fields).not.toHaveProperty('code');
  });
});
