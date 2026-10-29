import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { rejectCancelOrderBody } from '../orders/infrastructure/http/reject-cancel-order-body.middleware.js';
import { rejectMalformedCancelOrderUrl } from '../orders/infrastructure/http/reject-malformed-cancel-order-url.middleware.js';
import { SubmitOrderParserExceptionFilter } from '../orders/infrastructure/http/submit-order-parser-exception.filter.js';

export function configureHttpApplication(app: INestApplication): void {
  // Must run before init/listen: Nest registers its body parsers during init,
  // so these middlewares are then placed before them and before the router.
  app.use(rejectMalformedCancelOrderUrl);
  app.use(rejectCancelOrderBody);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  // Parser errors occur before routing, so this filter normalizes them for the
  // submission route while leaving the other routes' responses unchanged.
  app.useGlobalFilters(new SubmitOrderParserExceptionFilter());
}
