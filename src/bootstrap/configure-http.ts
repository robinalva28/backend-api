import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { configureDocumentation } from '../documentation/configure-documentation.js';
import { rejectCancelOrderBody } from '../orders/infrastructure/http/reject-cancel-order-body.middleware.js';
import { rejectMalformedCancelOrderUrl } from '../orders/infrastructure/http/reject-malformed-cancel-order-url.middleware.js';
import { INVALID_SUBMIT_ORDER_REQUEST_MESSAGE } from '../orders/infrastructure/http/http-messages.js';
import { isSubmitOrderRequest } from '../orders/infrastructure/http/submit-order-request-path.js';
import { rejectMalformedPortfolioUrl } from '../portfolio/infrastructure/http/reject-malformed-portfolio-url.middleware.js';
import { INVALID_PORTFOLIO_REQUEST_MESSAGE } from '../portfolio/infrastructure/http/http-messages.js';
import { isPortfolioRequest } from '../portfolio/infrastructure/http/portfolio-request-path.js';
import { createRequestLoggingMiddleware } from '../shared/http/request-logging.middleware.js';
import type { RequestLoggingOptions } from '../shared/http/request-logging.middleware.js';
import { HttpParserExceptionFilter } from '../shared/http/parser-exception.filter.js';

export type HttpApplicationOptions = RequestLoggingOptions;

export function configureHttpApplication(
  app: INestApplication,
  options: HttpApplicationOptions = {},
): void {
  // Must run before init/listen: Nest registers its body parsers during init,
  // so these middlewares are then placed before them and before the router.
  // Request logging is first so parser and pre-router rejections are included.
  app.use(createRequestLoggingMiddleware(options));
  app.use(rejectMalformedCancelOrderUrl);
  app.use(rejectCancelOrderBody);
  app.use(rejectMalformedPortfolioUrl);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  // Parser errors occur before routing, so this filter normalizes them for the
  // public routes that require the generic 400 response and leaves any other
  // route's response unchanged.
  app.useGlobalFilters(
    new HttpParserExceptionFilter([
      {
        matches: isSubmitOrderRequest,
        message: INVALID_SUBMIT_ORDER_REQUEST_MESSAGE,
      },
      {
        matches: isPortfolioRequest,
        message: INVALID_PORTFOLIO_REQUEST_MESSAGE,
      },
    ]),
  );
  configureDocumentation(app);
}
