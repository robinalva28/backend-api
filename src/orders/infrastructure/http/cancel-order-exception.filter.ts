import {
  BadRequestException,
  Catch,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Response } from 'express';
import { failureLogFields } from '../../../shared/logging/failure-fields.js';
import { getOperationalLogger } from '../../../shared/logging/operational-logger.js';
import { CancelOrderError } from '../../application/errors/cancel-order.error.js';
import {
  CANCEL_ORDER_UNAVAILABLE_MESSAGE,
  INVALID_CANCEL_REQUEST_MESSAGE,
  ORDER_NOT_CANCELLABLE_MESSAGE,
  ORDER_NOT_FOUND_MESSAGE,
} from './http-messages.js';

@Catch()
export class CancelOrderExceptionFilter implements ExceptionFilter {
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

    getOperationalLogger().error(
      'orders.cancellation.failed',
      failureLogFields(exception, 'order-cancellation'),
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
