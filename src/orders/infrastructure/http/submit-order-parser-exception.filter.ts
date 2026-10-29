import { HttpParserExceptionFilter } from '../../../shared/http/parser-exception.filter.js';
import { INVALID_SUBMIT_ORDER_REQUEST_MESSAGE } from './http-messages.js';
import { isSubmitOrderRequest } from './submit-order-request-path.js';

/**
 * Submission-specific alias kept for its existing consumers. Production
 * composition uses the shared filter with the routes it needs to normalize.
 */
export class SubmitOrderParserExceptionFilter extends HttpParserExceptionFilter {
  constructor() {
    super([
      {
        matches: isSubmitOrderRequest,
        message: INVALID_SUBMIT_ORDER_REQUEST_MESSAGE,
      },
    ]);
  }
}
