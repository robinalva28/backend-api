# Challenge backend de Cocos

Objetivo: preparar una API REST de portfolio, búsqueda de activos y envío de órdenes según la [consigna backend](backend-challenge.md), tomada del [repositorio original](https://github.com/cocoscap/cocos-challenge).

**Estado: búsqueda de instrumentos, base interna de recursos de cuenta, lectura interna de última cotización, unidad transaccional por cuenta, migración de identidad idempotente en `orders`, componente interno de intención original, lectura interna de órdenes por clave, escritura atómica de órdenes preparadas, CDU interno de envío de un intento, reintentos acotados del envío, CDU interno de cancelación, endpoint HTTP de envío, endpoint HTTP de cancelación y endpoint HTTP de portfolio implementados.** NestJS con Express y TypeScript estricto, dependencias fijadas, Docker Compose para ejecución local, `GET /instruments?query=...`, `GET /users/:userId/portfolio`, `POST /users/:userId/orders` y `POST /users/:userId/orders/:orderId/cancel` conectados a PostgreSQL mediante pg. B02 calcula internamente efectivo contable, tenencias ejecutadas, reservas `NEW` y recursos disponibles con acumulados decimales exactos; no expone un endpoint de portfolio. B03 lee internamente la última fila de `marketdata` por instrumento sin exponerla ni calcular rendimientos. B04-A agrega el puerto transaccional por cuenta y su adapter pg, con READ COMMITTED explícito, bloqueo inicial de la fila del usuario y un mismo cliente hasta COMMIT/ROLLBACK. B04-B agrega la migración aditiva de identidad idempotente en `orders`: columnas anulables `idempotency_key` (UUID) e `idempotency_metadata` (JSONB), presencia conjunta, contenedor versionado y unicidad por usuario/clave. B04-C agrega el modelo puro de intención original, normalización decimal y comparación semántica v1. B04-D agrega la lectura interna de una orden por usuario/UUID y la resolución de reenvíos como ausencia, coincidencia o conflicto dentro del callback transaccional. B04-E agrega la escritura de una orden ya preparada, conservando UUID y metadatos originales en la misma transacción. B05-A agrega el CDU interno de envío de un intento, con lectura mínima de instrumento, reloj sustituible, selección de precio, conversión exacta por monto, validación de recursos y persistencia de FILLED/NEW/REJECTED. B06-A agrega el CDU interno de cancelación, con lectura por usuario/orden, transición condicional NEW → CANCELLED y liberación de reservas derivada del estado. B06-B expone ese CDU mediante el endpoint HTTP de cancelación, con validación léxica de identificadores, rechazo de body y traducción exacta de errores. B05-C expone el CDU de envío mediante `POST /users/:userId/orders`, con validación de ruta, `Idempotency-Key` y body, proyección mínima y traducción exacta de errores. B07-A agrega el dominio y el CDU internos de portfolio, con un contrato de lectura consistente y pruebas unitarias aisladas. B07-B agrega la lectura PostgreSQL de solo lectura, la composición Nest y `GET /users/:userId/portfolio`. B08-A agrega reintentos acotados solo para el envío ante SQLSTATE `40001`/`40P01` elegibles, con hasta cuatro intentos y esperas 50/100/200 ms, sin cambiar endpoints ni contratos. No se implementan autenticación, recuperación automática de COMMIT incierto, reintentos de conexión ni timeouts; la cancelación, el portfolio y la búsqueda no reintentan. Las garantías restantes de Q04 siguen fuera de este alcance. La raíz `/` responde 404.

- [Consigna original](backend-challenge.md) y [base de datos provista](database.sql).
- [Requisitos y criterios de aceptación](docs/requisitos.md).
- [Plan, decisiones, pendientes y flujo de entrega](docs/plan.md).
- [Especificación SDD parcial](docs/backend-features.spec).
- [Reglas de trabajo y registro de sesiones](AGENTS.md).

Los Markdown de otros challenges se conservan sin cambios por instrucción del usuario. El alcance de este trabajo se limita al backend.

**Revisión B08-A:** aceptado tras revisión independiente con tipos, build y 1192 pruebas aprobadas (794 unitarias, 134 integración y 264 HTTP). La política conserva sus exclusiones y el seed quedó intacto. El usuario autorizó un único commit local de B08-A, sin publicación; Q04 sigue abierto en lo no cubierto.

## Ejecución con Docker

Requiere un motor Docker activo y los plugins Compose y Buildx. [Dockerfile](Dockerfile) usa Node 24.22.1 LTS; [compose.yaml](compose.yaml) fija PostgreSQL 18.6. Las dependencias npm y sus resoluciones están en [package.json](package.json) y [package-lock.json](package-lock.json).

```sh
docker compose config --quiet
docker compose up --build --wait
```

Por defecto la API se publica en `127.0.0.1:3000` y PostgreSQL en `127.0.0.1:5432`. [.env.example](.env.example) contiene valores locales opcionales para cambiar puertos y credenciales mediante `.env`. En esta sesión se usa `PORT=3001` localmente para preservar otro servicio existente en el puerto 3000. Compose conecta la API al servicio `db`; la búsqueda, portfolio, el envío, la cancelación y las bases internas de recursos, cotizaciones y transacciones consultan PostgreSQL con pg. Portfolio ya tiene ruta HTTP; su lectura usa una transacción de solo lectura y no bloquea la cuenta. El envío y la cancelación también tienen rutas HTTP.

`database.sql` se monta solo para lectura y se ejecuta únicamente al inicializar un volumen vacío. PostgreSQL 18 conserva datos en el volumen montado en `/var/lib/postgresql`. `docker compose down` detiene los servicios y conserva ese volumen.

## Búsqueda de instrumentos

`GET /instruments?query=...` busca una subcadena literal, sin distinguir mayúsculas, en `ticker` o `name` de instrumentos `ACCIONES`. Devuelve un array con `id`, `ticker` y `name`, ordenado por ticker e id; no consulta `marketdata` y no incluye ARS/MONEDA.

```sh
curl 'http://127.0.0.1:3000/instruments?query=pamp'
# [{"id":47,"ticker":"PAMP","name":"Pampa Holding S.A."}]
```

La entrada debe ser un único valor textual de 1 a 255 caracteres Unicode después de `trim`; ausencia, vacío, espacios, listas, objetos, parámetros repetidos o exceso devuelven 400 con un mensaje genérico. Sin coincidencias devuelve 200 y `[]`. Un fallo técnico devuelve 500 con mensaje genérico y diagnóstico solo en los logs.

## Recursos internos de cuenta

B02 calcula, desde las órdenes de una cuenta, efectivo contable, tenencias ejecutadas, reservas de órdenes `NEW` y recursos disponibles. El cálculo es decimal y no modifica órdenes ni el seed. Con los datos provistos obtiene efectivo contable `753000.00`, reservas de compra `125500.00` y disponible `627500.00`, conservando la tenencia negativa del instrumento 31. No tiene controller propio; B07-A reutiliza el cálculo para portfolio y B07-B lo expone mediante `GET /users/:userId/portfolio`.

## Portfolio

`GET /users/:userId/portfolio` devuelve un objeto directo con `totalValue`, `availableCash` y `positions`. El `userId` de ruta admite solo dígitos ASCII, ceros iniciales y el rango 1–2147483647. La respuesta del seed es:

```sh
curl 'http://127.0.0.1:3000/users/1/portfolio'
# {"totalValue":"889756.00","availableCash":"627500.00","positions":[
#   {"instrumentId":31,"ticker":"BMA","name":"Banco Macro S.A.","quantity":-10,
#    "positionValue":"-15028.00","totalReturnPercent":null,"dailyReturnPercent":-1.15},
#   {"instrumentId":47,"ticker":"PAMP","name":"Pampa Holding S.A.","quantity":40,
#    "positionValue":"37034.00","totalReturnPercent":-0.45,"dailyReturnPercent":0.44},
#   {"instrumentId":54,"ticker":"METR","name":"MetroGAS S.A.","quantity":500,
#    "positionValue":"114750.00","totalReturnPercent":-8.2,"dailyReturnPercent":-1.08}]}
```

B07-A implementa el cálculo puro y el CDU interno. Reutiliza `calculateAccountResources` de B02 para efectivo contable, reservas y cantidades ejecutadas. El costo medio y los retornos se calculan como fracciones racionales exactas con `bigint`: una venta parcial válida conserva `C / Q` y una compra posterior actualiza la fracción sin aproximaciones. Los importes usan `decimal.js` para productos y acumulaciones finitos. La presentación usa `ROUND_HALF_UP` explícito: importes con dos decimales y porcentajes redondeados a dos decimales desde la fracción exacta, sin epsilon. Las posiciones se derivan de ejecuciones `FILLED`, se ordenan por `instrumentId` y conservan cantidades negativas como D03 con rendimiento total `null`.

B07-B implementa `PostgresPortfolioSnapshotRepository`: adquiere un cliente del pool, abre `REPEATABLE READ READ ONLY` y lee con ese mismo cliente la existencia del usuario, todos sus movimientos, los metadatos de instrumentos con ejecuciones y la última cotización por instrumento. Los movimientos se ordenan por la columna `TIMESTAMP` nativa y luego por `id`; el timestamp se proyecta como texto con microsegundos. La cotización usa `DISTINCT ON` por la columna `DATE` nativa no nula y el mayor `id` ante empate, sin retroceder si el `close` seleccionado es inválido. La transacción termina con `COMMIT` o `ROLLBACK` y el cliente se libera o descarta en éxito y error. No bloquea la fila del usuario, no usa el runner B04-A y no escribe datos.

El controller valida la ruta antes de invocar el CDU y traduce 400 `Invalid request.`, 404 `User not found.` y 500 `Portfolio could not be retrieved.` con diagnóstico interno sanitizado. Un escape de URL malformado en esta ruta devuelve el 400 genérico antes del router, también en request-targets absolutos. No exige `Idempotency-Key` ni restringe body, query o cabeceras.

**Revisión B07-A:** B07-A/R1 aceptado tras revisión independiente y versionado en `160efc4`, con tipos, build y 686 unitarias aprobadas. B07-A-R1 corrigió el redondeo tras ventas parciales. Los casos exactos +0.005% y −0.005% ahora presentan +0.01 y −0.01 mediante costo y retornos racionales exactos, sin epsilon ni tolerancia. Nuevas regresiones cubren ambos empates y valores inmediatamente a cada lado. Detalle en el spec y el plan.

**Validación B07-B:** implementada y validada localmente el 2026-10-29, sin commit. Se agregaron unitarias aisladas del adapter y su ciclo transaccional, controller, filtro, validación de ruta y middleware de escapes; pruebas HTTP con doble tipado y pruebas HTTP con PostgreSQL aislado. La integración demuestra el snapshot completo anterior ante un escritor que confirma entre movimientos y cotización, sin bloquear la cuenta. Con Node 24.22.1 pasaron tipos de aplicación y pruebas, build y una ejecución completa de 63 archivos y 1134 pruebas (745 unitarias, 129 de integración y 260 HTTP). Los esquemas `b07b_test` y `b07b_http_test` se eliminaron y el seed público conservó 4 usuarios, 66 instrumentos, 11 órdenes y 126 cotizaciones.

**Revisión B07-B:** B07-B/R1 aceptado tras revisión independiente el 2026-10-29; pendiente de commit. R1 pasó tipos, build, 767 unitarias y 198 HTTP sin base, conservando la validación PostgreSQL previa de B07-B sin repetirla. La revisión independiente de B07-B aprobó tipos, build y 1134 pruebas, pero reprodujo que JSON malformado en GET portfolio conservaba el error técnico del parser. La corrección extrae un filtro global configurable para normalizar ese error en envío y portfolio, sin tocar el parser ni las respuestas de otras rutas. Las entradas malformadas devuelven exactamente `{"message":"Invalid request."}` sin reflejar el body ni invocar el CDU; JSON válido, query y cabeceras mantienen el 200. Detalle en el spec y el plan.

## Cotizaciones internas

B03 agrega un puerto de lectura de la última cotización por instrumento. Selecciona la mayor `date` no nula y, ante empate, el mayor `id`; conserva `close` y `previousClose` de esa misma fila como texto decimal, incluidos nulos, sin retroceder a otra fila ni validar precios. La ausencia de fila se representa internamente como `null` y un fallo de lectura se propaga. La ordenación usa la columna `DATE` nativa, no el texto de calendario proyectado; una regresión con `9999-12-31` y `10000-01-01` verifica el caso. B07-B aplica la misma semántica en una selección batch dentro del snapshot de portfolio; el puerto B03 no tiene consumidor HTTP directo.

## Unidad transaccional por cuenta

B04-A implementa `AccountTransactionRunner` y su adapter pg. Cada invocación adquiere un cliente del pool existente, ejecuta `BEGIN TRANSACTION ISOLATION LEVEL READ COMMITTED`, bloquea la fila de `users` en un statement separado con `SELECT ... FOR UPDATE` y solo después invoca el trabajo. Todas las lecturas del contexto usan ese mismo cliente; el bloqueo se mantiene hasta `COMMIT` o `ROLLBACK`.

El contexto expone `userId`, `accountMovements` y `latestQuotes`, construidos por ejecución sobre el cliente transaccional. No expone `PoolClient`, SQL libre ni entidades de persistencia, no reemplaza los providers singleton y no consulta cotizaciones de forma obligatoria. Una cuenta inexistente devuelve internamente `account-not-found` sin ejecutar el trabajo; la traducción HTTP queda pendiente.

El runner realiza un único intento. El runner solo devuelve `committed` cuando `QueryResult.command` confirma `COMMIT`. Si PostgreSQL responde `ROLLBACK` al COMMIT, rechaza con `commitOutcome: 'rolled-back'` y `commitCommand: 'ROLLBACK'`, sin devolver el valor del trabajo. Un comando inesperado o un fallo al ejecutar COMMIT se representa como `uncertain`; no se afirma rollback seguro. Si el trabajo falla, se intenta `ROLLBACK` y se conserva la causa original; si el rollback o la liberación fallan, se exponen `rollbackError` y `releaseError`. B08-A compone una política de reintentos solo alrededor del envío, sin cambiar este runner compartido ni la cancelación. No hay migraciones nuevas, backoff global ni timeouts.

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

B05-A agrega `SubmitOrderUseCase.execute` y `SubmitOrderService` para un único intento transaccional; B08-A compone la política de reintentos alrededor de ese CDU y el endpoint HTTP lo expone. La entrada es semántica: usuario, UUID, intención canónica existente y moneda opcional. `currency` omitida o `ARS` son equivalentes y solo ARS se admite; otra moneda produce `SubmitOrderError` sin fila ni conversión. La moneda no se agrega a los metadatos v1.

La salida interna es `{ orderId, status, replayed }`. El servicio valida la moneda, canoniza la intención con B04-C y ejecuta el callback de B04-A. Dentro del bloqueo:

1. Resuelve la clave con B04-D. Una coincidencia devuelve la orden en su estado actual, incluidos `CANCELLED` y `REJECTED`, sin reabrirla; otra intención produce un conflicto tipado sin escritura; metadatos inválidos propagan un error interno.
2. Para una clave nueva, lee el instrumento con `InstrumentReader`/`PostgresInstrumentReader` sobre el mismo cliente y solo admite `ACCIONES`. Inexistente, `MONEDA` u otro tipo produce error tipado sin orden.
3. LIMIT usa su precio original sin consultar cotización. MARKET usa la última fila de B03 y exige `close` finito y positivo; no usa `previousClose` ni retrocede a otra cotización. Ausencia o invalidez no crea orden, reserva ni consume el UUID.
4. Conserva una cantidad explícita o calcula el piso exacto de `amount / price` con enteros derivados de los strings decimales, sin redondeo intermedio ni coma flotante binaria. Cero, cantidad fuera de `INT` o una cantidad calculada no representable produce error sin persistencia.
5. Calcula recursos con B02: BUY requiere cash disponible y SELL acciones disponibles después de reservas `NEW`. Con recursos, MARKET queda `FILLED` y LIMIT `NEW`; sin recursos, ambas quedan `REJECTED` sin ejecución ni reserva. No reduce la cantidad al saldo.
6. Asigna la fecha UTC del servidor después del bloqueo y de identificar una clave nueva, prepara la orden con B04-E y la inserta en el mismo callback. Solo devuelve la salida después de `COMMIT` confirmado; no convierte un COMMIT incierto en rollback. Este CDU no reintenta por sí mismo: B08-A compone la política alrededor del envío.

`SubmitOrderError` distingue `unsupported-currency`, `conflict`, `account-not-found`, `instrument-not-found`, `instrument-not-tradable`, `quote-unavailable`, `quote-invalid` y `quantity-not-representable`. Son errores internos, no códigos HTTP. `Clock`/`SystemClock` permiten sustituir el reloj; `OrdersModule` registra `SUBMIT_ORDER_USE_CASE` y `CLOCK` con tokens y `AppModule` lo importa.

B05-A fue aceptado tras revisión independiente del 2026-10-28: tipos y build correctos, 329 unitarias aisladas y suite completa de 469 pruebas en 34 archivos (109 de integración PostgreSQL y 31 HTTP existentes). Sus pruebas funcionales del CDU con PostgreSQL cubren R14, que pide probar la función de envío; la validación del futuro endpoint HTTP es adicional. El usuario autorizó su único commit local, sin publicación ni commits posteriores; en ese momento el HTTP de envío seguía pendiente y B05-C lo implementó después. La cancelación HTTP se implementó en B06-B.

## Endpoint HTTP de envío de órdenes

`POST /users/:userId/orders` expone el CDU de B05-A sin duplicar su lógica. Requiere `Idempotency-Key` y un body JSON plano:

```sh
curl -i -X POST \
  -H 'Idempotency-Key: 123e4567-e89b-12d3-a456-426614174000' \
  -H 'Content-Type: application/json' \
  -d '{"instrumentId":47,"side":"BUY","type":"LIMIT","size":3,"price":"10.00"}' \
  'http://127.0.0.1:3000/users/1/orders'
# HTTP/1.1 201 Created
# {"order":{"id":5,"status":"NEW"}}
```

La creación responde 201 con `NEW`, `FILLED` o `REJECTED`; un reenvío con la misma clave e intención responde 200 con el estado actual, incluido `CANCELLED`. El cuerpo es exactamente `{"order":{"id":<número>,"status":"..."}}`; no incluye `replayed`, `Location`, cantidades, precios ni fecha.

- `userId`: solo dígitos ASCII, ceros iniciales admitidos y valor 1..2147483647. `instrumentId` y `size`: número entero JSON 1..2147483647. `side`: `BUY`/`SELL`; `type`: `MARKET`/`LIMIT`.
- Exactamente uno de `size` o `amount`. `amount` y `price` son strings decimales con gramática `^\d+(\.\d{1,2})?$`, positivos, sin signo, exponente, espacios internos, coma, `0x` ni `_`; se admiten ceros iniciales y escala escrita ≤2. `"10.000"` y `"10.001"` devuelven 400; `"10.00"` es válido.
- `price` solo en LIMIT y es obligatorio; admite hasta ocho dígitos enteros del valor normalizado. `amount` no hereda ese límite; su cantidad derivada debe ser representable. `currency` no se acepta: ARS es implícito.
- `Idempotency-Key` debe ser un UUID hexadecimal `8-4-4-4-12` de cualquier versión o variante, incluido el UUID nulo; se normaliza a minúsculas. Ausencia, repetición, comas o forma inválida producen 400 antes de la transacción.
- `null`, arrays, primitivas, JSON malformado, campos desconocidos y raíces que no sean objeto producen 400 genérico.

Errores exactos: 400 `Invalid request.`, 404 `User or instrument not found.`, 409 `The idempotency key was already used with a different request.` y 500 `Order could not be completed.`. La insuficiencia de recursos no es error HTTP: se persiste `REJECTED` con 201/200. Un fallo de cotización, metadatos persistidos, persistencia, transacción o COMMIT incierto devuelve 500 genérico, sin afirmar rollback.

El `ValidationPipe` global y el parser JSON de Nest siguen activos. Un filtro global acotado a esta ruta normaliza los errores del parser a `{"message":"Invalid request."}`; los middlewares de cancelación siguen limitados a su propio pathname. La validación del adapter no lee instrumento, cotización, recursos ni órdenes: el CDU y su transacción resuelven todo después del bloqueo. El envío reintenta únicamente fallos transitorios elegibles según B08-A; no hay recuperación de COMMIT incierto, reintentos de conexión, timeouts ni autenticación.

B05-C fue implementado y validado localmente el 2026-10-29 con Node 24.22.1 y PostgreSQL 18.6. Aporta 173 pruebas unitarias nuevas y 121 pruebas HTTP nuevas (95 con doble tipado del puerto de entrada y 26 con PostgreSQL aislado en `b05c_test`), además de conservar las suites de cancelación y búsqueda. El esquema `b05c_test` se elimina al finalizar; el seed público conserva 4 usuarios, 66 instrumentos, 11 órdenes y 126 cotizaciones, sin columnas de idempotencia en `public.orders`. Fue aceptado tras revisión independiente con 988 pruebas aprobadas; el usuario autorizó su único commit local; no se hizo push, PR ni merge.

B05-C-R1 fue aceptado y versionado en `3a83bff`: rechaza claves desconocidas del JSON original antes de transformarlo, incluidas `__proto__` y `constructor`. Se agregaron 4 unitarias y 4 HTTP; la revisión independiente aprobó tipos, build, 657 unitarias y 99 HTTP de envío. No se repitieron PostgreSQL ni la suite completa para esta corrección.

## Reintentos acotados del envío

B08-A agrega reintentos automáticos solo al envío. Se repite la transacción completa, no un statement: cada intento vuelve a adquirir el bloqueo de la cuenta antes de leer UUID, recursos, instrumento y cotización, con una nueva adquisición de cliente. El mismo usuario, UUID e intención normalizada se conservan en todos los intentos.

Solo son elegibles `40001` (fallo de serialización) y `40P01` (deadlock) observados durante el bloqueo o el trabajo, antes de COMMIT, cuando el `ROLLBACK` y la liberación del cliente terminaron correctamente. Se permiten un intento inicial y hasta tres adicionales, con esperas de 50, 100 y 200 ms, sin jitter; las esperas programadas suman como máximo 350 ms y no representan un timeout total. No se reintentan validaciones, conflictos, `REJECTED`, otros SQLSTATE como `23505`, fallos de conexión o `BEGIN`, errores de rollback/liberación, COMMIT incierto/confirmado ni operaciones de cancelación, portfolio o búsqueda.

`AccountTransactionError.transientFailure` expone la clasificación neutral (`serialization-failure` o `deadlock`) producida por el adapter PostgreSQL; el dominio y el CDU no interpretan SQLSTATE ni mensajes del driver. `RetryingSubmitOrderRunner` aplica la política y una espera asíncrona sustituible, y `OrdersModule` lo conecta solo a `SUBMIT_ORDER_USE_CASE`. El runner compartido y el comportamiento de cancelación no cambian.

El contrato público no cambia: una orden nueva sigue respondiendo 201, un reenvío 200 con el estado actual —incluido `CANCELLED`—, un conflicto 409 y un fallo técnico agotado 500 genérico. Una orden confirmada por otra solicitud entre intentos se recupera por la misma clave sin ejecutarla ni reservar de nuevo.

**Validación:** con Node 24.22.1 pasaron tipos de aplicación y pruebas, build, 49 archivos / 794 unitarias aisladas sin PostgreSQL activo y una ejecución completa de 68 archivos / 1192 pruebas con PostgreSQL 18.6 aislado. La integración usa `b08a_test`, carga `database.sql` intacto y la migración B04-B, y provoca SQLSTATE controlados con triggers exclusivos de prueba; verifica rollback efectivo, bloqueo/lecturas repetidos, una sola orden y efecto, agotamiento sin reservas y recuperación de una orden cancelada entre intentos. El esquema se elimina al finalizar y el seed público conserva 4 usuarios, 66 instrumentos, 11 órdenes y 126 cotizaciones, con huellas idénticas. B08-A fue aceptado tras revisión independiente y tiene un único commit local autorizado, sin publicación; no cierra Q04.

## CDU interno de cancelación de órdenes

B06-A agrega `CancelOrderUseCase.execute` y `CancelOrderService` para cancelar una orden en un único intento transaccional, sin endpoint HTTP ni reintentos. La entrada es semántica —usuario y orden— y no requiere UUID nuevo, moneda, precio, reloj ni cotización. La salida interna es `{ orderId, status: 'CANCELLED' }`.

Dentro del bloqueo de cuenta de B04-A, el CDU lee la orden por usuario e identificador, después del bloqueo, y resuelve:

- `NEW`: ejecuta una única actualización condicional a `CANCELLED`.
- `CANCELLED`: devuelve éxito sin UPDATE ni efectos adicionales.
- `FILLED`/`REJECTED`: produce el conflicto interno `order-not-cancellable` sin cambios.
- Inexistente o de otra cuenta: produce el mismo error interno `order-not-found`.
- Cuenta inexistente: conserva `account-not-found` como resultado interno distinguible.

`PostgresOrderCancellationRepository` ejecuta `UPDATE orders SET status = 'CANCELLED' WHERE userid = $1 AND id = $2 AND status = 'NEW' RETURNING id` con el mismo cliente bloqueado. Solo acredita la transición si vuelve exactamente el id solicitado; no borra filas ni modifica cantidad, precio, fecha, instrumento, usuario, side, type, UUID o metadatos. Una fila histórica `NEW` sin identidad idempotente sigue siendo cancelable.

Las reservas se derivan del estado, por lo que cancelar una BUY `NEW` libera `size × price` de pesos reservados y cancelar una SELL `NEW` libera `size` de acciones. No cambia efectivo contable, tenencia ejecutada, costo ni valor de cuenta, y no crea movimientos compensatorios ni tablas de reservas. La salida solo se devuelve después de un `COMMIT` confirmado; un fallo técnico o un `COMMIT` incierto se propagan sin declarar éxito ni afirmar que la cancelación no ocurrió.

`CancelOrderError` distingue `invalid-input`, `account-not-found`, `order-not-found`, `order-not-cancellable` y `transition-not-acknowledged`. Son errores internos; su traducción HTTP se implementa en B06-B. `OrdersModule` registra `CANCEL_ORDER_USE_CASE` por token y `AccountTransactionContext` incorpora `orderCancellations` sobre el cliente bloqueado; el controller HTTP se agrega en B06-B.

B06-A fue implementado y validado localmente el 2026-10-28 con Node 24.22.1 y PostgreSQL 18.6: 34 unitarias y 13 pruebas PostgreSQL en el esquema exclusivo `b06a_test`. Cubre BUY/SELL, repetición sin escritura, FILLED/REJECTED, orden ajena/inexistente, cuenta inexistente, fila histórica sin identidad, conservación de todos los campos, rollback, dos cancelaciones, ambos órdenes de bloqueo frente a envío, reenvío del UUID original con estado `CANCELLED` y `COMMIT` incierto. Fue aceptado tras revisión independiente del 2026-10-28 con tipos, build, 363 unitarias aisladas y suite completa de 516 pruebas aprobadas; el usuario autorizó su único commit local, sin publicación ni commits posteriores. B06-B implementa después el endpoint HTTP descrito en la sección siguiente.

## Endpoint HTTP de cancelación

`POST /users/:userId/orders/:orderId/cancel` expone el CDU de B06-A sin body ni `Idempotency-Key`. Los identificadores deben contener únicamente dígitos ASCII con valor entre 1 y 2147483647; se admiten ceros iniciales. La validación es léxica antes de convertir a número.

```sh
curl -i -X POST \
  'http://127.0.0.1:3000/users/1/orders/5/cancel'
# HTTP/1.1 200 OK
# {"order":{"id":5,"status":"CANCELLED"}}
```

La respuesta de éxito o repetición es exactamente `{"order":{"id":<número>,"status":"CANCELLED"}}`. Los errores usan `{"message":"..."}`:

- 400 `Invalid request.` para identificadores inválidos o cualquier body con contenido, incluido `{}`.
- 404 `Order not found.` para orden inexistente, ajena o cuenta inexistente.
- 409 `Order cannot be cancelled.` para FILLED/REJECTED.
- 500 `Order cancellation could not be completed.` para fallos técnicos, incluido COMMIT incierto; no se afirma rollback.

Cualquier body con contenido se rechaza antes de los parsers de Nest/Express. `Content-Length` distinto de cero se rechaza; `Transfer-Encoding: chunked` no se considera prueba de contenido: un stream que termina sin datos devuelve 200 y uno con datos devuelve 400. El middleware se registra en `configureHttpApplication` antes de `init()`/`listen()` y cubre JSON válido, JSON malformado, texto, formularios y binarios. `Content-Length: 0` o ausencia de body se aceptan. Una cabecera `Idempotency-Key` presente no participa en la operación.

Los escapes porcentuales malformados en el pathname de cancelación, como `%ZZ` o `%E0%A4%A`, se rechazan antes del router con el mismo 400 genérico, sin invocar el CDU ni reflejar el identificador. La comprobación está limitada a esta ruta y no altera la búsqueda.

El reconocimiento del pathname acepta tanto URLs relativas (`/users/...`) como request-targets absolutos (`http://host/users/...`), preservando los escapes hasta la validación. Una URI absoluta con body Content-Length o chunked devuelve 400 sin invocar el CDU; una vacía sigue el comportamiento normal del endpoint.

El controller traduce errores con `CancelOrderExceptionFilter` y registra los 500 mediante el diagnóstico sanitizado existente. No modifica la lógica del CDU ni las reglas de reservas: NEW → CANCELLED libera la reserva, CANCELLED repite sin escritura y FILLED/REJECTED no cambian. Los 8 casos HTTP con PostgreSQL usan el esquema exclusivo `b06b_test`, cargado desde `database.sql` intacto más la migración B04-B y eliminado al finalizar.

B06-B fue implementado y validado localmente el 2026-10-28 con Node 24.22.1 y PostgreSQL 18.6. B06-B-R1 corrigió chunked vacío y escapes de URL malformados; B06-B-R2 corrigió el reconocimiento de request-targets absolutos. En conjunto aportan 117 unitarias y 61 pruebas HTTP nuevas (53 con doble tipado/raw y 8 con PostgreSQL), incluidas regresiones con `node:http` para chunked, escapes `%ZZ`/`%E0%A4%A` y URIs absolutas con body, vacías y con escapes. B06-B/R1/R2 fue aceptado tras revisión independiente del 2026-10-28: tipos, build y 694 pruebas aprobadas. El usuario autorizó su único commit local, sin publicación ni commits posteriores; no se implementaron autenticación, portfolio ni envío HTTP en ese bloque. B05-C implementó el envío después.

## Pruebas

Unitarias aisladas, sin PostgreSQL ni aplicación HTTP real:

```sh
npm run test:unit
npm run test:typecheck
```

La suite unitaria cubre servicio/CDU, controller, validación de identificadores, middleware de body, guard de escapes URL, helpers de pathname absoluto/relativo, filtro HTTP, persistencia con cliente pg falso, configuración, ciclo de vida del pool y diagnósticos, además del cálculo de recursos, sus adapters pg, el ciclo transaccional por cuenta, el modelo puro de intención original, la lectura de órdenes por clave, la escritura de órdenes preparadas, los CDU de envío y cancelación, sus errores, el piso exacto, la fecha UTC y la lectura mínima de instrumento. B05-C agrega DTO/pipe de body, extracción de `Idempotency-Key`, validación de ruta, controller, filtros de errores y del parser, y sus casos límite. B07-A agrega el cálculo de portfolio y su CDU con dobles tipados; B07-A-R1 suma regresiones de redondeo exacto. B07-B agrega el adapter PostgreSQL de portfolio y su ciclo de transacción, el controller/filtro, la validación de ruta y el middleware de escapes. B07-B-R1 agrega el filtro global configurable y el reconocimiento de ruta de portfolio. B08-A agrega la clasificación neutral del runner, la política de reintentos, la composición exclusiva del envío y una prueba de misma intención/UUID. Resultado con Node 24.22.1: 49 archivos y 794 pruebas unitarias, sin PostgreSQL activo.

Integración PostgreSQL y pruebas HTTP, con la base de pruebas efímera:

```sh
docker compose --profile test up -d --wait db-test
npm run test:integration
npm run test:http
npm test
```

`npm test` ejecuta la suite completa. La última ejecución completa corresponde a B08-A: 68 archivos y 1192 pruebas (794 unitarias, 134 de integración PostgreSQL y 264 HTTP), todas aprobadas con Node 24.22.1. B08-A agrega 5 pruebas de integración en `b08a_test` con triggers de SQLSTATE controlados y 27 unitarias nuevas de clasificación, política, composición y misma intención. La evidencia previa de B07-B se conserva: 63 archivos y 1134 pruebas (745 unitarias, 129 de integración PostgreSQL y 260 HTTP). B07-B agrega 59 unitarias, 7 pruebas de integración y 43 HTTP; las de integración y HTTP con PostgreSQL usan los esquemas exclusivos `b07b_test` y `b07b_http_test`, cargados desde `database.sql` intacto más la migración B04-B. La integración cubre el seed, usuario vacío e inexistente, selección de última cotización por fecha/id con fechas nulas excluidas y sin fallback, orden nativo con microsegundos y empate por id, posiciones cero y cuentas solo con efectivo. Las pruebas HTTP cubren el contrato público, los errores, los escapes malformados y los efectos de MARKET, LIMIT y cancelación. La prueba de concurrencia pausa la lectura antes de cotizaciones con una barrera del cliente de prueba, confirma una escritura desde otro cliente y comprueba que la respuesta conserva el snapshot anterior mientras el escritor progresa.

B07-B-R1 no repitió PostgreSQL ni concurrencia porque esas capas permanecen intactas. Con Node 24.22.1 pasaron tipos de aplicación y pruebas, build, 47 archivos / 767 unitarias y 198 pruebas HTTP sin base de portfolio, envío, cancelación y validación de búsqueda. Las nuevas pruebas cubren JSON malformado, marcador ficticio, URI absoluta, 400 exacto, cero llamadas al CDU y control de JSON válido.

La integración y las pruebas HTTP con base real usan `db-test` en `127.0.0.1:5433`, base `cocos_test`, y rechazan cualquier otro nombre de base para no caer en desarrollo. Se puede cambiar el host o el puerto con `TEST_PGHOST` y `PGTESTPORT`, y las credenciales con `TEST_PGUSER` y `TEST_PGPASSWORD`. Las pruebas insertan fixtures con identificadores propios y los eliminan al terminar; el seed original no se modifica. Las pruebas transaccionales verifican aislamiento, cliente compartido, serialización por cuenta, progreso de cuentas distintas, confirmación efectiva, rollback conocido y limpieza ante fallos. Las 28 pruebas de migración aplican la SQL dentro de transacciones revertidas y comprueban el histórico, las constraints, el contenedor versionado, los decimales como strings, la segunda ejecución, la firma canónica exacta, las propiedades de validación y el fallo seguro ante incompatibilidad, literales alterados o estado incompleto. La integración B04-D usa un esquema exclusivo, aplica allí la migración y lo elimina al finalizar, sin modificar el esquema público ni el seed compartido. La integración B04-E carga `database.sql` intacto en el esquema exclusivo `b04e_test`, aplica la migración B04-B, verifica atomicidad, unicidad, concurrencia y efectos B02, y elimina el esquema al finalizar. La integración B05-A usa `b05a_test` con el SQL original y la migración B04-B para cubrir BUY/SELL, MARKET/LIMIT, size/amount, límites del piso exacto, insuficiencia y reservas, REJECTED sin efectos, cotización ausente/inválida sin fallback, LIMIT sin cotización, instrumento inválido, ARS por defecto, reenvíos, conflicto, concurrencia y rollback; elimina el esquema al finalizar. La integración B06-A usa `b06a_test` con el SQL original y la migración B04-B, agrega un trigger de auditoría solo dentro de ese esquema para contar transiciones, y cubre cancelación BUY/SELL, estados, pertenencia, fila histórica, conservación de campos, rollback, concurrencia entre cancelaciones y con envío, reenvío del UUID original y COMMIT incierto; elimina el esquema al finalizar. Las 8 pruebas HTTP de B06-B con PostgreSQL usan `b06b_test`, cargado desde el SQL original más la migración B04-B, y cubren BUY/SELL, repetición sin escritura, reservas B02, conservación de campos, FILLED/REJECTED, orden ajena/inexistente, cuenta inexistente y fila histórica; el esquema se elimina al finalizar. Las 53 pruebas HTTP restantes de B06-B/R2 usan un doble tipado del puerto de entrada, incluidos controles raw con `node:http`, para validar identificadores, cuerpos, chunked vacío/con contenido, escapes URL, URIs absolutas, cabeceras y traducción exacta de estados. B05-C agrega 95 pruebas HTTP con doble tipado para ruta, `Idempotency-Key`, JSON malformado, raíces no objeto, tipos, `size`/`amount`, `price`, UUID, rangos, cabecera duplicada, respuestas y errores, y 26 pruebas HTTP con PostgreSQL en `b05c_test` para la matriz BUY/SELL y MARKET/LIMIT, `size`/`amount`, insuficiencia, replay de los cuatro estados, conflicto, cuentas distintas, claves nuevas, 404, instrumento no operable, cotización ausente/inválida, cantidad no representable, UUID malformado, concurrencia y recuperación sin nuevas lecturas; `b05c_test` se elimina al finalizar. La integración B08-A usa `b08a_test` con `database.sql` intacto y la migración B04-B; triggers exclusivos del esquema y una secuencia no transaccional provocan `40001`, `40P01` y `23505` durante el `INSERT`, sin hooks de producción. Cubre rollback y repetición completa, orden/efecto únicos, reservas sin duplicar, agotamiento sin filas y recuperación de una orden `CANCELLED` confirmada entre intentos; el esquema se elimina al finalizar.

Los fallos técnicos registran solo operación, clase y código permitidos y una descripción estática; no registran mensajes arbitrarios del driver, credenciales ni valores de solicitud.

## Verificación nativa

Con Node 24.22.1, sin necesitar un servidor de base para este arranque mínimo:

```sh
npm ci --ignore-scripts
npm run typecheck
npm run build
PORT=3002 npm start
```

Se usa otro puerto libre para no colisionar con Compose. Se valida `PORT` al iniciar y se activa el cierre por señales, incluido el cierre del pool de PostgreSQL. La búsqueda, el cálculo interno de recursos, la lectura de cotizaciones, la unidad transaccional, la intención original, la lectura por clave, la escritura preparada, los CDU internos de envío y cancelación, los reintentos acotados del envío y el portfolio tienen pruebas unitarias aisladas e integración pg donde corresponde; la búsqueda, el envío, la cancelación y el portfolio tienen además pruebas HTTP. La migración B04-B se valida con integración PostgreSQL; no se agregaron unitarias para SQL sin lógica de script. La integración y las pruebas con base requieren `db-test`. B08-A se validó con Node 24.22.1 y PostgreSQL 18.6; la comprobación de arranque no sustituye las pruebas funcionales. El envío, la cancelación y el portfolio ya tienen endpoint y pruebas HTTP.

La validación de B07-B usó Docker 29.9.1 y Compose v5.5.0 para levantar `db-test`, sin instalar dependencias ni cambiar el contexto activo. B08-A usó Docker 29.8.2 y Compose v5.5.0 con el mismo criterio. Los comandos anteriores requieren un motor Docker activo y el plugin Compose; resultados de validación en el plan.

## Follow-ups

- Evaluar riesgos del redondeo monetario y costo de preservar mayor precisión histórica y futura; por ahora se mantiene escala 2. [Detalle](docs/backend-features.spec#evidencia-sobre-la-precisión-histórica-y-costo-de-preservarla).
