import {
  BadRequestException,
  Catch,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Request, Response } from 'express';

export interface ParserErrorRoute {
  readonly matches: (request: Request) => boolean;
  readonly message: string;
}

/**
 * Normalizes body-parser BadRequestException instances only for the configured
 * routes. Parser failures happen in middleware, before Nest resolves a
 * controller, so controller-scoped filters cannot own this translation. Any
 * other path keeps Nest's default response.
 */
@Catch(BadRequestException)
export class HttpParserExceptionFilter implements ExceptionFilter {
  constructor(private readonly routes: readonly ParserErrorRoute[] = []) {}

  catch(exception: BadRequestException, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const route = this.routes.find(({ matches }) => matches(request));

    if (route !== undefined) {
      response.status(400).json({ message: route.message });
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
