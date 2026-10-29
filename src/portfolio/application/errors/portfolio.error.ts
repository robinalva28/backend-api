export type PortfolioErrorCode =
  | 'invalid-input'
  | 'user-not-found'
  | 'read-failed'
  | 'calculation-failed';

const MESSAGES: Readonly<Record<PortfolioErrorCode, string>> = {
  'invalid-input': 'The account identifier must be a positive safe integer.',
  'user-not-found': 'The portfolio account was not found.',
  'read-failed': 'The portfolio snapshot could not be read.',
  'calculation-failed': 'The portfolio could not be calculated.',
};

/**
 * Internal portfolio error. It intentionally does not define public status
 * codes or payloads; the HTTP adapter belongs to a later block.
 */
export class PortfolioError extends Error {
  readonly code: PortfolioErrorCode;

  constructor(code: PortfolioErrorCode, options?: ErrorOptions) {
    super(MESSAGES[code], options);
    this.name = 'PortfolioError';
    this.code = code;
  }
}
