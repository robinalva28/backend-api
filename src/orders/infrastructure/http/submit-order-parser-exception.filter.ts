import {
  BadRequestException,
  Catch,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { INVALID_SUBMIT_ORDER_REQUEST_MESSAGE } from './http-messages.js';
import { isSubmitOrderRequest } from './submit-order-request-path.js';

/**
 * Body-parser failures happen in middleware, before Nest resolves the route,
 * so a controller-scoped filter cannot catch them. This global filter only
 * normalizes those BadRequestException instances for the submission route and
 * preserves Nest's default response for any other path.
 */
@Catch(BadRequestException)
export class SubmitOrderParserExceptionFilter implements ExceptionFilter {
  catch(exception: BadRequestException, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    if (isSubmitOrderRequest(request)) {
      response
        .status(400)
        .json({ message: INVALID_SUBMIT_ORDER_REQUEST_MESSAGE });
      return;
    }

    const status = exception.getStatus();
    const body = exception.getResponse();

    response.status(status).json(
      typeof body === 'string'
        ? { statusCode: status, message: body }
        : body,
    );
  }
}
