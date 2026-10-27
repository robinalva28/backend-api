# Challenge backend de Cocos

Objetivo: preparar una API REST de portfolio, búsqueda de activos y envío de órdenes según la [consigna backend](backend-challenge.md), tomada del [repositorio original](https://github.com/cocoscap/cocos-challenge).

**Estado: búsqueda de instrumentos implementada.** NestJS con Express y TypeScript estricto, dependencias fijadas, Docker Compose para ejecución local y `GET /instruments?query=...` conectado a PostgreSQL mediante pg. Portfolio, envío y cancelación de órdenes siguen sin implementarse. La raíz `/` responde 404.

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

Por defecto la API se publica en `127.0.0.1:3000` y PostgreSQL en `127.0.0.1:5432`. [.env.example](.env.example) contiene valores locales opcionales para cambiar puertos y credenciales mediante `.env`. En esta sesión se usa `PORT=3001` localmente para preservar otro servicio existente en el puerto 3000. Compose conecta la API al servicio `db`; la búsqueda ya consulta PostgreSQL con pg y el resto de los CDU sigue pendiente.

`database.sql` se monta solo para lectura y se ejecuta únicamente al inicializar un volumen vacío. PostgreSQL 18 conserva datos en el volumen montado en `/var/lib/postgresql`. `docker compose down` detiene los servicios y conserva ese volumen.

## Búsqueda de instrumentos

`GET /instruments?query=...` busca una subcadena literal, sin distinguir mayúsculas, en `ticker` o `name` de instrumentos `ACCIONES`. Devuelve un array con `id`, `ticker` y `name`, ordenado por ticker e id; no consulta `marketdata` y no incluye ARS/MONEDA.

```sh
curl 'http://127.0.0.1:3000/instruments?query=pamp'
# [{"id":47,"ticker":"PAMP","name":"Pampa Holding S.A."}]
```

La entrada debe ser un único valor textual de 1 a 255 caracteres Unicode después de `trim`; ausencia, vacío, espacios, listas, objetos, parámetros repetidos o exceso devuelven 400 con un mensaje genérico. Sin coincidencias devuelve 200 y `[]`. Un fallo técnico devuelve 500 con mensaje genérico y diagnóstico solo en los logs.

## Pruebas

Unitarias aisladas, sin PostgreSQL ni aplicación HTTP real:

```sh
npm run test:unit
npm run test:typecheck
```

La suite unitaria cubre servicio/CDU, controller, pipe/DTO, filtro HTTP, persistencia con cliente pg falso, configuración, ciclo de vida del pool y diagnósticos. Resultado con Node 24.22.1: 8 archivos y 53 pruebas.

Integración PostgreSQL y pruebas HTTP, con la base de pruebas efímera:

```sh
docker compose --profile test up -d --wait db-test
npm run test:integration
npm run test:http
npm test
```

`npm test` ejecuta la suite completa: 11 archivos y 99 pruebas (53 unitarias, 15 de integración y 31 HTTP). La integración y las pruebas HTTP con base real usan `db-test` en `127.0.0.1:5433`, base `cocos_test`, y rechazan cualquier otro nombre de base para no caer en desarrollo. Se puede cambiar el host o el puerto con `TEST_PGHOST` y `PGTESTPORT`, y las credenciales con `TEST_PGUSER` y `TEST_PGPASSWORD`. Las pruebas insertan fixtures con identificadores propios y los eliminan al terminar; el seed original no se modifica.

Los fallos técnicos registran solo operación, clase y código permitidos y una descripción estática; no registran mensajes arbitrarios del driver, credenciales ni valores de solicitud.

## Verificación nativa

Con Node 24.22.1, sin necesitar un servidor de base para este arranque mínimo:

```sh
npm ci --ignore-scripts
npm run typecheck
npm run build
PORT=3002 npm start
```

Se usa otro puerto libre para no colisionar con Compose. Se valida `PORT` al iniciar y se activa el cierre por señales, incluido el cierre del pool de PostgreSQL. La búsqueda tiene pruebas unitarias aisladas, integración pg y HTTP; la integración y las pruebas con base requieren `db-test`. La comprobación de arranque no equivale a validación funcional de los CDU pendientes.

La verificación Docker de esta sesión utilizó el perfil existente de Colima y plugins temporales Compose 5.6.1/Buildx 0.38.1, sin instalarlos globalmente ni cambiar el contexto activo. Con Colima, se puede elegir el motor por comando con `DOCKER_CONTEXT=colima`; los plugins deben estar disponibles en el CLI para usar los comandos anteriores. Resultados de validación en el plan.

## Follow-ups

- Evaluar riesgos del redondeo monetario y costo de preservar mayor precisión histórica y futura; por ahora se mantiene escala 2. [Detalle](docs/backend-features.spec#evidencia-sobre-la-precisión-histórica-y-costo-de-preservarla).
