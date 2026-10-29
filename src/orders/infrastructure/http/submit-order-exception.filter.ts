import {
  BadRequestException,
  Catch,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Response } from 'express';
import { sanitizeDiagnostic } from '../../../shared/diagnostics.js';
import { SubmitOrderError } from '../../application/errors/submit-order.error.js';
import {
  INVALID_SUBMIT_ORDER_REQUEST_MESSAGE,
  SUBMIT_ORDER_CONFLICT_MESSAGE,
  SUBMIT_ORDER_NOT_FOUND_MESSAGE,
  SUBMIT_ORDER_UNAVAILABLE_MESSAGE,
} from './http-messages.js';

@Catch()
export class SubmitOrderExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(SubmitOrderExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof SubmitOrderError) {
      switch (exception.code) {
        case 'unsupported-currency':
        case 'instrument-not-tradable':
        case 'quantity-not-representable':
          sendBadRequest(response);
          return;
        case 'account-not-found':
        case 'instrument-not-found':
          response
            .status(404)
            .json({ message: SUBMIT_ORDER_NOT_FOUND_MESSAGE });
          return;
        case 'conflict':
          response
            .status(409)
            .json({ message: SUBMIT_ORDER_CONFLICT_MESSAGE });
          return;
        case 'quote-unavailable':
        case 'quote-invalid':
        case 'completion-failed':
          this.fail(exception, response);
          return;
      }
    }

    if (exception instanceof BadRequestException) {
      sendBadRequest(response);
      return;
    }

    // Persisted metadata errors (OrderIntentError), persistence/mapping
    // failures, transaction failures and unknown errors are internal.
    this.fail(exception, response);
  }

  private fail(exception: unknown, response: Response): void {
    this.logger.error(
      `Order submission failed: ${sanitizeDiagnostic(
        exception,
        'order-submission',
      )}`,
    );
    sendUnavailable(response);
  }
}

function sendBadRequest(response: Response): void {
  response
    .status(400)
    .json({ message: INVALID_SUBMIT_ORDER_REQUEST_MESSAGE });
}

function sendUnavailable(response: Response): void {
  response
    .status(500)
    .json({ message: SUBMIT_ORDER_UNAVAILABLE_MESSAGE });
}
