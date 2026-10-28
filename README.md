# Challenge backend de Cocos

Objetivo: preparar una API REST de portfolio, búsqueda de activos y envío de órdenes según la [consigna backend](backend-challenge.md), tomada del [repositorio original](https://github.com/cocoscap/cocos-challenge).

**Estado: búsqueda de instrumentos, base interna de recursos de cuenta, lectura interna de última cotización y unidad transaccional por cuenta implementadas.** NestJS con Express y TypeScript estricto, dependencias fijadas, Docker Compose para ejecución local y `GET /instruments?query=...` conectado a PostgreSQL mediante pg. B02 calcula internamente efectivo contable, tenencias ejecutadas, reservas `NEW` y recursos disponibles con acumulados decimales exactos; no expone un endpoint de portfolio. B03 lee internamente la última fila de `marketdata` por instrumento sin exponerla ni calcular rendimientos. B04-A agrega el puerto transaccional por cuenta y su adapter pg, con READ COMMITTED explícito, bloqueo inicial de la fila del usuario y un mismo cliente hasta COMMIT/ROLLBACK; no implementa envío de órdenes, idempotencia ni reintentos. Portfolio público, envío y cancelación de órdenes siguen sin implementarse. La raíz `/` responde 404.

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

Por defecto la API se publica en `127.0.0.1:3000` y PostgreSQL en `127.0.0.1:5432`. [.env.example](.env.example) contiene valores locales opcionales para cambiar puertos y credenciales mediante `.env`. En esta sesión se usa `PORT=3001` localmente para preservar otro servicio existente en el puerto 3000. Compose conecta la API al servicio `db`; la búsqueda y las bases internas de recursos, cotizaciones y transacciones consultan PostgreSQL con pg. Portfolio, envío y cancelación siguen pendientes.

`database.sql` se monta solo para lectura y se ejecuta únicamente al inicializar un volumen vacío. PostgreSQL 18 conserva datos en el volumen montado en `/var/lib/postgresql`. `docker compose down` detiene los servicios y conserva ese volumen.

## Búsqueda de instrumentos

`GET /instruments?query=...` busca una subcadena literal, sin distinguir mayúsculas, en `ticker` o `name` de instrumentos `ACCIONES`. Devuelve un array con `id`, `ticker` y `name`, ordenado por ticker e id; no consulta `marketdata` y no incluye ARS/MONEDA.

```sh
curl 'http://127.0.0.1:3000/instruments?query=pamp'
# [{"id":47,"ticker":"PAMP","name":"Pampa Holding S.A."}]
```

La entrada debe ser un único valor textual de 1 a 255 caracteres Unicode después de `trim`; ausencia, vacío, espacios, listas, objetos, parámetros repetidos o exceso devuelven 400 con un mensaje genérico. Sin coincidencias devuelve 200 y `[]`. Un fallo técnico devuelve 500 con mensaje genérico y diagnóstico solo en los logs.

## Recursos internos de cuenta

B02 calcula, desde las órdenes de una cuenta, efectivo contable, tenencias ejecutadas, reservas de órdenes `NEW` y recursos disponibles. El cálculo es decimal y no modifica órdenes ni el seed. Con los datos provistos obtiene efectivo contable `753000.00`, reservas de compra `125500.00` y disponible `627500.00`, conservando la tenencia negativa del instrumento 31. No hay controller, ruta ni respuesta HTTP para esta base; portfolio, valuación, costo y presentación siguen pendientes.

## Cotizaciones internas

B03 agrega un puerto de lectura de la última cotización por instrumento. Selecciona la mayor `date` no nula y, ante empate, el mayor `id`; conserva `close` y `previousClose` de esa misma fila como texto decimal, incluidos nulos, sin retroceder a otra fila ni validar precios. La ausencia de fila se representa internamente como `null` y un fallo de lectura se propaga. La ordenación usa la columna `DATE` nativa, no el texto de calendario proyectado; una regresión con `9999-12-31` y `10000-01-01` verifica el caso. No hay endpoint, consumidor de portfolio u órdenes, cálculo de retorno ni regla de MARKET.

## Unidad transaccional por cuenta

B04-A implementa `AccountTransactionRunner` y su adapter pg. Cada invocación adquiere un cliente del pool existente, ejecuta `BEGIN TRANSACTION ISOLATION LEVEL READ COMMITTED`, bloquea la fila de `users` en un statement separado con `SELECT ... FOR UPDATE` y solo después invoca el trabajo. Todas las lecturas del contexto usan ese mismo cliente; el bloqueo se mantiene hasta `COMMIT` o `ROLLBACK`.

El contexto expone `userId`, `accountMovements` y `latestQuotes`, construidos por ejecución sobre el cliente transaccional. No expone `PoolClient`, SQL libre ni entidades de persistencia, no reemplaza los providers singleton y no consulta cotizaciones de forma obligatoria. Una cuenta inexistente devuelve internamente `account-not-found` sin ejecutar el trabajo; la traducción HTTP queda pendiente.

Se realiza un único intento. El runner solo devuelve `committed` cuando `QueryResult.command` confirma `COMMIT`. Si PostgreSQL responde `ROLLBACK` al COMMIT, rechaza con `commitOutcome: 'rolled-back'` y `commitCommand: 'ROLLBACK'`, sin devolver el valor del trabajo. Un comando inesperado o un fallo al ejecutar COMMIT se representa como `uncertain`; no se afirma rollback seguro. Si el trabajo falla, se intenta `ROLLBACK` y se conserva la causa original; si el rollback o la liberación fallan, se exponen `rollbackError` y `releaseError`. No hay endpoints, envío/cancelación, migraciones, reintentos automáticos, backoff ni timeouts nuevos.

Corrección B04-A-R1: se comprueba la confirmación efectiva de `QueryResult.command`, se distingue el rollback conocido del COMMIT incierto y el escenario concurrente libera y espera las operaciones iniciadas también ante una falla controlada, preservando el error original. B04-A/B04-A-R1 aceptados tras revisión independiente con tipos, build y 169 pruebas aprobadas en Node 24.22.1; el usuario autorizó su único commit local, sin publicación. Detalle en el [plan](docs/plan.md#corrección-b04-a-r1--confirmación-efectiva-y-limpieza).

## Pruebas

Unitarias aisladas, sin PostgreSQL ni aplicación HTTP real:

```sh
npm run test:unit
npm run test:typecheck
```

La suite unitaria cubre servicio/CDU, controller, pipe/DTO, filtro HTTP, persistencia con cliente pg falso, configuración, ciclo de vida del pool y diagnósticos, además del cálculo de recursos, sus adapters pg y el ciclo transaccional por cuenta. Resultado con Node 24.22.1: 13 archivos y 98 pruebas.

Integración PostgreSQL y pruebas HTTP, con la base de pruebas efímera:

```sh
docker compose --profile test up -d --wait db-test
npm run test:integration
npm run test:http
npm test
```

`npm test` ejecuta la suite completa: 19 archivos y 169 pruebas (98 unitarias, 40 de integración y 31 HTTP). La integración y las pruebas HTTP con base real usan `db-test` en `127.0.0.1:5433`, base `cocos_test`, y rechazan cualquier otro nombre de base para no caer en desarrollo. Se puede cambiar el host o el puerto con `TEST_PGHOST` y `PGTESTPORT`, y las credenciales con `TEST_PGUSER` y `TEST_PGPASSWORD`. Las pruebas insertan fixtures con identificadores propios y los eliminan al terminar; el seed original no se modifica. Las pruebas transaccionales verifican aislamiento, cliente compartido, serialización por cuenta, progreso de cuentas distintas, confirmación efectiva, rollback conocido y limpieza ante fallos.

Los fallos técnicos registran solo operación, clase y código permitidos y una descripción estática; no registran mensajes arbitrarios del driver, credenciales ni valores de solicitud.

## Verificación nativa

Con Node 24.22.1, sin necesitar un servidor de base para este arranque mínimo:

```sh
npm ci --ignore-scripts
npm run typecheck
npm run build
PORT=3002 npm start
```

Se usa otro puerto libre para no colisionar con Compose. Se valida `PORT` al iniciar y se activa el cierre por señales, incluido el cierre del pool de PostgreSQL. La búsqueda, el cálculo interno de recursos, la lectura de cotizaciones y la unidad transaccional tienen pruebas unitarias aisladas e integración pg; la búsqueda además tiene pruebas HTTP. La integración y las pruebas con base requieren `db-test`. La comprobación de arranque no equivale a validación funcional de los CDU pendientes.

La verificación Docker de esta sesión utilizó el perfil existente de Colima y plugins temporales Compose 5.6.1/Buildx 0.38.1, sin instalarlos globalmente ni cambiar el contexto activo. Con Colima, se puede elegir el motor por comando con `DOCKER_CONTEXT=colima`; los plugins deben estar disponibles en el CLI para usar los comandos anteriores. Resultados de validación en el plan.

## Follow-ups

- Evaluar riesgos del redondeo monetario y costo de preservar mayor precisión histórica y futura; por ahora se mantiene escala 2. [Detalle](docs/backend-features.spec#evidencia-sobre-la-precisión-histórica-y-costo-de-preservarla).
