import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { rejectCancelOrderBody } from '../orders/infrastructure/http/reject-cancel-order-body.middleware.js';
import { rejectMalformedCancelOrderUrl } from '../orders/infrastructure/http/reject-malformed-cancel-order-url.middleware.js';

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
}
