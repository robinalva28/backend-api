# Backend-API

REST API for instrument search, portfolio valuation, and stock order submission and cancellation. Built for the [backend assignment](backend-challenge.md), from the [original repository](https://github.com/cocoscap/cocos-challenge).

Stack: NestJS with Express, strict TypeScript/ESM, Node.js 24.22.1, PostgreSQL 18.6, `pg`, and `decimal.js`. Dependencies are pinned in [package.json](package.json) and [package-lock.json](package-lock.json).

## Run locally

1. Requirements: Docker engine with the Compose and Buildx plugins, and `curl`. Run commands from the repository root. Node.js 24.22.1 is only needed for native mode and tests.

2. Optional configuration: `cp .env.example .env`. Defaults work without it. Keep its database name, user, and password while the volume exists; changing them later prevents the app from connecting.

3. Start the stack and check its state:

   ```sh
   docker compose config --quiet
   docker compose up --build --wait
   docker compose ps
   ```

   If startup fails, inspect `docker compose logs -f app`.

4. Apply the order migration. It is manual, checks schema compatibility when repeated, and is not run at startup:

   ```sh
   docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -1 -f -' \
     < db/migrations/20261028-b04b-order-idempotency.sql
   ```

5. Verify the API:

   ```sh
   BASE_URL=http://127.0.0.1:3000
   curl -fsS "$BASE_URL/instruments?query=pamp"
   # [{"id":47,"ticker":"PAMP","name":"Pampa Holding S.A."}]
   curl -fsS "$BASE_URL/users/1/portfolio"
   ```

   The health check only probes the TCP listener; it does not re-check database access or the migration after the one-time startup probe. The order example below exercises the migrated schema.

## API usage

Default base URL: `http://127.0.0.1:3000`. No authentication is required; `userId` selects the account. `/` returns 404.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/instruments?query=...` | Search stocks by ticker or name. |
| GET | `/users/:userId/portfolio` | Read account value, available cash, and positions. |
| POST | `/users/:userId/orders` | Submit a MARKET or LIMIT order. |
| POST | `/users/:userId/orders/:orderId/cancel` | Cancel an order in NEW state. |

[Swagger UI](http://127.0.0.1:3000/docs/) and [OpenAPI JSON](http://127.0.0.1:3000/openapi.json) describe parameters, responses, and errors. Adjust their ports if configured differently. Schema alignment and Swagger corrections are [implemented but still pending independent acceptance](docs/backend-features.spec#b09-r1--correcciones-implementadas-2026-10-29).

```sh
curl -fsS "$BASE_URL/users/1/portfolio"
```

The response contains `totalValue`, `availableCash`, and `positions`. Monetary values are decimal strings with two decimal places; return percentages are numbers or `null`. Search matches a literal substring without case sensitivity and returns `[]` when nothing matches.

Create, replay, and cancel a LIMIT order using the running application container. This example generates a fresh UUID and uses the returned order ID, so it does not assume sequence values or cancel a seed order. It requires sufficient cash in seeded account 1.

```sh
docker compose exec -T app node --input-type=module <<'JS'
const base = 'http://127.0.0.1:3000';
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

## Configuration

Defaults work without a `.env` file; see step 2 to create one.

| Variable | Default | Effect |
| --- | --- | --- |
| `PORT` | `3000` | Host port in Compose; application listener in native mode. |
| `DATABASE_URL` | unset | Enables remote mode and takes precedence over `PG*`. Must be a PostgreSQL URL with verified TLS. |
| `PGSSLROOTCERT` | unset | Optional CA file for a remote database that uses a private CA. |
| `PGHOST` | `127.0.0.1` | Native database host; Compose uses `db` internally. Used only when `DATABASE_URL` is unset. |
| `PGPORT` | `5432` | Published database port; native connection port. Used only when `DATABASE_URL` is unset. |
| `PGDATABASE` | `backend_api` | Development database name. Used only when `DATABASE_URL` is unset. |
| `PGUSER` | `backend_api` | Database user. Used only when `DATABASE_URL` is unset. |
| `PGPASSWORD` | `backend-api-local` | Local development password. Used only when `DATABASE_URL` is unset. |
| `PGTESTPORT` | `5433` | Published test database port. |
| `LOG_LEVEL` | `info` | Minimum JSON log level: `error`, `warn`, or `info`. |
| `SLOW_REQUEST_THRESHOLD_MS` | `1000` | Requests at or above this duration also emit a slow-request WARN. |

Compose keeps container ports at 3000/5432. For example, `PORT=3001` changes the host API URL to `http://127.0.0.1:3001`; update `BASE_URL` accordingly. The project name is `backend-api`; its default volume is `backend-api_postgres-data`. Earlier volumes remain untouched. To reuse an existing environment, retain its Compose project name and database settings through environment overrides; names and credentials are not migrated automatically.

The local `app` service never receives `DATABASE_URL`; the `app-remote` service receives only `DATABASE_URL` and the optional CA setting, so the two modes do not silently replace each other. Do not put real credentials in `.env.example` or versioned files.

For native execution, start `db` and apply the migration from step 4, then use Node.js 24.22.1:

```sh
npm ci --ignore-scripts
npm run build
PORT=3002 npm start
```

Use `http://127.0.0.1:3002` for that process. Its PostgreSQL settings come from the environment or `.env`.

### Remote database mode

Set `DATABASE_URL` in your environment or ignored `.env` file, then run the remote service. It does not start or depend on the local `db` service. Run only one of `app` and `app-remote` at a time because they share the host port:

```sh
docker compose --profile remote up --build --wait app-remote
```

`DATABASE_URL` takes precedence over every `PG*` variable. If it is absent, the application uses the local `PG*` configuration; if it is empty, malformed, unsafe, or the remote connection fails, startup or the request fails without falling back to the local database. The application probes the selected database once with `SELECT 1` before listening. Remote connections verify both the certificate and hostname. Accepted `sslmode` values (`require`, `verify-ca`, `verify-full`) all enforce full verification; use `verify-full` to state that intent explicitly. `ssl` accepts only `1` or `true`; unsafe or unknown modes, `uselibpqcompat` other than `false`, and repeated query parameters are rejected. TLS options are validated and removed from the URL before `pg` parses it, so they cannot overwrite the explicit TLS configuration. `sslnegotiation=postgres|direct` and client certificate files (`sslcert`, `sslkey`) are translated explicitly. Use `PGSSLROOTCERT=/path/to/ca.pem` or URL `sslrootcert` for a private CA; `PGSSLROOTCERT` takes priority when both are set and remains effective alongside `sslmode`. Certificate files must be available inside the container, so mount them explicitly.

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

Inspect logs with `docker compose logs -f app`. Docker Compose configures the `json-file` driver with `max-size: 10m` and `max-file: 3`, so each container retains at most roughly 30 MB in up to three rotated files. These logs live with the container and are deleted when it is removed, for example by `docker compose down`, `docker compose rm`, or recreating a container. Database reset (`down -v`) is not required to lose API logs. No external logging platform is configured.

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
docker compose down -v
```

The unchanged [seed](database.sql) loads only when the volume is empty. After resetting, start the stack again and reapply the migration from step 4. Reusing a volume preserves previous orders and changes example results.

## Troubleshooting

- Port already in use: set `PORT` or `PGPORT` in `.env` and update `BASE_URL`; only the host port changes.
- App healthy but orders fail: apply step 4; the health check does not detect a missing migration.
- Database connection fails after editing `.env`: the volume was initialized with different credentials; restore them. If you intentionally want to discard all local database data, follow [Optional database reset](#optional-database-reset).
- Search returns `[]` on a reused volume: the seed only loads into an empty volume.
- `npm start` fails: run `npm run build` first and use Node.js 24.22.1.

- Startup logs `application.start_failed`: the database URL is invalid, the selected database is unreachable, or configuration validation failed. The process exits; fix the configuration instead of expecting a local fallback.

## Design and limits

Features follow a hexagonal architecture: domain and use cases are independent of HTTP and PostgreSQL adapters. Decimal arithmetic preserves monetary precision. MARKET orders execute at the latest close; LIMIT orders reserve resources until cancellation. No market matching or transfer endpoint is implemented.

Order writes use account locking, transactions, and persisted idempotency. Submission allows one eligible transient retry after 50 ms and one recovery lookup after an uncertain commit. Portfolio uses a consistent read snapshot. Historical negative holdings remain visible. No authentication, automatic connection retries, or application timeouts are implemented; response time is unbounded. Technical logs are JSON, sanitized, and correlated by `X-Request-Id`.

## Documentation

- [Requirements and acceptance criteria](docs/requisitos.md).
- [Functional contracts and design decisions](docs/backend-features.spec).
- [High-level design](docs/diseno-alto-nivel.excalidraw).
- [Implementation history, review evidence, and current status](docs/plan.md).
- [Contribution and agent workflow](AGENTS.md).

Supporting documents retain their original language. Other challenge files are preserved; backend scope follows the linked assignment.

## Follow-ups

- Assess monetary rounding and higher precision. [Details](docs/backend-features.spec#evidencia-sobre-la-precisión-histórica-y-costo-de-preservarla).
- Assess coordinated connection, lock, query, and operation time limits. [Details](docs/backend-features.spec#cierre-de-q04-para-el-challenge).
- Assess connection recovery and additional retries with preserved idempotency. [Details](docs/backend-features.spec#cierre-de-q04-para-el-challenge).
- Prepare an optional Postman collection after implementation. [Details](docs/backend-features.spec#o01--colección-de-solicitudes-nice-to-have-al-final).
