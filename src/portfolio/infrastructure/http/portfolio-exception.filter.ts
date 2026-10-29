import {
  BadRequestException,
  Catch,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Response } from 'express';
import { sanitizeDiagnostic } from '../../../shared/diagnostics.js';
import { PortfolioError } from '../../application/errors/portfolio.error.js';
import {
  INVALID_PORTFOLIO_REQUEST_MESSAGE,
  PORTFOLIO_UNAVAILABLE_MESSAGE,
  PORTFOLIO_USER_NOT_FOUND_MESSAGE,
} from './http-messages.js';

@Catch()
export class PortfolioExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(PortfolioExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof PortfolioError) {
      switch (exception.code) {
        case 'invalid-input':
          sendBadRequest(response);
          return;
        case 'user-not-found':
          response
            .status(404)
            .json({ message: PORTFOLIO_USER_NOT_FOUND_MESSAGE });
          return;
        case 'read-failed':
        case 'calculation-failed':
          this.fail(exception, response);
          return;
      }
    }

    if (exception instanceof BadRequestException) {
      sendBadRequest(response);
      return;
    }

    this.fail(exception, response);
  }

  private fail(exception: unknown, response: Response): void {
    this.logger.error(
      `Portfolio retrieval failed: ${sanitizeDiagnostic(
        exception,
        'portfolio-read',
      )}`,
    );
    response
      .status(500)
      .json({ message: PORTFOLIO_UNAVAILABLE_MESSAGE });
  }
}

function sendBadRequest(response: Response): void {
  response
    .status(400)
    .json({ message: INVALID_PORTFOLIO_REQUEST_MESSAGE });
}
