export type SubmitOrderErrorCode =
  | 'unsupported-currency'
  | 'conflict'
  | 'account-not-found'
  | 'instrument-not-found'
  | 'instrument-not-tradable'
  | 'quote-unavailable'
  | 'quote-invalid'
  | 'quantity-not-representable';

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
};

export class SubmitOrderError extends Error {
  readonly code: SubmitOrderErrorCode;

  constructor(code: SubmitOrderErrorCode) {
    super(MESSAGES[code]);
    this.name = 'SubmitOrderError';
    this.code = code;
  }
}
