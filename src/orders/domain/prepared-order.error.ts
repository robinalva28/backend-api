export type PreparedOrderErrorCode =
  | 'invalid-idempotency-key'
  | 'invalid-intent'
  | 'invalid-size'
  | 'invalid-price'
  | 'invalid-status'
  | 'invalid-datetime'
  | 'incompatible-status'
  | 'size-intent-mismatch'
  | 'price-intent-mismatch';

const MESSAGES: Readonly<Record<PreparedOrderErrorCode, string>> = {
  'invalid-idempotency-key': 'The prepared order key is not a canonical UUID.',
  'invalid-intent': 'The prepared order intent is invalid.',
  'invalid-size': 'The prepared order size is not a representable positive integer.',
  'invalid-price': 'The prepared order price is not a representable positive amount.',
  'invalid-status': 'The prepared order status is not allowed at creation.',
  'invalid-datetime': 'The prepared order datetime is not a valid timestamp.',
  'incompatible-status':
    'The prepared order status is not compatible with its order type.',
  'size-intent-mismatch':
    'The prepared order size does not match the original size intent.',
  'price-intent-mismatch':
    'The prepared order price does not match the original limit intent.',
};

export class PreparedOrderError extends Error {
  readonly code: PreparedOrderErrorCode;

  constructor(code: PreparedOrderErrorCode) {
    super(MESSAGES[code]);
    this.name = 'PreparedOrderError';
    this.code = code;
  }
}
