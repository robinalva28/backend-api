# Backend-API

REST API for instrument search, portfolio valuation, and stock order submission and cancellation. Built for the [backend assignment](backend-challenge.md), from the [original repository](https://github.com/cocoscap/cocos-challenge).

Stack: NestJS with Express, strict TypeScript/ESM, Node.js 24.22.1, PostgreSQL 18.6, `pg`, and `decimal.js`. Dependencies are pinned in [package.json](package.json) and [package-lock.json](package-lock.json).

## Run locally

1. Requirements: Docker engine with the Compose and Buildx plugins, and `curl`. Run commands from the repository root. Node.js 24.22.1 is only needed for native mode and tests.

2. Configure `DATABASE_URL` in your environment or ignored `.env` file with the actual remote PostgreSQL URL and verified TLS (`sslmode=verify-full`). Use `.env.example` as a reference; its empty URL deliberately prevents startup. Do not overwrite an existing `.env` or commit credentials.

3. Start the application and check its state:

   ```sh
   docker compose config --quiet
   docker compose up --build --wait app
   docker compose ps
   docker compose logs --tail=50 app
   ```

   Startup must report `application.listening` with `connectionMode: remote`. A missing/empty/invalid URL or failed connection stops startup with `application.start_failed`; there is no local fallback. The application does not start or depend on a local database. Set `PORT=3001` if needed to retain that host port.

4. The order migration is manual and never runs at startup. Verify the required schema in the intended database before using order endpoints; apply it only with separate operational authorization. See [Remote database mode](#remote-database-mode). Do not load the seed, run the Postman collection, or create test orders against the remote database.

5. Read the contract at [Swagger UI](http://127.0.0.1:3000/docs/) or [OpenAPI JSON](http://127.0.0.1:3000/openapi.json), adjusting the port if configured differently. The health check only probes the TCP listener; startup probes the database once with `SELECT 1`.

## API usage

Default base URL: `http://127.0.0.1:3000`. No authentication is required; `userId` selects the account. `/` returns 404.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/instruments?query=...` | Search stocks by ticker or name. |
| GET | `/users/:userId/portfolio` | Read account value, available cash, and positions. |
| POST | `/users/:userId/orders` | Submit a MARKET or LIMIT order. |
| POST | `/users/:userId/orders/:orderId/cancel` | Cancel an order in NEW state. |

[Swagger UI](http://127.0.0.1:3000/docs/) and [OpenAPI JSON](http://127.0.0.1:3000/openapi.json) describe parameters, responses, and errors. Adjust their ports if configured differently. See the [documentation contract](docs/backend-features.spec#f09--documentación-openapi-y-swagger-ui-b09).

```sh
BASE_URL=http://127.0.0.1:3000
curl -fsS "$BASE_URL/users/1/portfolio"
```

The response contains `totalValue`, `availableCash`, and `positions`. Monetary values are decimal strings with two decimal places; return percentages are numbers or `null`. Search matches a literal substring without case sensitivity and returns `[]` when nothing matches.

On a disposable local test application only, create, replay, and cancel a LIMIT order. Never execute this walkthrough against the normal remote-connected application. This example generates a fresh UUID and uses the returned order ID, so it does not assume sequence values or cancel a seed order. It requires sufficient cash in seeded account 1.

```sh
TEST_BASE_URL=http://127.0.0.1:3002 node --input-type=module <<'JS'
const base = process.env.TEST_BASE_URL;
const path = '/users/1/orders';
const options = {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Idempotency-Key': crypto.randomUUID(),
  },
  body: JSON.stringify({
    instrumentId: 47, side: 'BUY', type: 'LIMIT', size: 3, price: '10.00',
  }),
};
async function request(path, options) {
  const response = await fetch(base + path, options);
  const data = await response.json();
  console.log(response.status, JSON.stringify(data));
  if (!response.ok) throw new Error(data.message);
  return data.order;
}
const order = await request(path, options);
if (order.status !== 'NEW') throw new Error('Example requires sufficient cash.');
await request(path, options);
await request(`${path}/${order.id}/cancel`, { method: 'POST' });
JS
```

Expected sequence: 201 with `NEW`, 200 with the same ID and `NEW`, then 200 with that ID and `CANCELLED`. Each response is `{"order":{"id":...,"status":"..."}}`.

Order inputs use `BUY`/`SELL`, `MARKET`/`LIMIT`, and exactly one of integer `size` or decimal-string `amount`. `price` is required only for LIMIT. Decimal inputs must be positive, with at most two decimal places; ARS is implicit. Submission requires a UUID `Idempotency-Key`: reuse the same key and intent after an uncertain response; use a fresh key for a new business request. A changed intent with the same key returns 409.

Insufficient resources persist `REJECTED` with 201, rather than an HTTP error. Cancellation accepts no body, returns 200 when repeated, and rejects FILLED/REJECTED orders with 409. Errors use `{"message":"..."}`: 400 for invalid input, 404 for missing resources, 409 for conflicts, and 500 for technical failures.

## Postman collection

Import [the Collection v2.1 file](postman/Backend-API.postman_collection.json) and [Local environment](postman/Local.postman_environment.json) into Postman. Select **Local** and set `baseUrl` to your disposable local API (example: `http://127.0.0.1:3000`); keep seeded `userId=1` and `instrumentId=47` (PAMP).

Use a test application with `NODE_ENV=test` and a fresh, disposable local PostgreSQL database loaded from [the seed](database.sql) with [the existing migration](db/migrations/20261028-b04b-order-idempotency.sql) applied. Verify the application's effective connection settings: no `DATABASE_URL`, and `PGHOST`/`PGPORT`/`PGDATABASE` must identify that disposable database. A loopback API URL does not prove the database is local. Do not run against development or a remote database, and do not load the real `.env` to prepare this run. The examples require the seeded close of `925.85`, sufficient cash, and at least three PAMP shares. The normal API now connects remotely: change the imported environment's `baseUrl` to your test API (for example port 3002) before running. After building, a native test API can use the ephemeral `db-test` service:

```sh
docker compose --env-file /dev/null --profile test up -d --wait db-test
env -u DATABASE_URL NODE_ENV=test PORT=3002 \
  PGHOST=127.0.0.1 PGPORT=5433 PGDATABASE=backend_api_test \
  PGUSER=backend_api PGPASSWORD=backend-api-local npm start
```

In another terminal, run the existing migration against that disposable `db-test` database before sending orders; this command never targets the remote database:

```sh
docker compose --env-file /dev/null --profile test exec -T db-test \
  sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -1 -f -' \
  < db/migrations/20261028-b04b-order-idempotency.sql
```

These are default test credentials/ports; match explicit overrides when used. The test application ignores `.env`. Stop that process and remove only `db-test` when finished.

In Collection Runner, select all four folders in their saved order, **one iteration**, and run. The 28 requests assert search results, portfolio structure, order status and identity, exact reservation/release effects, MARKET cash/quantity changes, and representative 400/404/409 responses. Alternatively, with Newman available, run from the repository root:

```sh
newman run postman/Backend-API.postman_collection.json \
  --environment postman/Local.postman_environment.json --bail
```

Newman 6.2.1 was used for validation, installed outside the project; no project dependency is required. Override `baseUrl` in the environment when using a different disposable API port.

`01 Start flow` clears previous operation state and generates one UUID and saved body per new operation in collection variables. Later requests retain them. After an uncertain creation response, use `04 Replay exact UUID and original body`; it can recover the ID without a saved creation response. Do not restart the flow to recover an uncertain write. Cancellation requests have no body or idempotency header and only use IDs captured from valid creation/replay responses; missing prerequisites skip the request. Keep the environment unchanged throughout the flow. Re-importing the files loses runtime correlation state.

The BUY LIMIT reserves `30.00`, replay returns the same ID, changed intent returns 409, and cancellation restores the portfolio; repeated cancellation adds no effects. Additional examples execute BUY MARKET by size and SELL MARKET by amount, then create/cancel SELL LIMIT by amount. Insufficient cash/shares create `201 / REJECTED` orders. Every full run persists six order rows: two CANCELLED, two FILLED and two REJECTED. Opposite MARKET trades restore cash and quantity but can change cost basis and returns. Remove only your disposable stack after inspection; the collection does not delete data. [OpenAPI](src/documentation/openapi.document.ts) remains the contract source.

## Configuration

`DATABASE_URL` is mandatory for normal execution. Local `PG*` connections are permitted only with explicit `NODE_ENV=test`, to keep automated tests and the Postman walkthrough isolated.

| Variable | Default | Effect |
| --- | --- | --- |
| `PORT` | `3000` | Host port in Compose; application listener in native mode. |
| `DATABASE_URL` | required | Remote PostgreSQL URL with verified TLS. Missing/invalid configuration aborts normal startup. |
| `PGSSLROOTCERT` | unset | Optional CA file for a remote database that uses a private CA. |
| `PGHOST` | `127.0.0.1` | Local test database host, only with `NODE_ENV=test` and no URL. |
| `PGPORT` | `5432` | Local test connection port; explicitly use 5433 for `db-test`. |
| `PGDATABASE` | `backend_api_test` | Local test database; normal execution ignores `PG*`. |
| `PGUSER` | `backend_api` | Local test database user. |
| `PGPASSWORD` | `backend-api-local` | Local test password. |
| `PGTESTPORT` | `5433` | Published test database port. |
| `LOG_LEVEL` | `info` | Minimum JSON log level: `error`, `warn`, or `info`. |
| `SLOW_REQUEST_THRESHOLD_MS` | `1000` | Requests at or above this duration also emit a slow-request WARN. |

Compose keeps container ports at 3000/5432. For example, `PORT=3001` changes the host API URL to `http://127.0.0.1:3001`; update `BASE_URL` accordingly. The project name is `backend-api`; its default volume is `backend-api_postgres-data`. Earlier volumes remain untouched. To reuse an existing environment, retain its Compose project name and database settings through environment overrides for explicit local use; names and credentials are not migrated automatically.

The default `app` service receives only the remote URL, optional CA, and operational settings. `app-remote` remains a compatibility alias under the `remote` profile; run only one API service at a time. The old `db` service and its volume are preserved under the explicit `local` profile; neither is used by normal startup. Do not put real credentials in versioned files.

For native execution with Node.js 24.22.1, configure the same remote URL, then run:

```sh
npm ci --ignore-scripts
npm run build
PORT=3002 npm start
```

Use `http://127.0.0.1:3002` for that process. It also requires `DATABASE_URL`; it cannot silently select a local database.

### Remote database mode

Remote mode is now mandatory for normal execution. Set `DATABASE_URL` in your environment or ignored `.env` file, then run the default service. The compatibility alias has the same connection settings:

```sh
docker compose up --build --wait app
```

`DATABASE_URL` takes precedence over every `PG*` variable. Outside `NODE_ENV=test`, an absent URL is an error. If it is empty, malformed, unsafe, or the remote connection fails, startup or the request fails without falling back to the local database. The application probes the selected database once with `SELECT 1` before listening. Remote connections verify both the certificate and hostname. Accepted `sslmode` values (`require`, `verify-ca`, `verify-full`) all enforce full verification; use `verify-full` to state that intent explicitly. `ssl` accepts only `1` or `true`; unsafe or unknown modes, `uselibpqcompat` other than `false`, and repeated query parameters are rejected. TLS options are validated and removed from the URL before `pg` parses it, so they cannot overwrite the explicit TLS configuration. `sslnegotiation=postgres|direct` and client certificate files (`sslcert`, `sslkey`) are translated explicitly. Use `PGSSLROOTCERT=/path/to/ca.pem` or URL `sslrootcert` for a private CA; `PGSSLROOTCERT` takes priority when both are set and remains effective alongside `sslmode`. Certificate files must be available inside the container, so mount them explicitly.

`channel_binding=disable` (also the default when omitted) sets `enableChannelBinding=false`; `channel_binding=prefer` sets it to `true`. In the installed `pg` 8.23.1 this only prefers SCRAM-SHA-256-PLUS when the server offers it; it does **not** require channel binding. `channel_binding=require` and unknown values are rejected with a configuration error. Use `prefer` only when optional negotiation meets your requirements; mandatory channel binding is unsupported by this implementation. See the [driver TLS and channel-binding documentation](https://node-postgres.com/features/ssl).

Apply the same migration to the remote database only after confirming the destination and holding separate credentials:

```sh
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 \
  -f db/migrations/20261028-b04b-order-idempotency.sql
```

The remote role must own `orders` (or run through a role with equivalent ownership); `ALTER TABLE` is not a separately grantable table privilege. Do not run seed data, test suites, test orders, or destructive cleanup in the remote database. Verify the two nullable columns and the three named constraints before starting the remote application.

## Operational logs

The application writes one JSON object per line to standard output. `LOG_LEVEL` filters events (`error`, `warn`, `info`; default `info`). Each request receives a validated or generated `X-Request-Id`, which is returned to the client and included in request, error, retry, replay, recovery, and transaction events. `accountUserId` is the validated route value, not authenticated identity; it is omitted for routes without an account or invalid identifiers. `orderId` appears when known.

INFO records startup, the local or remote mode, and one completion per request. WARN records transient retries, slow requests (`SLOW_REQUEST_THRESHOLD_MS`, default 1000 ms), and uncertain COMMIT outcomes. ERROR records definitive technical failures, failed recovery, and rollback or release problems. A normal 400 is only an access-log completion, not a WARN. Structured fields include the event timestamp, level, event name, request id, HTTP method, route template, status, duration, account, order, stage, commit outcome, attempt, delay, and sanitized technical code. Route recognition is case-insensitive, matching Express: uppercase paths retain the canonical route template and validated account identifier, including failed requests. Replay and recovery events never copy the idempotency key.

Logs never include request or response bodies, query strings, raw paths with identifiers, connection URLs, credentials, emails, account numbers, or complete idempotency keys. Diagnostics keep the existing allow-listed error metadata sanitizer and never serialize arbitrary `Error` objects.

Inspect logs with `docker compose logs -f app` or `docker compose --profile remote logs -f app-remote`. Docker Compose configures the `json-file` driver with `max-size: 10m` and `max-file: 3`, so each container retains at most roughly 30 MB in up to three rotated files. These logs live with the container and are deleted when it is removed, for example by `docker compose down`, `docker compose rm`, or recreating a container. Database reset (`down -v`) is not required to lose API logs. No external logging platform is configured.

## Tests

Requires Node.js 24.22.1 and installed dependencies (`npm ci --ignore-scripts`). Static checks and isolated unit tests need no database:

```sh
npm run typecheck
npm run test:typecheck
npm run test:unit
```

For the complete suite, including PostgreSQL integration and HTTP tests:

```sh
docker compose --profile test up -d --wait db-test
npm test
docker compose --profile test rm --stop --force db-test
```

The cleanup stops and removes only `db-test`.

Alternatively, run `npm run test:integration` or `npm run test:http` individually. Tests use the ephemeral `backend_api_test` database, reject other database names, and manage their fixtures and migration schemas. They do not require the development API to be running. Override host, port, or credentials with `TEST_PGHOST`, `PGTESTPORT`, `TEST_PGUSER`, and `TEST_PGPASSWORD`.

### Static CI

[GitHub Actions](.github/workflows/ci.yml) runs on every branch push and on pull requests opened, reopened, or updated against `main`. It uses Node.js 24.22.1, installs dependencies with `npm ci --ignore-scripts`, checks application and test types, builds the application, and runs isolated unit tests with V8 coverage. To run the same checks locally after installing dependencies:

```sh
npm run ci
```

`npm run test:coverage` runs only unit tests and writes HTML and JSON summary reports to `coverage/`. Coverage includes all `src/**/*.ts` files, including files not exercised by unit tests. The workflow keeps the report as the `unit-coverage` artifact for seven days. Coverage is informational, without a minimum threshold. PostgreSQL, HTTP integration tests, Docker builds, lint, and formatting are outside this workflow. Push and pull-request events can produce separate runs for the same commit; newer runs cancel older runs for the same Git ref.

## Stop and reset

Stop the development stack after using the API examples. This keeps the database volume and its data:

```sh
docker compose down
```

### Optional database reset

**This permanently deletes all local database data, including created orders.** Run it only when you intentionally want to reset the environment:

```sh
docker compose --profile local down -v
```

The unchanged [seed](database.sql) loads only into an empty local volume when the explicit `local` profile is used. This reset does not reset or seed the remote database. The default application continues to require the remote URL.

## Troubleshooting

- Port already in use: set `PORT` or `PGPORT` in `.env` and update `BASE_URL`; only the host port changes.
- App healthy but orders fail: verify the migration in the intended database; the health check does not detect a missing migration.
- Remote connection fails: verify the intended URL, database permissions and TLS configuration. Changing or resetting a local volume does not fix the remote connection.
- Local test search returns `[]` on a reused volume: the seed only loads into an empty local volume. Never seed the remote database for this check.
- `npm start` fails: run `npm run build` first and use Node.js 24.22.1.
- Startup logs `application.start_failed`: the database URL is invalid, the selected database is unreachable, or configuration validation failed. The process exits; fix the configuration instead of expecting a local fallback.

## Design and limits

Features follow a hexagonal architecture: domain and use cases are independent of HTTP and PostgreSQL adapters. Decimal arithmetic preserves monetary precision. MARKET orders execute at the latest close; LIMIT orders reserve resources until cancellation. No market matching or transfer endpoint is implemented.

Order writes use account locking, transactions, and persisted idempotency. Submission allows one eligible transient retry after 50 ms and one recovery lookup after an uncertain commit. Portfolio uses a consistent read snapshot. Historical negative holdings remain visible. No authentication, automatic connection retries, or application timeouts are implemented; response time is unbounded. Technical logs are JSON, sanitized, and correlated by `X-Request-Id`.

Idempotency is an additional project decision justified under the assignment's database section, not a textual requirement. `Idempotency-Key` identifies one operation per account, so a new key means a new operation even with identical parameters; recovery only resolves an uncertain COMMIT by looking up the same key and does not make every possible failure recoverable.

## Documentation

- [Requirements and acceptance criteria](docs/requisitos.md).
- [Functional contracts and design decisions](docs/backend-features.spec).
- [High-level design](docs/diseno-alto-nivel.excalidraw).
- [Implementation history, review evidence, and current status](docs/plan.md).
- [Contribution and agent workflow](AGENTS.md).

Supporting documents retain their original language. Other challenge files are preserved; backend scope follows the linked assignment.

## Delivery status

Local validation and the runtime-image walkthrough are recorded in the [delivery review](docs/plan.md#revisión-de-entrega-y-limpieza-documental-2026-10-30). Remote TLS connectivity and read endpoints passed verification. The idempotency migration was applied remotely with explicit authorization: both columns and all three constraints were verified, the 11 existing orders were preserved, and a second execution made no changes. No remote test orders were created. The checked configuration uses `sslmode=verify-full&channel_binding=prefer`; the application rejects `channel_binding=require`. GitHub Actions still requires a real remote run.

## Follow-ups

- Assess monetary rounding and higher precision. [Details](docs/backend-features.spec#evidencia-sobre-la-precisión-histórica-y-costo-de-preservarla).
- Assess coordinated connection, lock, query, and operation time limits. [Details](docs/backend-features.spec#cierre-de-q04-para-el-challenge).
- Assess connection recovery and additional retries with preserved idempotency. [Details](docs/backend-features.spec#cierre-de-q04-para-el-challenge).
