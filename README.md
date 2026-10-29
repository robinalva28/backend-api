# Challenge backend de Cocos

Objetivo: preparar una API REST de portfolio, búsqueda de activos y envío de órdenes según la [consigna backend](backend-challenge.md), tomada del [repositorio original](https://github.com/cocoscap/cocos-challenge).

**Estado: búsqueda de instrumentos, base interna de recursos de cuenta, lectura interna de última cotización, unidad transaccional por cuenta, migración de identidad idempotente en `orders`, componente interno de intención original, lectura interna de órdenes por clave, escritura atómica de órdenes preparadas y CDU interno de envío de un intento implementados.** NestJS con Express y TypeScript estricto, dependencias fijadas, Docker Compose para ejecución local y `GET /instruments?query=...` conectado a PostgreSQL mediante pg. B02 calcula internamente efectivo contable, tenencias ejecutadas, reservas `NEW` y recursos disponibles con acumulados decimales exactos; no expone un endpoint de portfolio. B03 lee internamente la última fila de `marketdata` por instrumento sin exponerla ni calcular rendimientos. B04-A agrega el puerto transaccional por cuenta y su adapter pg, con READ COMMITTED explícito, bloqueo inicial de la fila del usuario y un mismo cliente hasta COMMIT/ROLLBACK. B04-B agrega la migración aditiva de identidad idempotente en `orders`: columnas anulables `idempotency_key` (UUID) e `idempotency_metadata` (JSONB), presencia conjunta, contenedor versionado y unicidad por usuario/clave. B04-C agrega el modelo puro de intención original, normalización decimal y comparación semántica v1. B04-D agrega la lectura interna de una orden por usuario/UUID y la resolución de reenvíos como ausencia, coincidencia o conflicto dentro del callback transaccional. B04-E agrega la escritura de una orden ya preparada, conservando UUID y metadatos originales en la misma transacción. B05-A agrega el CDU interno de envío de un intento, con lectura mínima de instrumento, reloj sustituible, selección de precio, conversión exacta por monto, validación de recursos y persistencia de FILLED/NEW/REJECTED. No implementa HTTP, cancelación, recuperación automática ni reintentos. Portfolio público, endpoint de envío y cancelación de órdenes siguen sin implementarse. La raíz `/` responde 404.

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

Por defecto la API se publica en `127.0.0.1:3000` y PostgreSQL en `127.0.0.1:5432`. [.env.example](.env.example) contiene valores locales opcionales para cambiar puertos y credenciales mediante `.env`. En esta sesión se usa `PORT=3001` localmente para preservar otro servicio existente en el puerto 3000. Compose conecta la API al servicio `db`; la búsqueda y las bases internas de recursos, cotizaciones y transacciones consultan PostgreSQL con pg. Portfolio, endpoint de envío y cancelación siguen pendientes; el CDU interno de envío no tiene ruta HTTP.

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

## Migración de identidad idempotente en orders

B04-B prepara el esquema para conservar la identidad y los parámetros originales de una orden. La migración es aditiva y no completa la idempotencia. Agrega:

- `idempotency_key UUID NULL`.
- `idempotency_metadata JSONB NULL`.

Ambas columnas son nulas en las filas históricas. La constraint `orders_idempotency_pair_check` exige que clave y metadatos estén presentes juntos, y que una fila con identidad tenga `userid`. La constraint `orders_idempotency_metadata_check` exige un objeto versionado. La constraint `orders_user_idempotency_key_unique` aplica unicidad sobre `(userid, idempotency_key)`; los NULL históricos no colisionan y una misma clave puede existir en cuentas distintas.

El contenedor mínimo es:

```json
{"version": 1, "parameters": {"price": "10.10", "amount": "100.00"}}
```

`version` es un entero positivo que identifica el formato. `parameters` es un objeto abierto: su estructura semántica completa, la comparación de intenciones y la compatibilidad de reenvíos quedan para los bloques correspondientes. Los valores decimales dentro de `parameters` deben guardarse como strings; la migración conserva esos strings, pero no puede validar por sí sola todos los campos de un objeto abierto.

La migración no se ejecuta al iniciar la aplicación. Se aplica manualmente con una única transacción y detención ante errores:

```sh
docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -1 -f -' \
  < db/migrations/20261028-b04b-order-idempotency.sql
```

Para la base de pruebas efímera:

```sh
docker compose --profile test exec -T db-test sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -1 -f -' \
  < db/migrations/20261028-b04b-order-idempotency.sql
```

Si el CLI no tiene el plugin `docker compose`, usar `docker-compose` con el mismo comando. El flag `-1` es obligatorio: agrupa el `LOCK TABLE`, las verificaciones y el DDL en una sola transacción. Sin él, un error podría dejar cambios parciales.

Comportamiento documentado:

- **Primera ejecución:** agrega las columnas y constraints; las filas históricas quedan con SQL NULL y conservan todos sus valores originales.
- **Segunda ejecución:** verifica tipos, nulabilidad, ausencia de defaults y constraints; si coinciden, no cambia nada.
- **Esquema previo incompatible:** eleva una excepción con el detalle del desajuste y la transacción revierte. No se usa `IF NOT EXISTS` para ocultar incompatibilidades.

Corrección B04-B-R1/R2: la segunda ejecución compara exactamente la representación canónica de `pg_get_constraintdef`, sin normalizar espacios ni alterar literales SQL, y verifica las columnas y el estado de validación/efectividad de las constraints. Rechaza `UNIQUE` con columnas extra, expresiones `CHECK` debilitadas con `OR true`, constraints `NOT VALID` y claves JSON alteradas como `'ver sion'` o `'para meters'`, sin reparar el esquema. B04-B/R1/R2 aceptados tras revisión independiente con 197 pruebas aprobadas; el usuario autorizó su único commit local, sin publicación. Detalle en el [plan](docs/plan.md#corrección-b04-b-r2--literales-preservados).

Después de inicializar una base desde `database.sql` con `docker compose up --build --wait` (o el arranque equivalente de `db-test`), la migración se aplica con el comando anterior. En esta validación se ejecutó solo contra `db-test`; no se aplicó a desarrollo. La nulabilidad conserva el histórico, pero no obliga por sí sola a los escritores futuros a enviar identidad: el futuro API deberá exigir clave y metadatos. La unicidad por sí sola no aporta recuperación, comparación ni disponibilidad. Detalle de decisiones y evidencia en el [plan](docs/plan.md#implementación-y-validación-b04-b).

## Intención original de órdenes

B04-C implementa un componente puro en `src/orders/domain` para representar la intención original, normalizar sus valores decimales y comparar dos intenciones sin HTTP, NestJS, SQL o persistencia:

- `createOrderIntent` valida instrumento, BUY/SELL, MARKET/LIMIT, exactamente uno entre `size` y `amount`, positividad, acciones enteras y máximo dos decimales efectivos.
- `OrderIntent` conserva `instrumentId`, `side`, `type`, `mode`, `size`, `amount` y `limitPrice`. `limitPrice` solo existe para LIMIT; MARKET no incorpora `close`.
- Los valores canónicos son strings sin exponente y sin redondeo: `10`, `10.0` y `10.00` se normalizan a `"10"`. `size` y `amount` siguen siendo modos distintos aunque compartan el mismo valor.
- `buildOrderIntentMetadata` produce el contenedor `{ "version": 1, "parameters": ... }` con la forma técnica v1; `readOrderIntentMetadata` valida y reconstruye la intención.
- `orderIntentsEqual` compara instrumento, side, tipo, modo, valor y precio LIMIT de forma explícita. No depende de la serialización JSON ni del orden de propiedades.
- Metadatos incompletos, inválidos o de versión desconocida producen `OrderIntentError` con código interno; no se convierten en coincidencia, conflicto ni autorización para crear otra orden.

Ejemplo de metadatos v1 para una LIMIT por cantidad:

```json
{
  "version": 1,
  "parameters": {
    "instrumentId": 47,
    "side": "BUY",
    "type": "LIMIT",
    "mode": "size",
    "size": "10",
    "limitPrice": "10.1"
  }
}
```

La normalización usa `decimal.js` con una configuración local derivada del valor; no modifica la configuración global, no convierte importes a `Number` y conserva valores grandes exactos. La sintaxis léxica de la entrada HTTP, los exponentes, los ceros finales escritos, los rangos nuevos, las divisiones y el redondeo de presentación siguen abiertos en Q02/Q03: este componente no define el contrato HTTP. Tampoco incluye cantidad derivada por conversión, estado, disponibilidad, reservas, ejecución ni recuperación.

B04-C aceptado tras revisión independiente y versionado en `87f2276`: tipos de aplicación/pruebas, build y 172 unitarias aprobadas con Node 24.22.1, sin servicios externos. B04-D agrega la lectura persistida por clave y la resolución interna de reenvíos, validada localmente. La creación de órdenes y el comportamiento HTTP de órdenes todavía no están implementados.

## Lectura de órdenes por clave y reenvíos

B04-D agrega `PersistedOrderRepository.findByUserIdAndIdempotencyKey`, el modelo `PersistedOrder` y el adapter `PostgresPersistedOrderRepository`. La consulta está parametrizada por `userid` e `idempotency_key`, no filtra por estado y mapea `id`, usuario, clave, estado actual y metadatos JSONB sin interpretar importes con `Number`.

La capacidad `persistedOrders` se incorpora al `AccountTransactionContext` de B04-A y se construye por ejecución sobre el mismo cliente. El resolvedor debe invocarse dentro del callback bloqueado usando ese repositorio del contexto; no adquiere el bloqueo por sí solo ni abre otra transacción. Esa composición conserva el mismo cliente y permite continuar el trabajo dentro de la sección crítica. `resolveOrderReplay` usa B04-C y devuelve internamente:

- `absent`: no hay fila para esa cuenta y clave bajo el bloqueo actual; no crea nada.
- `match`: la intención persistida coincide y devuelve la orden con su estado actual, incluidos `NEW`, `FILLED`, `REJECTED` y `CANCELLED`.
- `conflict`: la intención es distinta; no sobrescribe la orden ni devuelve un permiso de creación.

Metadatos inválidos o de versión desconocida y fallos técnicos se propagan como errores internos; nunca se convierten en ausencia, coincidencia o conflicto. Recuperar no consulta cotización ni disponibilidad, no recalcula cantidad/precio y no reabre una orden cancelada. La ausencia solo es válida dentro del callback protegido: una futura creación deberá continuar en esa misma transacción, no después de ella. No hay endpoint ni traducción HTTP en este bloque.

B04-D aceptado tras revisión independiente y versionado en `314d8f9`; no completa creación de órdenes, HTTP ni recuperación automática.

## Escritura atómica de una orden preparada

B04-E agrega `PreparedOrder`, `createPreparedOrder`, el puerto `PreparedOrderRepository.insert` y el adapter `PostgresPreparedOrderRepository`, construido por ejecución con el `userId` y el cliente bloqueado de B04-A. El INSERT incluye las columnas de la orden y, en la misma fila, el UUID y los metadatos v1 generados por B04-C; no usa `ON CONFLICT`, no sobrescribe y no abre otra transacción.

El modelo recibe cantidad final, precio, estado y fecha ya preparados, además de la intención original. Instrumento, side y tipo se derivan del intent canónico. En modo `size` la cantidad final debe coincidir con la intención; en LIMIT el precio debe coincidir con el precio límite. En modo `amount` la cantidad final puede ser la derivada y el `amount` original permanece en los metadatos.

Estados admitidos: `MARKET` `FILLED`/`REJECTED` y `LIMIT` `NEW`/`REJECTED`; `CANCELLED` se rechaza. Un `REJECTED` preparado se persiste sin rollback por su estado. Se validan los límites del esquema —cantidad entera positiva hasta INT; precio positivo con dos decimales y ocho dígitos enteros— sin truncar ni redondear. La fecha se recibe como `YYYY-MM-DDTHH:mm:ss[.fracción]` sin zona y se persiste como `TIMESTAMP`; el bloque no decide reloj ni zona horaria.

Los fallos del INSERT se propagan como `PreparedOrderPersistenceError`, conservando `cause`, `code` y `constraint`. Un 23505 no se convierte en recuperación ni se reintenta. Este bloque no implementa el CDU de envío, selección de cotización, conversión de monto, validación de suficiencia, endpoints ni errores HTTP; B05-A lo compone después.

B04-E aceptado tras revisión independiente con tipos, build y 394 pruebas aprobadas en Node 24.22.1. Debe usarse con el escritor del contexto dentro del callback bloqueado; no adquiere el bloqueo por sí solo. El usuario autorizó su único commit local, sin publicación.

## CDU interno de envío de órdenes

B05-A agrega `SubmitOrderUseCase.execute` y `SubmitOrderService` para un único intento transaccional, sin endpoint HTTP ni reintentos. La entrada es semántica: usuario, UUID, intención canónica existente y moneda opcional. `currency` omitida o `ARS` son equivalentes y solo ARS se admite; otra moneda produce `SubmitOrderError` sin fila ni conversión. La moneda no se agrega a los metadatos v1.

La salida interna es `{ orderId, status, replayed }`. El servicio valida la moneda, canoniza la intención con B04-C y ejecuta el callback de B04-A. Dentro del bloqueo:

1. Resuelve la clave con B04-D. Una coincidencia devuelve la orden en su estado actual, incluidos `CANCELLED` y `REJECTED`, sin reabrirla; otra intención produce un conflicto tipado sin escritura; metadatos inválidos propagan un error interno.
2. Para una clave nueva, lee el instrumento con `InstrumentReader`/`PostgresInstrumentReader` sobre el mismo cliente y solo admite `ACCIONES`. Inexistente, `MONEDA` u otro tipo produce error tipado sin orden.
3. LIMIT usa su precio original sin consultar cotización. MARKET usa la última fila de B03 y exige `close` finito y positivo; no usa `previousClose` ni retrocede a otra cotización. Ausencia o invalidez no crea orden, reserva ni consume el UUID.
4. Conserva una cantidad explícita o calcula el piso exacto de `amount / price` con enteros derivados de los strings decimales, sin redondeo intermedio ni coma flotante binaria. Cero, cantidad fuera de `INT` o una cantidad calculada no representable produce error sin persistencia.
5. Calcula recursos con B02: BUY requiere cash disponible y SELL acciones disponibles después de reservas `NEW`. Con recursos, MARKET queda `FILLED` y LIMIT `NEW`; sin recursos, ambas quedan `REJECTED` sin ejecución ni reserva. No reduce la cantidad al saldo.
6. Asigna la fecha UTC del servidor después del bloqueo y de identificar una clave nueva, prepara la orden con B04-E y la inserta en el mismo callback. Solo devuelve la salida después de `COMMIT` confirmado; no convierte un COMMIT incierto en rollback ni reintenta.

`SubmitOrderError` distingue `unsupported-currency`, `conflict`, `account-not-found`, `instrument-not-found`, `instrument-not-tradable`, `quote-unavailable`, `quote-invalid` y `quantity-not-representable`. Son errores internos, no códigos HTTP. `Clock`/`SystemClock` permiten sustituir el reloj; `OrdersModule` registra `SUBMIT_ORDER_USE_CASE` y `CLOCK` con tokens y `AppModule` lo importa.

B05-A fue aceptado tras revisión independiente del 2026-10-28: tipos y build correctos, 329 unitarias aisladas y suite completa de 469 pruebas en 34 archivos (109 de integración PostgreSQL y 31 HTTP existentes). Sus pruebas funcionales del CDU con PostgreSQL cubren R14, que pide probar la función de envío; la validación del futuro endpoint HTTP es adicional. El usuario autorizó su único commit local, sin publicación ni commits posteriores; HTTP de envío, cancelación, recuperación automática y reintentos siguen pendientes.

## Pruebas

Unitarias aisladas, sin PostgreSQL ni aplicación HTTP real:

```sh
npm run test:unit
npm run test:typecheck
```

La suite unitaria cubre servicio/CDU, controller, pipe/DTO, filtro HTTP, persistencia con cliente pg falso, configuración, ciclo de vida del pool y diagnósticos, además del cálculo de recursos, sus adapters pg, el ciclo transaccional por cuenta, el modelo puro de intención original, la lectura de órdenes por clave, la escritura de órdenes preparadas, el CDU de envío, sus errores, el piso exacto, la fecha UTC y la lectura mínima de instrumento. Resultado con Node 24.22.1: 24 archivos y 329 pruebas.

Integración PostgreSQL y pruebas HTTP, con la base de pruebas efímera:

```sh
docker compose --profile test up -d --wait db-test
npm run test:integration
npm run test:http
npm test
```

`npm test` ejecuta la suite completa: 34 archivos y 469 pruebas (329 unitarias, 109 de integración y 31 HTTP). La integración y las pruebas HTTP con base real usan `db-test` en `127.0.0.1:5433`, base `cocos_test`, y rechazan cualquier otro nombre de base para no caer en desarrollo. Se puede cambiar el host o el puerto con `TEST_PGHOST` y `PGTESTPORT`, y las credenciales con `TEST_PGUSER` y `TEST_PGPASSWORD`. Las pruebas insertan fixtures con identificadores propios y los eliminan al terminar; el seed original no se modifica. Las pruebas transaccionales verifican aislamiento, cliente compartido, serialización por cuenta, progreso de cuentas distintas, confirmación efectiva, rollback conocido y limpieza ante fallos. Las 28 pruebas de migración aplican la SQL dentro de transacciones revertidas y comprueban el histórico, las constraints, el contenedor versionado, los decimales como strings, la segunda ejecución, la firma canónica exacta, las propiedades de validación y el fallo seguro ante incompatibilidad, literales alterados o estado incompleto. La integración B04-D usa un esquema exclusivo, aplica allí la migración y lo elimina al finalizar, sin modificar el esquema público ni el seed compartido. La integración B04-E carga `database.sql` intacto en el esquema exclusivo `b04e_test`, aplica la migración B04-B, verifica atomicidad, unicidad, concurrencia y efectos B02, y elimina el esquema al finalizar. La integración B05-A usa `b05a_test` con el SQL original y la migración B04-B para cubrir BUY/SELL, MARKET/LIMIT, size/amount, límites del piso exacto, insuficiencia y reservas, REJECTED sin efectos, cotización ausente/inválida sin fallback, LIMIT sin cotización, instrumento inválido, ARS por defecto, reenvíos, conflicto, concurrencia y rollback; elimina el esquema al finalizar.

Los fallos técnicos registran solo operación, clase y código permitidos y una descripción estática; no registran mensajes arbitrarios del driver, credenciales ni valores de solicitud.

## Verificación nativa

Con Node 24.22.1, sin necesitar un servidor de base para este arranque mínimo:

```sh
npm ci --ignore-scripts
npm run typecheck
npm run build
PORT=3002 npm start
```

Se usa otro puerto libre para no colisionar con Compose. Se valida `PORT` al iniciar y se activa el cierre por señales, incluido el cierre del pool de PostgreSQL. La búsqueda, el cálculo interno de recursos, la lectura de cotizaciones, la unidad transaccional, la intención original, la lectura por clave, la escritura preparada y el CDU interno de envío tienen pruebas unitarias aisladas e integración pg donde corresponde; la búsqueda además tiene pruebas HTTP. La migración B04-B se valida con integración PostgreSQL; no se agregaron unitarias para SQL sin lógica de script. La integración y las pruebas con base requieren `db-test`. La comprobación de arranque no equivale a validación funcional de los CDU pendientes ni del endpoint de envío.

La verificación Docker de esta sesión utilizó el perfil existente de Colima y plugins temporales Compose 5.6.1/Buildx 0.38.1, sin instalarlos globalmente ni cambiar el contexto activo. Con Colima, se puede elegir el motor por comando con `DOCKER_CONTEXT=colima`; los plugins deben estar disponibles en el CLI para usar los comandos anteriores. Resultados de validación en el plan.

## Follow-ups

- Evaluar riesgos del redondeo monetario y costo de preservar mayor precisión histórica y futura; por ahora se mantiene escala 2. [Detalle](docs/backend-features.spec#evidencia-sobre-la-precisión-histórica-y-costo-de-preservarla).
