import {
  BadRequestException,
  Catch,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Response } from 'express';
import { sanitizeDiagnostic } from '../../../shared/diagnostics.js';
import { CancelOrderError } from '../../application/errors/cancel-order.error.js';
import {
  CANCEL_ORDER_UNAVAILABLE_MESSAGE,
  INVALID_CANCEL_REQUEST_MESSAGE,
  ORDER_NOT_CANCELLABLE_MESSAGE,
  ORDER_NOT_FOUND_MESSAGE,
} from './http-messages.js';

@Catch()
export class CancelOrderExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(CancelOrderExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof CancelOrderError) {
      switch (exception.code) {
        case 'invalid-input':
          sendBadRequest(response);
          return;
        case 'account-not-found':
        case 'order-not-found':
          response.status(404).json({ message: ORDER_NOT_FOUND_MESSAGE });
          return;
        case 'order-not-cancellable':
          response
            .status(409)
            .json({ message: ORDER_NOT_CANCELLABLE_MESSAGE });
          return;
        case 'transition-not-acknowledged':
          break;
      }
    }

    if (isBadRequest(exception)) {
      sendBadRequest(response);
      return;
    }

    this.logger.error(
      `Order cancellation failed: ${sanitizeDiagnostic(
        exception,
        'order-cancellation',
      )}`,
    );
    response
      .status(500)
      .json({ message: CANCEL_ORDER_UNAVAILABLE_MESSAGE });
  }
}

function isBadRequest(exception: unknown): boolean {
  return exception instanceof BadRequestException;
}

function sendBadRequest(response: Response): void {
  response.status(400).json({ message: INVALID_CANCEL_REQUEST_MESSAGE });
}
