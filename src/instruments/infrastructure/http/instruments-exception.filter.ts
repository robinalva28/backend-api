import {
  BadRequestException,
  Catch,
  type ArgumentsHost,
  type ExceptionFilter,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { sanitizeDiagnostic } from '../../../shared/diagnostics.js';
import {
  INVALID_SEARCH_REQUEST_MESSAGE,
  SEARCH_UNAVAILABLE_MESSAGE,
} from './http-messages.js';

@Catch()
export class InstrumentsExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(InstrumentsExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof BadRequestException) {
      response.status(400).json({ message: INVALID_SEARCH_REQUEST_MESSAGE });
      return;
    }

    this.logger.error(
      `Instrument search failed: ${sanitizeDiagnostic(
        exception,
        'instrument-search',
      )}`,
    );
    response.status(500).json({ message: SEARCH_UNAVAILABLE_MESSAGE });
  }
}
