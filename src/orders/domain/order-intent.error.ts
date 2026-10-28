export type OrderIntentErrorCode =
  | 'invalid-instrument'
  | 'invalid-side'
  | 'invalid-type'
  | 'invalid-mode'
  | 'invalid-size'
  | 'invalid-amount'
  | 'invalid-limit-price'
  | 'invalid-metadata'
  | 'unsupported-metadata-version';

const MESSAGES: Readonly<Record<OrderIntentErrorCode, string>> = {
  'invalid-instrument': 'The order intent instrument is invalid.',
  'invalid-side': 'The order intent side is invalid.',
  'invalid-type': 'The order intent type is invalid.',
  'invalid-mode': 'The order intent must contain exactly one size or amount.',
  'invalid-size': 'The order intent size is invalid.',
  'invalid-amount': 'The order intent amount is invalid.',
  'invalid-limit-price': 'The order intent limit price is invalid.',
  'invalid-metadata': 'The persisted order intent metadata is invalid.',
  'unsupported-metadata-version':
    'The persisted order intent metadata version is not supported.',
};

export class OrderIntentError extends Error {
  readonly code: OrderIntentErrorCode;

  constructor(code: OrderIntentErrorCode) {
    super(MESSAGES[code]);
    this.name = 'OrderIntentError';
    this.code = code;
  }
}
