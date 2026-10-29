export type SubmitOrderErrorCode =
  | 'unsupported-currency'
  | 'conflict'
  | 'account-not-found'
  | 'instrument-not-found'
  | 'instrument-not-tradable'
  | 'quote-unavailable'
  | 'quote-invalid'
  | 'quantity-not-representable'
  | 'completion-failed';

const MESSAGES: Readonly<Record<SubmitOrderErrorCode, string>> = {
  'unsupported-currency': 'Only ARS is supported for order amounts.',
  conflict:
    'The idempotency key was already used with a different order intent.',
  'account-not-found': 'The order account was not found.',
  'instrument-not-found': 'The order instrument was not found.',
  'instrument-not-tradable': 'The order instrument is not tradable.',
  'quote-unavailable': 'The instrument has no usable market quote.',
  'quote-invalid': 'The latest market quote is not a finite positive price.',
  'quantity-not-representable': 'The order quantity is not representable.',
  'completion-failed': 'The order could not be completed.',
};

export interface SubmitOrderErrorOptions {
  readonly cause?: unknown;
}

export class SubmitOrderError extends Error {
  readonly code: SubmitOrderErrorCode;

  constructor(code: SubmitOrderErrorCode, options?: SubmitOrderErrorOptions) {
    super(
      MESSAGES[code],
      options?.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = 'SubmitOrderError';
    this.code = code;
  }
}
