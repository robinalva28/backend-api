export type CancelOrderErrorCode =
  | 'invalid-input'
  | 'account-not-found'
  | 'order-not-found'
  | 'order-not-cancellable'
  | 'transition-not-acknowledged';

const MESSAGES: Readonly<Record<CancelOrderErrorCode, string>> = {
  'invalid-input':
    'The account and order identifiers must be positive safe integers.',
  'account-not-found': 'The order account was not found.',
  'order-not-found': 'The order was not found for the selected account.',
  'order-not-cancellable': 'Only a NEW or CANCELLED order can be cancelled.',
  'transition-not-acknowledged':
    'The cancellation transition was not acknowledged by persistence.',
};

/**
 * Internal cancellation error. It intentionally does not define public status
 * codes, payloads or messages; the HTTP adapter remains pending.
 */
export class CancelOrderError extends Error {
  readonly code: CancelOrderErrorCode;

  constructor(code: CancelOrderErrorCode) {
    super(MESSAGES[code]);
    this.name = 'CancelOrderError';
    this.code = code;
  }
}
