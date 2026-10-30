import type { INestApplication } from '@nestjs/common';
import type { Request, Response } from 'express';
import { serve, setup } from 'swagger-ui-express';
import type { SwaggerUiOptions } from 'swagger-ui-express';
import { OPENAPI_DOCUMENT } from './openapi.document.js';
import {
  SWAGGER_UUID_HELPER_CSS,
  SWAGGER_UUID_HELPER_SCRIPT,
} from './swagger-uuid-helper.js';

const OPENAPI_PATH = '/openapi.json';
const OPENAPI_UI_URL = '../openapi.json';
const DOCS_PATH = '/docs';
const DOCS_TRAILING_PATH = '/docs/';

/**
 * Mounts the public documentation endpoints on bootstrap only:
 * - `/openapi.json` serves the single static OpenAPI definition.
 * - `/docs/` serves Swagger UI with local assets and loads that same JSON.
 *
 * These routes are plain Express handlers. They do not route through Nest
 * controllers, pipes, filters, use cases, repositories or SQL.
 */
export function configureDocumentation(app: INestApplication): void {
  const adapter = app.getHttpAdapter();

  adapter.get(OPENAPI_PATH, (_request: Request, response: Response) => {
    response.status(200).json(OPENAPI_DOCUMENT);
  });

  // The generated HTML uses relative asset URLs (`./swagger-ui.css`, ...),
  // so the UI must be opened with a trailing slash for them to resolve under
  // `/docs/` instead of the application root. Express treats `/docs` and
  // `/docs/` as the same route by default, so the pathname is checked
  // explicitly before delegating the trailing-slash form to Swagger UI.
  adapter.get(
    DOCS_PATH,
    (request: Request, response: Response, next?: Function) => {
      if (request.path !== DOCS_PATH) {
        next?.();
        return;
      }

      response.redirect(301, DOCS_TRAILING_PATH);
    },
  );

  // `customJsStr` is supported at runtime but missing from
  // @types/swagger-ui-express 4.1.8.
  const uiOptions: SwaggerUiOptions & { customJsStr?: string } = {
    customSiteTitle: 'backend API',
    customJsStr: SWAGGER_UUID_HELPER_SCRIPT,
    customCss: SWAGGER_UUID_HELPER_CSS,
    swaggerOptions: {
      url: OPENAPI_UI_URL,
      validatorUrl: null,
    },
  };

  app.use(DOCS_PATH, ...serve, setup(undefined, uiOptions));
}
