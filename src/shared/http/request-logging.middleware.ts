import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { readSlowRequestThresholdMs } from '../logging/log-level.js';
import {
  getOperationalLogger,
  type OperationalLogFields,
  type OperationalLogger,
} from '../logging/operational-logger.js';
import {
  runWithRequestLogContext,
  type RequestLogContext,
} from '../logging/request-context.js';
import { rawRequestPath } from './request-path.js';
import { resolveRequestRoute } from './request-route-template.js';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,64}$/;
const REQUEST_ID_HEADER = 'X-Request-Id';

export interface RequestLoggingOptions {
  readonly logger?: OperationalLogger;
  readonly slowRequestThresholdMs?: number;
  readonly generateRequestId?: () => string;
}

export function createRequestLoggingMiddleware(
  options: RequestLoggingOptions = {},
): (request: Request, response: Response, next: NextFunction) => void {
  const logger = options.logger ?? getOperationalLogger();
  const slowRequestThresholdMs =
    options.slowRequestThresholdMs ??
    readSlowRequestThresholdMs(process.env['SLOW_REQUEST_THRESHOLD_MS']);
  const generateRequestId = options.generateRequestId ?? randomUUID;

  return function requestLogging(
    request: Request,
    response: Response,
    next: NextFunction,
  ): void {
    const requestId = acceptedRequestId(request) ?? generateRequestId();
    const pathname = rawRequestPath(request);
    const route = resolveRequestRoute(pathname);
    const context: RequestLogContext = {
      requestId,
      ...(route.accountUserId === undefined
        ? {}
        : { accountUserId: route.accountUserId }),
      ...(route.orderId === undefined ? {} : { orderId: route.orderId }),
    };
    const startedAt = Date.now();
    let finalized = false;

    response.setHeader(REQUEST_ID_HEADER, requestId);

    const finalize = (aborted: boolean): void => {
      if (finalized) {
        return;
      }

      finalized = true;

      const fields: OperationalLogFields = {
        requestId,
        method: request.method,
        route: route.route,
        durationMs: Math.max(0, Date.now() - startedAt),
        ...(context.accountUserId === undefined
          ? {}
          : { accountUserId: context.accountUserId }),
        ...(context.orderId === undefined ? {} : { orderId: context.orderId }),
      };

      if (aborted) {
        logger.warn('http.request.aborted', fields);
        return;
      }

      const completed: OperationalLogFields = {
        ...fields,
        status: response.statusCode,
      };

      logger.info('http.request.completed', completed);

      if (
        completed.durationMs !== undefined &&
        completed.durationMs >= slowRequestThresholdMs
      ) {
        logger.warn('http.request.slow', {
          ...completed,
          thresholdMs: slowRequestThresholdMs,
        });
      }
    };

    response.once('finish', () => finalize(false));
    response.once('close', () => {
      if (!response.writableFinished) {
        finalize(true);
      }
    });

    runWithRequestLogContext(context, next);
  };
}

function acceptedRequestId(request: Request): string | undefined {
  const value = request.get('X-Request-Id');

  return value !== undefined && REQUEST_ID_PATTERN.test(value)
    ? value
    : undefined;
}
