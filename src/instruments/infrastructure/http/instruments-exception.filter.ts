import {
  BadRequestException,
  Catch,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Response } from 'express';
import { failureLogFields } from '../../../shared/logging/failure-fields.js';
import { getOperationalLogger } from '../../../shared/logging/operational-logger.js';
import {
  INVALID_SEARCH_REQUEST_MESSAGE,
  SEARCH_UNAVAILABLE_MESSAGE,
} from './http-messages.js';

@Catch()
export class InstrumentsExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof BadRequestException) {
      response.status(400).json({ message: INVALID_SEARCH_REQUEST_MESSAGE });
      return;
    }

    getOperationalLogger().error(
      'instruments.search.failed',
      failureLogFields(exception, 'instrument-search'),
    );
    response.status(500).json({ message: SEARCH_UNAVAILABLE_MESSAGE });
  }
}
