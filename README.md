# Challenge backend de Cocos

Objetivo: preparar una API REST de portfolio, búsqueda de activos y envío de órdenes según la [consigna backend](backend-challenge.md), tomada del [repositorio original](https://github.com/cocoscap/cocos-challenge).

**Estado: base técnica.** NestJS con Express y TypeScript estricto, dependencias fijadas y Docker Compose para ejecución local. El proceso HTTP arranca; portfolio, búsqueda, órdenes y sus pruebas funcionales todavía no están implementados. La raíz `/` responde 404.

- [Consigna original](backend-challenge.md) y [base de datos provista](database.sql).
- [Requisitos y criterios de aceptación](docs/requisitos.md).
- [Plan, decisiones, pendientes y flujo de entrega](docs/plan.md).
- [Especificación SDD parcial](docs/backend-features.spec).
- [Reglas de trabajo y registro de sesiones](AGENTS.md).

Los Markdown de otros challenges se conservan sin cambios por instrucción del usuario. El alcance de este trabajo se limita al backend.

## Ejecución con Docker

Requiere un motor Docker activo y los plugins Compose y Buildx. [Dockerfile](Dockerfile) usa Node 24.22.1 LTS; [compose.yaml](compose.yaml) fija PostgreSQL 18.6. Las dependencias npm y sus resoluciones están en [package.json](package.json) y [package-lock.json](package-lock.json).

```sh
docker compose config --quiet
docker compose up --build --wait
```

Por defecto la API se publica en `127.0.0.1:3000` y PostgreSQL en `127.0.0.1:5432`. [.env.example](.env.example) contiene valores locales opcionales para cambiar puertos y credenciales mediante `.env`. En esta sesión se usa `PORT=3001` localmente para preservar otro servicio existente en el puerto 3000. Compose conecta la API al servicio `db`; el adapter de acceso a datos se implementará con los CDU.

`database.sql` se monta solo para lectura y se ejecuta únicamente al inicializar un volumen vacío. PostgreSQL 18 conserva datos en el volumen montado en `/var/lib/postgresql`. `docker compose down` detiene los servicios y conserva ese volumen.

Para disponer de una base de pruebas independiente y efímera, en el puerto 5433:

```sh
docker compose --profile test up --wait db-test
```

## Verificación nativa

Con Node 24.22.1, sin necesitar un servidor de base para este arranque mínimo:

```sh
npm ci --ignore-scripts
npm run typecheck
npm run build
PORT=3002 npm start
```

Se usa otro puerto libre para no colisionar con Compose. Se valida `PORT` al iniciar y se activa el cierre por señales. Vitest y Supertest están instalados; todavía no existe una suite de pruebas del challenge. La comprobación de arranque no equivale a validación funcional de la aplicación.

La verificación Docker de esta sesión utilizó el perfil existente de Colima y plugins temporales Compose 5.6.1/Buildx 0.38.1, sin instalarlos globalmente ni cambiar el contexto activo. Con Colima, se puede elegir el motor por comando con `DOCKER_CONTEXT=colima`; los plugins deben estar disponibles en el CLI para usar los comandos anteriores. Resultados de validación en el plan.

## Follow-ups

- Evaluar riesgos del redondeo monetario y costo de preservar mayor precisión histórica y futura; por ahora se mantiene escala 2. [Detalle](docs/backend-features.spec#evidencia-sobre-la-precisión-histórica-y-costo-de-preservarla).
