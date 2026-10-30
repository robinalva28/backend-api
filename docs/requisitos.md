# Requisitos y aceptación

Fuente funcional: [consigna backend](../backend-challenge.md), contrastada con [database.sql](../database.sql). Referencia original revisada: commit `abae77016b4e07e97161a9567239dcde5c0c00e1` del [repositorio de origen](https://github.com/cocoscap/cocos-challenge). Los contratos y decisiones D01–D08 están en la [especificación](backend-features.spec); la historia de implementación, autorizaciones y validaciones se conserva en el [plan](plan.md).

## Obligatorios de la consigna

La revisión de entrega del 2026-10-30 no identificó funcionalidad obligatoria sin implementar. La conexión y las lecturas remotas fueron verificadas posteriormente; la migración remota quedó aplicada y verificada con autorización explícita, sin crear órdenes de prueba remotas. La evidencia y los pendientes operativos se detallan en el [estado de entrega](plan.md#revisión-de-entrega-y-limpieza-documental-2026-10-30).

| ID | Requisito y sección de origen | Criterio verificable implementado |
| --- | --- | --- |
| R01 | Portfolio: valor total, pesos disponibles y posiciones. Resumen. | `GET /users/:userId/portfolio` devuelve cantidad, valor y rendimiento total por posición; lectura consistente y cálculo exacto según D01/D03. |
| R02 | Buscar por ticker y/o nombre con coincidencias similares. Resumen. | `GET /instruments?query=...`: subcadena literal sin distinguir mayúsculas, OR entre ticker/nombre, orden ticker/id. D06 excluye ARS/MONEDA; trim y máximo 255 caracteres Unicode; 400 para entrada inválida, 500 técnico genérico. |
| R03 | BUY/SELL, MARKET/LIMIT y persistencia en orders. Resumen y funcionales. | Las cuatro combinaciones tienen pruebas de respuesta y fila persistida. La idempotencia, los reintentos y la recuperación son decisiones adicionales, no exigencias de la consigna. |
| R04 | Cantidad exacta o monto, sin fracciones. Funcionales. | Alternativas excluyentes y positivas; monto dividido por precio con piso entero, también para SELL. Por ejemplo, 1000/300 produce 3 acciones; cero acciones se rechaza. D04 fija escala de dos decimales y rangos. |
| R05 | Precios ARS; MARKET utiliza el último close. Funcionales. | Fecha no nula más reciente y mayor id ante empate. Una última cotización inválida no se sustituye por otra anterior. MARKET rechaza precio enviado; ARS es la única moneda. |
| R06 | MARKET FILLED; LIMIT con precio y NEW, salvo rechazo. Funcionales. | Estado y precio persistidos; sin ejecución diferida ni simulación de mercado. |
| R07 | Insuficiencia de pesos o acciones: persistir REJECTED. Funcionales. | Pruebas de ambos lados; sin ejecución ni reserva para rechazos. La disponibilidad descuenta reservas NEW según D02. |
| R08 | NEW/FILLED/REJECTED/CANCELLED; cancelar solo NEW. Funcionales. | Endpoint de cancelación independiente: NEW → CANCELLED libera reservas; repetición devuelve 200 sin efectos; FILLED/REJECTED devuelven 409. Reenvío de creación no reabre órdenes. |
| R09 | Efectivo y tenencias derivados de orders y size. Funcionales. | BUY/SELL FILLED modifican tenencias; CASH_IN/CASH_OUT modifican efectivo. Rechazadas/canceladas no representan ejecuciones; NEW solo afecta disponibilidad. |
| R10 | ARS/MONEDA y movimientos CASH_IN/CASH_OUT. Funcionales y SQL. | ARS se contabiliza como efectivo, sin duplicarlo como posición accionaria ni exigir una API de transferencias. |
| R11 | Reflejar posiciones tras ejecutar una orden. Funcionales. | Prueba HTTP de MARKET seguida de portfolio; LIMIT reserva recursos sin modificar tenencia ejecutada, y cancelación libera la reserva. |
| R12 | Retorno diario con close/previousClose; posiciones desde FILLED. Funcionales. | `dailyReturnPercent = 100 × (close − previousClose) / previousClose`; null sin base válida. Rendimiento total se calcula por D01 y es distinto del diario. |
| R13 | REST en Node.js, framework y acceso a datos a elección. Técnicas. | NestJS/Express, TypeScript ESM y PostgreSQL con pg; arranque local documentado. |
| R14 | Test funcional de envío de orden. Técnicas. | [Integración del CDU](../test/orders/submit-order.integration.test.ts) con PostgreSQL real aislado; pruebas HTTP adicionales. |
| R15 | Documentar supuestos y justificar cambios de base. Técnicas y Base de datos. | Decisiones en spec/plan; idempotencia justificada y migración aditiva manual documentada en README. El SQL original permanece intacto. |

## Entrega adicional solicitada por el usuario

- **B09 — OpenAPI/Swagger:** implementado y versionado en `1fa1645`. Revisión independiente de las correcciones B09-R1 completada el 2026-10-30 mediante inspección, suites y smoke de la imagen runtime. No se realizó una revisión visual interactiva.
- **CI estático:** versionado en `e8578e1`; validación local registrada en el plan. Una ejecución remota de Actions sigue pendiente.
- **Conexión remota, migración y logging:** implementados en el árbol de trabajo y revisados localmente. Conexión TLS y endpoints de lectura remotos aprobados. Migración remota aplicada y repetida sin cambios; dos columnas y tres restricciones verificadas, 11 órdenes existentes preservadas. Sin pruebas POST sobre la base remota.
- **Inicio rápido:** verificado con imagen runtime, volumen local vacío, migración y recorrido de búsqueda, portfolio, creación, replay, conflicto y cancelación. La migración sigue siendo manual.

## Opcionales, libertades y límites

- **O01:** colección Postman, Insomnia o REST Client, único nice to have explícito. Pendiente; README ya incluye ejemplos. No bloquea la entrega obligatoria.
- La consigna permite modificar tablas con justificación; no obliga a hacerlo. La migración requiere autorización operativa y credenciales del destino, además de la justificación de diseño.
- No se requiere autenticación ni simulación de mercado. Rutas, códigos HTTP, Docker, CI, Swagger e idempotencia son decisiones del proyecto.
- Política vigente del envío: máximo dos intentos y una espera de 50 ms para fallos transitorios elegibles; una consulta de recuperación tras COMMIT incierto, sin recrear la orden.
- Publicar el repositorio y compartir su enlace es un paso de entrega pendiente. Commits, push, PR y merge requieren las autorizaciones independientes establecidas en AGENTS.md.
- Las consignas de otros challenges se conservan y no aportan requisitos al backend.

## Observaciones verificadas del SQL

- Cuatro tablas: users, instruments, orders y marketdata; el seed contiene 4 usuarios, 66 instrumentos (65 acciones y ARS), 126 cotizaciones y 11 órdenes.
- Dos fechas históricas cubren 63 acciones por fecha; faltan cotizaciones para dos acciones y ARS. No se introducen precios externos.
- marketdata usa `date DATE`, aunque la consigna enumera datetime; orders usa `datetime TIMESTAMP`. Identificadores camelCase sin comillas se normalizan a minúsculas y se mapean en adapters.
- El esquema permite nulos y fechas repetidas. D07 fija selección por fecha/id y tratamiento de datos inválidos; no se confunden casos de prueba con datos existentes.
- size es entero; price y cotizaciones son NUMERIC(10,2). El redondeo de literales con más decimales al importarlos es una [limitación aceptada](plan.md#precisión-monetaria--limitación-aceptada-temporalmente), no un requisito del challenge.
- El seed incluye una tenencia negativa histórica. D03 ya resolvió su tratamiento; portfolio la conserva según el contrato y las reservas NEW se aplican por separado. No hay tablas de saldos ni posiciones.
- Se conservan SQL, consignas y atribuciones originales; no se inventa una licencia.
