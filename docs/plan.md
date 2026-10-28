# Plan y decisiones del proyecto

Este documento concentra el estado, decisiones y planificación. Las propuestas no representan decisiones aprobadas. Los requisitos y sus criterios están en [requisitos.md](requisitos.md); las reglas de autorización y sesiones, en [AGENTS.md](../AGENTS.md).

## Etapa vigente y restricciones

Etapa actual: B04-A/B04-A-R1 aceptados y versionados en `e57de25`; B04-B/R1/R2 en `35f87f4`; B04-C en `87f2276`. B04-D aceptado tras revisión independiente del 2026-10-28 con tipos, build y 311 pruebas aprobadas. La lectura por usuario/UUID y la resolución interna de reenvíos usan el mismo cliente y bloqueo de B04-A y la comparación v1 de B04-C; no implementan creación, ejecución, recuperación automática, reintentos ni HTTP. El usuario autorizó un único commit local de B04-D, sin publicación ni commits posteriores. La suite completa quedó en 25 archivos y 311 pruebas (201 unitarias, 79 de integración y 31 HTTP). El detalle está en [Implementación y validación B04-D](#implementación-y-validación-b04-d).

B03/B03-R1 aceptados tras revisión independiente del 2026-10-28: se confirmó la selección por la columna `DATE` nativa (`marketdata.date DESC, marketdata.id DESC`) y la regresión PostgreSQL con `9999-12-31` y `10000-01-01`. Tipos y build correctos, 80 pruebas unitarias sin base activa y 142 pruebas de la suite completa aprobadas con Node 24.22.1. El usuario autorizó un único commit local de B03: `feat(quotes): read latest instrument quote`. La aceptación cubre lectura y selección, sin cerrar F07/Q06 ni AC26–AC28; no hay autorización de publicación ni commits adicionales.

B02/B02-R1 aceptados tras revisión independiente finalizada el 2026-10-28: se comprobó la exactitud de los acumulados y la conservación de la configuración decimal global. La suite completa pasó 126 pruebas (75 unitarias, 20 de integración PostgreSQL y 31 HTTP) con Node 24.22.1, incluida la regresión de cinco reservas máximas con resultado exacto. El usuario autorizó un único commit local de B02/B02-R1 y continuar con el prompt B03; no autorizó publicar implementación ni commits adicionales. B01 ya está versionado localmente en `a39a9dc`. B03 y B03-R1 fueron aceptados tras revisión independiente el 2026-10-28 como lectura interna de la última cotización; su entrega queda limitada al único commit local autorizado, sin publicación.

El usuario canceló la propuesta de ramas separadas y PRs. Después autorizó únicamente publicar una base mínima en `origin/main`: se creó `main` sobre el commit original `abae77016b4e07e97161a9567239dcde5c0c00e1` y se publicó esa referencia en `backend-cocos`, sin commits nuevos ni contenido de B01/B02. Se verificó el hash remoto. La rama activa y los cambios pendientes de B02 se conservaron; no se abrieron PRs ni se cambió la visibilidad.

Implementación de B02 del 2026-10-27: base interna de efectivo contable, tenencias ejecutadas, reservas NEW y recursos disponibles, con puerto de lectura y adapter pg, implementada y validada sin endpoints. B02-R1 corrigió la exactitud de los acumulados; la revisión independiente se completó el 2026-10-28 con 126 pruebas aprobadas. La entrega queda delimitada al único commit local autorizado el 2026-10-28, sin push, PR ni merge. B03 agregó la lectura interna de la última fila de `marketdata` por instrumento, sin consumidores ni endpoints.

El usuario aprobó los puntos de arquitectura y solicitó incorporarlos al plan, crear Dockerfile y Compose, usar Express y fijar versiones estables actuales de PostgreSQL, pg y las demás dependencias. La base técnica y su arranque local están preparados. La revisión del 2026-10-27 organiza una [especificación SDD parcial](backend-features.spec) para D01 y D03–D08, con alternativa A de D05 confirmada. Incluye el análisis ILIKE de D06, errores públicos genéricos de D07 y diseño de cancelación independiente solicitado en D08. El 2026-10-27 se implementó y validó B01 — búsqueda de instrumentos de extremo a extremo, con pg y PostgreSQL de pruebas aislado— y B02 —cálculo interno de recursos de cuenta, sin endpoints—. Portfolio, envío y cancelación de órdenes siguen sin implementar. B02 se versionó localmente y B03 tiene autorizado su único commit local. Permanecen preguntas de contrato y propuestas sin aprobar para los demás comportamientos.

Resolver los casos residuales de D01/D04/D05, la investigación D03 y los contratos D07–D08 antes de implementar sus comportamientos afectados. D06/Q05 está implementado y validado en B01; B02 implementó la base interna de recursos sin cerrar D03 ni los contratos públicos. D02 y las reglas aceptadas de D01/D04/D05 están confirmadas abajo; no se presentan propuestas técnicas del spec como aprobadas. Conservar el SQL original, los otros Markdown y cualquier trabajo existente. El usuario autorizó un único commit de B02/B02-R1, ya realizado. B03 y B03-R1 fueron implementados por el modelo externo y aceptados tras revisión independiente el 2026-10-28; el usuario autorizó su único commit local, sin publicación.

## Estado verificado y decisiones confirmadas

- El directorio inicial estaba vacío, sin instrucciones locales existentes ni repositorio Git propio o padre. No había trabajo previo que trasladar.
- Se verificó una única cuenta activa de GitHub y ausencia de un fork adecuado o conflicto de nombre. Se creó el [fork](https://github.com/robinalva28/cocos-challenge), cuyo padre y origen de red son el [repositorio original](https://github.com/cocoscap/cocos-challenge).
- El usuario retiró la restricción sobre inicializar Git después de consultar la diferencia entre inicializar y clonar. Se usó **clonación con el historial original**; no se ejecutó `git init` ni se creó historia independiente.
- Inicialmente, `origin` apuntaba al fork y `upstream` al original. El HEAD local, `origin/main` y el `main` remoto del original se verificaron en `abae77016b4e07e97161a9567239dcde5c0c00e1`. Se creó la rama local `chore/backend-preparation` para preparar documentación.
- Por indicación del usuario, esa rama se renombró a `feature/backend-implementation`, única rama local de trabajo. Se eliminó la referencia local `main` después de verificar que apuntaba al mismo commit; se conservan el historial original, los archivos pendientes y `origin/main`. No se modificaron ramas remotas ni se hizo push.
- El usuario reemplazó la limpieza inicial por la instrucción de conservar los otros `.md` tal cual. No se elimina ningún archivo. Permanecen frontend, fullstack, QA y React Native, sin tratarlos como fuentes del backend.
- El setup quedó versionado en `57c518e` (`docs: prepare backend challenge setup`), con diez archivos y sin `.DS_Store`. No se hizo push. Posteriormente el usuario pidió continuar definiendo el stack y confirmó Docker para ejecución local.
- El 2026-10-27, por autorización explícita, se cambió únicamente la URL de `origin` al repositorio `backend-cocos` indicado por el usuario para continuar en privado y hacerlo público más adelante. Se verificaron las URL de lectura y escritura; se conservan historial, HEAD, rama `feature/backend-implementation`, referencias, índice, cambios locales y `upstream`. No se hizo fetch, commit ni push, ni se cambió la visibilidad remota. Las referencias existentes de `origin` proceden del fork anterior y no acreditan el contenido del nuevo repositorio.

## Decisiones técnicas aprobadas

Elecciones aprobadas por el usuario para tres capacidades REST y cuatro tablas. Las alternativas se conservan como justificación; no son requisitos impuestos por Cocos. Versiones estables comprobadas el 2026-10-24 contra el registro npm, las publicaciones de PostgreSQL y las imágenes oficiales. Dependencias directas sin rangos y resoluciones transitivas en el lockfile; sin benchmarks de rendimiento.

| Área | Alternativas consideradas | Decisión aprobada |
| --- | --- | --- |
| Framework | Express directo requiere menos estructura inicial. NestJS aporta módulos, providers e inyección de dependencias. | NestJS 12.2.0 y `@nestjs/platform-express` 12.2.0 con Express 5.3.0. Monolito modular; Fastify no está instalado. |
| Lenguaje y runtime | JavaScript reduce configuración; TypeScript permite expresar contratos sin sustituir validación de entradas. | TypeScript 7.0.2 estricto y ESM; Node 24.22.1, última revisión de la rama [LTS elegida](https://nodejs.org/en/about/previous-releases). Tipos de Node 24.19.2, últimos compatibles con esa rama en vez de los tipos de Node 26. |
| Base y acceso | SQL directo facilita agregaciones y control transaccional; un ORM añadiría modelado y generación para cuatro tablas. | PostgreSQL 18.6, [última estable publicada](https://www.postgresql.org/support/versioning/), y pg 8.23.1. PostgreSQL 19 está en RC y no se usa. El SQL original se conserva intacto; se aprueba para la implementación futura la ampliación mínima de `orders` descrita en [idempotencia y concurrencia](#envío-de-órdenes-idempotencia-y-concurrencia). |
| Pruebas | Nest mantiene sus utilidades independientes del runner. | Vitest 5.0.5, Supertest 7.3.1 y `@nestjs/testing` 12.2.0. Unitarias aisladas por capa, integración PostgreSQL y pruebas HTTP; configuración separada para unitarias sin servicios y suite completa. |
| Ejecución local | Compose coordina servicios y espera su disponibilidad. | Dockerfile por etapas y Compose con `app`, `db` persistente y `db-test` efímera bajo perfil `test`. SQL montado solo para lectura y healthchecks de arranque. |
| Dinero y entradas | La escala de base no reemplaza la aritmética decimal de la aplicación. | decimal.js 10.6.0; ValidationPipe con class-validator 0.15.1 y class-transformer 0.5.1; `@nestjs/config` 12.0.1. El arranque actual valida PORT; reglas de dinero y validación del adapter de datos se completarán con sus CDU. |

Organización aprobada: controller → puerto de entrada del CDU → implementación del CDU → puertos de salida → adapters de infraestructura, agrupados por funcionalidad. Una interfaz por CDU con parámetros y retornos explícitos; puertos de salida para repositorios, cotizaciones y transacciones, sin interfaces para cada clase auxiliar. Dominio y CDU independientes de Nest, HTTP y SQL; modelos propios y mapeadores en adapters. Tokens centralizados, como [Symbol](https://docs.nestjs.com/fundamentals/custom-providers), porque las interfaces desaparecen al compilar. Componer con `useFactory` o alias `useExisting`, evitando registros duplicados; errores de aplicación traducidos a HTTP en la entrada. Adapter permite reemplazar dependencias, no garantiza escalabilidad operativa. Estos contratos se crearán al implementar los CDU, sin copiar el scaffold de referencia.

Propuesta de diseño aún pendiente: calcular portfolio desde órdenes, sin una tabla adicional de posiciones. La concurrencia y la idempotencia del envío ya cuentan con decisiones aprobadas en la sección siguiente; las reservas se confirman en D02. D01 cuenta con valoración y costo promedio móvil aprobados para historias válidas; permanecen abiertos los casos residuales y el tratamiento de datos inconsistentes de D03.

La infraestructura se limita a Docker local. No se justificaron microservicios, caché ni un servicio externo de mercado. Dockerfile fija `node:24.22.1-bookworm-slim`; Compose fija `postgres:18.6-bookworm`. Para PostgreSQL 18 el volumen apunta a `/var/lib/postgresql`, conforme a la [imagen oficial](https://hub.docker.com/_/postgres); el seed se ejecuta solo en volúmenes vacíos. La base de tests usa tmpfs y no comparte el volumen de desarrollo. La API expone `GET /instruments`; el pool de pg y su cierre por señales pertenecen a esa funcionalidad. Portfolio, órdenes y cancelación siguen sin endpoints. Los archivos de entorno, build y dependencias generadas se excluyen de Git y del contexto de imagen según corresponda.

## Envío de órdenes: idempotencia y concurrencia

Decisiones confirmadas por el usuario durante la revisión funcional. Son elecciones del proyecto, no requisitos adicionales atribuidos a la consigna. Esta aprobación permite documentarlas; no autoriza implementar código, migraciones o pruebas ni realizar commits o publicación.

- **Identidad de la operación:** el cliente genera un UUID antes del primer envío y lo conserva en todos sus reintentos. Un UUID distinto representa otra operación aunque sus parámetros coincidan; se valida de nuevo su disponibilidad. El ticker y el identificador autogenerado de la fila no sustituyen esta identidad.
- **Persistencia mínima:** guardar el UUID y la información necesaria para comparar la solicitud original en la propia tabla `orders`, con restricción única sobre usuario y UUID. Conservar la clave mientras exista la orden. No crear una tabla adicional ni usar caché o TTL para la creación de órdenes. La ampliación se aplicará mediante una migración futura que preserve `database.sql` y sus datos originales.
- **Reutilización:** mismo usuario, UUID y parámetros originales devuelve el resultado persistido sin crear otra orden ni recalcular el precio de ejecución. Mismo usuario y UUID con parámetros diferentes produce un conflicto. Comparar la solicitud original, incluido el modo cantidad o monto; no basta comparar la cantidad y el precio calculados. La representación concreta de esos metadatos queda pendiente.
- **Estados:** un UUID persistido significa solicitud procesada, no necesariamente ejecutada: puede corresponder a `FILLED`, `NEW` o `REJECTED`. Un rechazo persistido no se reevalúa si después cambian los recursos; un nuevo intento de negocio requiere otro UUID. Los errores de entrada que no producen una orden se resolverán en D05.
- **Bloqueo y atomicidad:** iniciar la transacción y adquirir inmediatamente el bloqueo de la fila del usuario, antes de consultar UUID, disponibilidad y validaciones de negocio. Consultar la clave después de adquirir el bloqueo; si es nueva, leer recursos, validar y persistir orden y metadatos con el mismo cliente de `pg`. Mantener el bloqueo hasta `COMMIT` o `ROLLBACK`. Los rechazos por recursos se persisten y confirman como resultados de negocio; no se revierten mediante un rollback genérico.
- **Secuencia:** procesar una operación por cuenta a la vez en la sección protegida; distintas cuentas pueden progresar en paralelo. Toda operación que afecte esos recursos debe respetar el mismo protocolo. No incorporar una cola ni garantizar FIFO estricto: el orden será el de adquisición del bloqueo, sin promesa de orden de recepción HTTP.
- **Garantía y fallos:** un único efecto confirmado por usuario y UUID; no se garantiza que toda solicitud se ejecute. Ante un resultado incierto de `COMMIT`, resolverlo usando la misma clave en PostgreSQL. Un rollback no deja una orden confirmada que impida reintentar.
- **Reintentos:** hasta tres reintentos además del intento inicial, conservando el UUID y únicamente ante fallos transitorios. Repetir la transacción completa después del rollback; no reintentar rechazos de negocio, entradas inválidas ni conflictos por parámetros distintos. Una coincidencia de la clave de idempotencia se resuelve recuperando el resultado existente, no intentando ejecutar otra orden.

**Cierre parcial D05 del 2026-10-27:** UUID en `Idempotency-Key`, usuario en ruta, entradas estructuralmente inválidas sin orden y comparación de valores decimales normalizados después de validar: `10`, `10.0` y `10.00` son equivalentes si sus representaciones son válidas. La aprobación posterior de las secuencias confirma GET `/users/:userId/portfolio`, POST `/users/:userId/orders` y códigos de envío 201/200/409; los demás detalles de contrato siguen pendientes en el spec.

**Alternativa A seleccionada:** UUID tipado y parámetros normalizados comparados directamente en `orders`, UNIQUE por usuario/UUID y bloqueo por cuenta; sin hash, caché, cola ni tabla adicional. Se mantienen los reintentos acordados; no se adopta delegarlos al cliente ni omitir la comparación. La aprobación posterior de B04-B seleccionó UUID y JSONB versionado; B04-C definió la estructura semántica v1 y su comparación. Los detalles de contrato restantes y la compatibilidad entre versiones siguen abiertos. READ COMMITTED fue aprobado posteriormente para B04-A, sin fijar la lectura consistente de portfolio.

**Pendientes técnicos de este acuerdo:** implementar la respuesta pública de recuperación/conflicto y cerrar sintaxis HTTP, compatibilidad futura y límites. B04-C implementó el modelo semántico v1 y la comparación interna; B04-D implementó la lectura por clave y la resolución interna de reenvíos. Ninguno implementó HTTP ni recuperación automática. B04-B ya tiene aprobados UUID y JSONB versionado, migración aditiva compatible con filas históricas sin UUID, presencia conjunta de clave/metadatos y unicidad por usuario/UUID; la migración y sus correcciones fueron implementadas, validadas y aceptadas tras revisión independiente. Precisar errores reintentables, esperas entre intentos y límites para adquirir conexión, esperar bloqueos, ejecutar y completar todos los intentos. No se han aprobado valores de timeout ni la espera creciente con variación aleatoria. READ COMMITTED explícito con bloqueo y lecturas posteriores separadas fue confirmado para B04-A el 2026-10-28 y está implementado, revisado y aceptado en B04-A/B04-A-R1. El [análisis de casos límite y alternativas](backend-features.spec#análisis-de-casos-límite-y-consistencia) no revoca las garantías aprobadas.

**Validación prevista del acuerdo:** comprobar reintentos concurrentes con el mismo UUID, UUID diferentes con iguales parámetros, conflicto por parámetros distintos, recuperación después de una respuesta perdida y de un reinicio, y rechazo persistido aun después de cambiar la disponibilidad. Verificar que operaciones de una cuenta respeten el bloqueo sin serializar globalmente todas las cuentas. Son comprobaciones futuras; no hay pruebas implementadas ni ejecutadas de estos comportamientos.

Referencias técnicas revisadas: [transacciones de pg](https://node-postgres.com/features/transactions), [bloqueos](https://www.postgresql.org/docs/current/explicit-locking.html#LOCKING-ROWS), [unicidad](https://www.postgresql.org/docs/current/ddl-constraints.html#DDL-CONSTRAINTS-UNIQUE-CONSTRAINTS), [reintentos de transacciones](https://www.postgresql.org/docs/current/mvcc-serialization-failure-handling.html) y [timeouts](https://www.postgresql.org/docs/current/runtime-config-client.html). No sustituyen las decisiones funcionales D01–D08.

## Referencia secundaria: skeleton hexagonal

El usuario aportó su [skeleton](https://github.com/robinalva28/nestjs-hexagonal-back-skeleton/tree/5e9da796c64132fabadcb29c4bfbbe19d319b1e4) como inspiración, sin convertirlo en referencia absoluta ni fuente de requisitos. Revisión estática de README, dependencias, configuración TypeScript, módulos, puertos, servicio, adapters y pruebas en el commit `5e9da796c64132fabadcb29c4bfbbe19d319b1e4`; no se ejecutó ni copió código.

| Hallazgo del skeleton | Adaptación aprobada para Cocos |
| --- | --- |
| `application/port/in`, `port/out`, servicio y adapters separan la entrada HTTP del acceso a datos. | Conservar esa organización por funcionalidad para portfolio, instrumentos y órdenes. Las interfaces de entrada por CDU definen una frontera útil; no crear interfaces para cada clase auxiliar. |
| GetEchoUseCase y EchoPort omiten tipos de retorno; hay campos sin tipo y opciones de comprobación desactivadas. | Contratos explícitos de entrada y `Promise<Output>`, TypeScript estricto y modelos propios. Evitar que esquemas de persistencia lleguen al controller o a los contratos de aplicación. |
| El módulo registra las clases y vuelve a registrarlas mediante `useClass`; EchoService lanza `NotFoundException` de Nest. | Una implementación por provider; usar `useExisting` si se necesita un alias, o `useFactory` para componer CDU independientes de Nest. Tokens centralizados. Errores propios de aplicación traducidos a HTTP en el adapter de entrada. Véase [providers de Nest](https://docs.nestjs.com/fundamentals/custom-providers). |
| Usa MongoDB/Mongoose y Nest 9; el e2e conserva `/` y `Hello World!`, mientras la aplicación expone `/api/echo`. | No trasladar versiones, almacenamiento ni expectativas del ejemplo. PostgreSQL/pg, puerto transaccional con cliente compartido y pruebas funcionales de órdenes con base real aislada. Las versiones verificadas están fijadas en el manifiesto y lockfile. |

El usuario aprobó posteriormente estas adaptaciones y el stack descrito arriba. La referencia sigue siendo secundaria y no resuelve D01–D08 ni añade requisitos del skeleton al challenge. No se importa su scaffold ni sus funcionalidades de ejemplo.

## Convenciones y documentación operativa

Las reglas aprobadas están en AGENTS.md; versiones y resoluciones npm en el manifiesto y lockfile; imágenes en Dockerfile/Compose; comandos reales y alcance del arranque en README. Mantener estos archivos sincronizados al avanzar:

- `AGENTS.md`: ampliar convenciones solo cuando se adopten al implementar los CDU y adapters.
- `README.md`: añadir comandos y verificaciones cuando existan, distinguiendo sintaxis/configuración comprobada de ejecución de contenedores y pruebas funcionales.

No documentar funcionalidades ni pruebas pendientes como si estuvieran implementadas.

## Decisiones funcionales confirmadas

### Precisión monetaria — Limitación aceptada temporalmente

El usuario decidió continuar con `price` y cotizaciones declarados como `NUMERIC(10, 2)`, sin ampliar ahora su precisión ni modificar el SQL original. Esta decisión reemplaza, por el momento, la intención de conservar todos los decimales en persistencia. Se mantiene la presentación monetaria a dos decimales; el criterio de desempate del redondeo de presentación y la precisión de divisiones siguen pendientes en D01/D04. La aceptación de esta limitación permite avanzar en las especificaciones; no autoriza implementar código o migraciones.

> **WARNING — Pérdida de precisión y propagación a cálculos monetarios:** PostgreSQL redondea a la escala declarada al almacenar valores con más de dos decimales. Por ejemplo, el `previousClose` original de `1047.166` queda en `1047.17`. Los cálculos posteriores usan ese valor redondeado y pueden diferir de los calculados con la precisión de origen. La precisión perdida no se recupera usando `decimal.js` ni ampliando la columna después de la carga. Se acepta temporalmente esta limitación del almacenamiento; no se afirma que toda operación aritmética pierda precisión ni se autoriza calcular dinero con coma flotante binaria o redondear cada paso intermedio.

Evidencia: declaraciones y literal en [database.sql](../database.sql), líneas 20, 32–36 y 218; comportamiento documentado de [NUMERIC en PostgreSQL](https://www.postgresql.org/docs/current/datatype-numeric.html#DATATYPE-NUMERIC-DECIMAL). El 2026-10-27 se confirma rechazar nuevos precios LIMIT y montos `amount` con más de dos decimales, sin aplicar esa validación retroactivamente al seed. La inspección de sus cotizaciones identifica un solo valor con precisión efectiva superior a dos decimales; los demás dígitos adicionales son ceros finales. La base viva no fue consultada al no estar accesibles los motores Docker. Se conserva la escala vigente y se registra el análisis de riesgos/costo como [follow-up](../README.md#follow-ups); no se modifica ni recarga el SQL. Este warning es documental; no añade un campo de advertencias a la API.

### D01, D04 y D05 — Recomendaciones aceptadas para especificación

- **D01:** valorar posición con cantidad neta FILLED por último close; total de cuenta con efectivo contable más posiciones, sin descontar reservas dos veces. Costo promedio ponderado móvil para el rendimiento total de la posición abierta; ventas reducen costo proporcionalmente. No añadir otra métrica de ganancia realizada. Casos normales y aceptación en [F01](backend-features.spec#f01--portfolio-y-rendimiento-de-posiciones-d01); posiciones inválidas, desempates y representación excepcional siguen pendientes.
- **D04:** exactamente uno de cantidad/monto, positivo; cantidad entera; convertir monto con precio LIMIT o último close MARKET y tomar la máxima cantidad entera, rechazando cero. Admitir monto para BUY y SELL, rechazar precio explícito en MARKET y precios LIMIT de más de dos decimales. El usuario confirmó también máximo dos decimales para amount. Reglas y evidencia histórica en [F04](backend-features.spec#f04--entrada-de-órdenes-cantidad-monto-y-escala-d04); la sintaxis HTTP concreta sigue pendiente.
- **D05:** usuario en ruta para portfolio/órdenes, entrada estructuralmente inválida sin persistencia, insuficiencia como REJECTED persistido, UUID en `Idempotency-Key` y conflicto explícito por parámetros distintos. Comparar valores válidos normalizados, no su escritura decimal. Alternativa A confirmada; contrato parcial, riesgos y pendientes en [F05](backend-features.spec#f05--contrato-de-envío-e-idempotencia-d05). Se mantienen comparación, bloqueo y reintentos.
- **D03:** el usuario investigará la inconsistencia histórica; no aprobó todavía cómo representarla. D06 y sus acuerdos se detallan en [F06](backend-features.spec#f06--búsqueda-de-instrumentos-análisis-de-ilike-d06); las preguntas residuales de D07–D08 se detallan en F07/F08.
- **D06 — confirmado:** GET `/instruments?query=...`, sin ARS/MONEDA; catálogo ACCIONES. Al aprobar la secuencia se confirma subcadena literal ILIKE/OR, trim, escape, parametrización, 400 para entrada ausente/vacía/no textual, 200 con lista o [], y orden ticker/id. En la coordinación SDD del 2026-10-27 el usuario cierra Q05: array con `id`, `ticker`, `name`, conservando nulos; query única, rechazando listas/objetos/repeticiones; máximo 255 caracteres Unicode tras trim, sin truncar; errores de entrada 400 y técnicos 500 con mensajes genéricos y diagnóstico interno sanitizado. El acuerdo de errores se limita a búsqueda, sin cerrar el contrato técnico de los demás endpoints. Es una decisión del proyecto, no una tecnología exigida por la consigna.
- **D07 — confirmado:** mayor fecha no nula y mayor id ante empate, sin sustituir un último close inválido por uno anterior. Retorno diario null cuando falta base válida de previousClose, conservando posiciones; si falta close necesario, falla el portfolio completo. Errores públicos genéricos y diagnóstico/traza interno. [F07](backend-features.spec#f07--cotizaciones-incompletas-y-errores-públicos-d07) distingue estos acuerdos de fórmula, validaciones concretas, persistencia de MARKET no procesable y códigos HTTP aún propuestos. El seed no tiene close/previousClose nulos o no positivos; faltan cotizaciones completas para dos acciones.
- **D08 — confirmado:** endpoint y CDU independiente POST `/users/:userId/orders/:orderId/cancel`, sin body ni UUID nuevo. NEW → CANCELLED libera reservas y responde 200; repetir devuelve 200 sin efectos; FILLED/REJECTED devuelven 409. Reenviar creación con su UUID original recupera la misma orden con estado actual, sin reabrirla; otra intención de operar requiere otro UUID. [F08](backend-features.spec#f08--cancelación-independiente-y-transferencias-existentes-d08) desarrolla consistencia y detalles de payload/errores todavía propuestos. Se contabilizan transferencias existentes sin añadir una API de creación.
- **Seguimiento solicitado:** [CLAUDE.md](../CLAUDE.md) indica registrar cada follow-up pedido por el usuario en una sección breve al final del README. Registrar un seguimiento no autoriza su implementación.

### D02 — Reservas de órdenes NEW

El usuario confirmó reservar pesos y acciones mientras las órdenes LIMIT permanezcan en `NEW`.

- `BUY NEW` reserva `size × price`, usando su precio límite; `SELL NEW` reserva `size` acciones del instrumento correspondiente.
- Pesos disponibles = efectivo contable de movimientos ejecutados menos reservas de compras `NEW`. Acciones disponibles de cada instrumento = tenencia ejecutada menos reservas de ventas `NEW`. Usar estos disponibles para validar nuevas órdenes dentro del bloqueo de la cuenta.
- Las reservas no representan ejecuciones: no cambian el efectivo contable ni la cantidad de acciones ejecutadas. No descontar la reserva de compra otra vez al calcular el valor total de la cuenta; aplicar D01 a historias válidas y resolver sus casos residuales antes del comportamiento afectado.
- Una orden que deja de estar `NEW` deja de aportar reservas; si está `FILLED`, sus efectos se contabilizan como ejecución. Esto no incorpora ejecución diferida. El diseño de un endpoint independiente de cancelación se incluye por instrucción posterior en D08; su implementación no está autorizada.
- El reintento con el mismo UUID no crea otra orden ni duplica la reserva. Una orden rechazada no reserva recursos.

Validación futura: con efectivo contable de 1.000 y compras `NEW` por 300, devolver 700 disponibles; con 10 acciones ejecutadas y ventas `NEW` por 6, disponer de 4 para nuevas ventas. Verificar rechazo por exceder recursos disponibles y ausencia de reserva duplicada al reintentar. D03 sigue pendiente para representar tenencias originales negativas; no se corrigen ni ocultan con esta decisión.

## Pendientes funcionales

No corregir los datos ni resolver estos puntos incorporando reglas de los otros challenges. Antes de implementar el comportamiento afectado, confirmar una regla o aprobar explícitamente un supuesto documentado.

| ID | Ambigüedad y consecuencia | Propuesta para revisión |
| --- | --- | --- |
| D01 | Valoración y costo promedio móvil aprobados para historias válidas; quedan desempates, posiciones vacías, denominadores inválidos y precisión de divisiones/presentación. | Cerrar Q01/Q03 del spec. Mantener separado el retorno diario; su fórmula/exposición se completa con D07. No extrapolar el costo móvil a D03 sin una decisión. |
| D03 | El ejemplo contiene una venta FILLED que deja una tenencia negativa. Ocultarla o ajustar el seed falsearía los datos y el costo/rendimiento no puede inferirse con seguridad. | Mantener los datos, mostrar la cantidad neta real y definir representación de costo/rendimiento no calculable. Confirmar cómo informar la inconsistencia; no asumir soporte para ventas en corto ni permitir nuevas ventas sin acciones. |
| D04 | Reglas de cantidad/monto y escala aceptadas; quedan sintaxis decimal, ceros finales extra, rangos y redondeo de presentación. | Cerrar Q02/Q03 del spec sin reabrir las reglas confirmadas. Mantener coherencia entre valores validados y persistidos; riesgos de redondeo en el follow-up del README. |
| D05 | Alternativa A, rutas de portfolio/envío y códigos 201/200/409 confirmados, además de header, comparación, bloqueo y READ COMMITTED explícito para B04-A. | Cerrar Q04: payloads, errores HTTP restantes, compatibilidad entre versiones, recuperación y límites/reintentos. Las opciones B/C no se adoptan; no se elimina comparación, bloqueo o reintentos. B04-A/B04-A-R1 implementó la unidad transaccional de un intento; B04-B preparó la migración aditiva con UUID/JSONB versionado, nulos históricos, presencia conjunta y unicidad por usuario/clave; B04-C implementó el modelo de intención v1, normalización y comparación; B04-D implementó la lectura por clave y la resolución de reenvíos. La lectura consistente de portfolio sigue sin definirse. |
| D07 | Selección fecha/id, sin reemplazo anterior, null para retorno diario sin base, error completo si falta close y mensajes genéricos confirmados. | Cerrar F07/Q06: fórmula/validaciones concretas, ausencia de fila para MARKET no procesable, nombre del campo diario y códigos/cuerpo técnico. ARS no necesita cotización. No reabrir las reglas confirmadas. |
| D08 | Endpoint, ruta/método, repetición 200 sin efectos, conflicto 409, entrada inválida 400, mismo 404 para orden inexistente/ajena y replay actual confirmados. | Cerrar F08/Q07: proyección de salida, validación concreta, usuario inexistente y mensajes. No reabrir órdenes ni duplicar reservas con el mismo UUID. Transferencias existentes sin API de creación. |

B01/D06 ya no figura en esta tabla: fue implementado y validado; el detalle está en [Implementación y validación B01](#implementación-y-validación-b01).

## Tareas futuras y dependencias

La preparación inicial está versionada y la base técnica de T02 está validada. Stack, arquitectura, idempotencia, concurrencia y reservas D02 están definidos; D01/D04/D05 tienen reglas aceptadas y preguntas residuales en el spec. D06/Q05 está cerrado e implementado en B01; B02 cubrió la lectura y el cálculo base de T03, sin costo, valoración ni precios. B03 agregó la lectura base de última cotización, todavía sin cálculos ni consumidores. B04-A/B04-A-R1 agregó la unidad transaccional por cuenta, sin envío de órdenes, idempotencia ni reintentos. B04-B agregó la migración aditiva de identidad idempotente en `orders`, sin comparación, recuperación ni escritura de órdenes. B04-C agregó el modelo puro de intención v1, normalización y comparación, sin HTTP, persistencia ni ejecución. B04-D agregó la lectura por usuario/UUID y la resolución interna de reenvíos, sin creación, recuperación ni endpoints. D03 y los contratos residuales de D07–D08 siguen abiertos. El diseño de cancelación ya está incluido. T05, T06 y la parte de portfolio de T04 no están implementadas.

Coordinación SDD: B01-R1 y B02/B02-R1 fueron aceptados y versionados localmente. El usuario autorizó los commits locales de B03/B03-R1, B04-A/B04-A-R1, B04-B/R1/R2 y B04-C; B04-A quedó en `e57de25`, B04-B en `35f87f4` y B04-C en `87f2276`. Se conserva Vitest; no hay autorización de publicación. B04-D fue aceptado tras revisión independiente; el usuario autorizó su único commit local, sin publicación. Q04 conserva decisiones abiertas sobre HTTP, compatibilidad entre versiones, recuperación y límites; B04-D no las cierra.

B04-A aprobado por el usuario el 2026-10-28: puerto y adapter transaccional por cuenta con READ COMMITTED explícito, bloqueo inicial del usuario, lecturas posteriores en statements separados y un mismo cliente pg. El bloque realiza un intento y verifica el ciclo de vida, cliente compartido y concurrencia por cuenta; no implementa todavía migración/metadatos de idempotencia, política automática de reintentos ni nuevos timeouts. Estos elementos deberán completarse antes del envío de órdenes y la partición no elimina las garantías previas. Puerto y contexto independientes de pg/SQL/Nest/HTTP; composición de adapters ligados al cliente en infraestructura. B04-A se implementó y validó localmente el 2026-10-28; B04-A-R1 corrigió la confirmación efectiva de COMMIT y la limpieza concurrente. Detalle en [Implementación y validación B04-A](#implementación-y-validación-b04-a) y [Corrección B04-A-R1](#corrección-b04-a-r1--confirmación-efectiva-y-limpieza). B04-A/B04-A-R1 aceptados tras revisión independiente; el usuario autorizó el único commit local del bloque, materializado en `e57de25`. B04-B fue implementado y validado localmente después; ver [Implementación y validación B04-B](#implementación-y-validación-b04-b). No hay autorización de commit ni publicación de B04-B.

Bloque B03 implementado como lectura interna de la última fila de `marketdata` por instrumento. El puerto `LatestQuoteRepository.findLatestByInstrumentId`, el modelo `LatestQuote` y el adapter `PostgresLatestQuoteRepository` seleccionan por mayor `date` no nula y mayor `id` ante empate, sin filtrar precios ni retroceder a otra fila. `close` y `previousClose` se conservan como texto decimal, incluidos sus nulos; la fecha se expone como texto de calendario `YYYY-MM-DD`. La ausencia de fila se representa con `null` y un fallo de lectura se propaga. No hay controller, CDU REST, consumidores, transacciones ni cálculos de retorno. La cobertura corresponde a la selección de AC25; no cierra F07/Q06 ni AC26–AC28 y no modifica la fuente SQL. Detalle en [Implementación y validación B03](#implementación-y-validación-b03).

Bloque B02 implementado y corregido en B02-R1: cálculo interno de efectivo contable, tenencias ejecutadas, reservas NEW y recursos disponibles, con lectura de movimientos por cuenta mediante puerto y adapter pg. Depende del acceso pg de B01 y de R09/R10/D02. No expone endpoints ni decide costo móvil, valoración, presentación o respuesta pública para D03. Se conserva la cantidad negativa obtenida de los movimientos, sin corregirla ni inferir ventas en corto. Los contratos internos y nombres técnicos se definieron al implementar; Q01–Q04/Q06/Q07 continúan abiertos en sus comportamientos afectados. Se agregaron unitarias por capa e integración PostgreSQL aislada; no hay garantía transaccional o de concurrencia implementada por añadir esta lectura. Detalle en [Implementación y validación B02](#implementación-y-validación-b02).

| Tarea | Depende de | Entrega y validación prevista |
| --- | --- | --- |
| T00 — Revisar preparación | Esta documentación | Setup versionado en 57c518e. El usuario solicitó continuar hacia implementación, comenzando por definir el stack; no autorizó nuevos commits ni publicación. |
| T01 — Cerrar contrato y stack | T00 | Stack, arquitectura y reservas D02 aprobados; versiones verificadas y fijadas. D06/Q05 cerrado e implementado; cerrar preguntas residuales de D01/D04/D05, investigar D03 y revisar los contratos de D07–D08 antes del comportamiento afectado; vincular spec y R01–R15. |
| T02 — Base técnica y datos | Stack aprobado de T01 | Bootstrap, dependencias y Dockerfile/Compose preparados. Validar ejecución local y seed sin editar; la conexión pg y el contrato de errores de búsqueda están implementados en B01. B04-A agregó la unidad transaccional y B04-B la migración aditiva de identidad en `orders`; transacciones y errores de los demás CDU siguen pendientes. Conservar el SQL original. |
| T03 — Consultas contables y de mercado | T02; D01–D03, D07 | B02 implementó tenencias ejecutadas, cash contable, reservas NEW, disponibilidad y la lectura pg por cuenta. B03 implementó la lectura pg de la última fila de cotización por instrumento, sin cálculos ni consumidores. Quedan costo, valoración, retorno diario, consumidores y el tratamiento público del seed inconsistente. Base compartida por portfolio y órdenes. |
| T04 — Portfolio y búsqueda | T03 para portfolio; T02 para búsqueda; D05/D06 | Búsqueda R02 implementada y validada en B01. Portfolio R01 continúa pendiente de T03 y del cierre de D01/D03/D07. |
| T05 — Envío de órdenes y test funcional | T03; D02/D04/D05/D07; acuerdo de idempotencia y concurrencia | BUY/SELL, MARKET/LIMIT, cantidad/monto, persistencia de FILLED/NEW/REJECTED y actualización observable. Incorporar UUID por operación, unicidad por usuario, comparación de parámetros originales, bloqueo inicial y política de reintentos acordada. B04-C aporta la intención v1 y B04-D la lectura por clave con resolución de reenvíos; falta el CDU de envío. Incluir el test funcional de R14 y verificar el acuerdo de idempotencia; casos adicionales de insuficiencia y conversión según riesgo, sin inventar cobertura porcentual obligatoria. |
| T06 — Cancelación independiente | T02; reservas D02 y protocolo D05; contrato D08 | Alcance de diseño incluido. Implementar cuando se autorice, con CDU propio y puertos compartidos, sin llamar al CDU de envío. Verificar estados, reservas, pertenencia y concurrencia/reenvíos junto con T05. |
| T07 — Validación y documentación de entrega | T04/T05/T06 | Ejecutar pruebas existentes, contrastar R01–R15 y documentar comandos reales, decisiones y resultados. Añadir O01 solo si se elige. Revisar privacidad y diff; preparar propuesta de commit(s) para autorización. |
| T08 — Publicación y PR futuros | T07; autorizaciones separadas | Confirmar repositorio destino y base main; revisar rama y commits aprobados, publicar solo con permiso explícito y abrir PR solo cuando esté autorizado. No hacer merge por inferencia. |

Los commits futuros se agrupan por tarea coherente y se autorizan individualmente o como conjunto delimitado. La separación de tareas no obliga a fragmentar cambios que necesiten viajar juntos para funcionar.

## Condiciones para comenzar la implementación

1. El usuario autorizó la base técnica, dependencias y Docker local. Esto no implica nuevos permisos de commit, push, PR o merge.
2. El stack, D02 y las reglas documentadas de D01/D04/D05 están aprobados. D06/Q05 está cerrado e implementado en B01; D03 y los contratos residuales de D07–D08 siguen abiertos y deben resolverse antes de codificar sus comportamientos afectados. El spec parcial no concede autorización de implementación.
3. Verificar nuevamente trabajo local, rama y remotos. El historial local está conservado; `origin` apunta ahora a `backend-cocos`. El cambio de URL no verifica acceso ni contenido del nuevo repositorio.
4. Verificar el arranque de los servicios Compose y el seed en PostgreSQL aislado, sin modificar la fuente SQL ni utilizar servicios de producción. La configuración está preparada; registrar por separado su validación y su ejecución real.

## Versionado autorizado y flujo de entrega propuesto

La preparación y la implementación posterior, cuando se autorice, se mantienen en `feature/backend-implementation`, sin crear una rama adicional para la solución. La base sigue siendo el historial original conservado localmente; `origin` apunta a `backend-cocos` y el fork anterior deja de ser el destino de trabajo.

El usuario autorizó un único commit de B01 después de una revisión satisfactoria. La revisión final acepta la búsqueda, el acceso pg mínimo, las pruebas y configuración por grupos, la sanitización corregida y su documentación como una entrega coherente. Mensaje: `feat(instruments): implement literal instrument search`. La autorización se aplica a ese commit; no permite commits de B02, push, PR ni merge. El registro local de sesiones permanece excluido.

Autorización posterior del 2026-10-28: un único commit de B02/B02-R1, ya revisados, con cálculo interno de recursos, lectura pg, pruebas y documentación asociada. Mensaje: `feat(resources): calculate account cash and reservations`. Esta autorización es independiente de la de B01 y no permite push, PR, merge ni commits de B03. El prompt de B03 es el siguiente entregable; no se ejecuta implementación por el coordinador.

Autorización posterior del 2026-10-28: un único commit local de B03/B03-R1, ya revisados, con lectura de cotización, selección por fecha nativa e id, pruebas, composición y documentación asociada. Mensaje: `feat(quotes): read latest instrument quote`. Esta autorización se aplica únicamente a ese commit; no incluye publicación ni commits de B04. El siguiente trabajo del coordinador es cerrar lo necesario de Q04 y preparar un único prompt acotado para B04.

B04-A fue implementado y validado localmente por el modelo externo. B04-A-R1 corrigió la confirmación efectiva de COMMIT y la limpieza del test concurrente. El usuario autorizó un único commit local de este bloque, sin publicación; la revisión independiente de aceptación ya se completó sin nuevos hallazgos y el commit quedó en `e57de25`. La política de hasta tres reintentos y la recuperación idempotente no se implementaron en B04-A.

B04-B fue implementado y validado localmente. El usuario autorizó su único commit local en `35f87f4`, sin publicación; la autorización no se extiende a otros bloques.

B04-C fue implementado y validado localmente. El usuario autorizó su único commit local en `87f2276`, sin publicación; la autorización no se extiende a otros bloques. B04-D fue implementado y validado localmente, sin commit ni publicación; la revisión independiente aceptó B04-D dentro de su alcance de lectura y resolución interna.

El usuario autorizó el commit `docs: prepare backend challenge setup`, realizado como `57c518e` con los diez archivos del setup y sin `.DS_Store`. Esa autorización ya fue utilizada y no habilita otros commits, push, PR ni merge. La solicitud posterior de continuar con la implementación se trata con el alcance definido al inicio de este plan. Las reglas de commits atómicos y autorizaciones independientes permanecen vigentes.

Posteriormente autorizó un único commit de la base técnica preparada: `chore: bootstrap NestJS Express and Docker environment`. Incluye quince archivos de arranque, Docker, dependencias, convenciones, documentación y registro de sesión. Excluye `.env`, `.DS_Store`, dependencias instaladas y archivos compilados. No habilita push, PR, merge ni commits adicionales.

Destino de trabajo confirmado el 2026-10-27: repositorio `backend-cocos` indicado por el usuario, inicialmente privado y con intención de hacerlo público para la entrega. Esto reemplaza la publicación propuesta en el fork anterior. La autorización actual se limita al cambio local de `origin`: no permite push, cambio de visibilidad, PR ni merge. Antes de publicar, obtener autorización y confirmar la rama destino; el destino de un eventual PR sigue pendiente. El usuario solicitó detenerse después del cambio de remoto, sin pushear.

Autorización posterior del 2026-10-27: el usuario solicitó commits atómicos de la documentación y análisis acumulados. El conjunto se separa en exclusión de registros locales, especificación/decisiones y diseño aprobado. `ailogs/` deja de versionarse, conservando sus archivos locales; se elimina el enlace público del README a un registro local. El usuario confirmó incluir la eliminación del PNG anterior, conservando Excalidraw como diseño editable. Esta autorización permite esos commits locales, sin push ni publicación.

## Criterios de finalización de la preparación inicial

- Estado del fork, copia local e historial verificado o bloqueo concreto documentado; fuentes originales y Markdown de otros challenges conservados intactos.
- Documentación lista para revisión: requisitos verificables, plan con dependencias, decisiones confirmadas separadas de propuestas, dudas y condiciones de inicio; documentación técnica futura identificada como pendiente.
- Reglas permanentes en AGENTS.md y registro de esta conversación actualizado y ofuscado; etapa e historia del repositorio concentradas en este plan.
- Validación documental de AGENTS.md completada, diferencias y resultados presentados; ninguna implementación ni operación prohibida realizada. Las dudas funcionales explícitas no impiden cerrar la preparación, pero deben resolverse o aprobarse como supuestos antes del comportamiento afectado.

## Resultados de validación

Validación inicial de preparación:

Resultado: seis archivos originales idénticos byte por byte al commit de referencia, incluidos SQL y todos los Markdown de otros challenges; cinco documentos nuevos y 16 enlaces locales válidos en todos los Markdown. Los documentos nuevos no tienen espacios finales y terminan con salto de línea. Registro revisado para ofuscar información personal; comprobación adicional sin cuenta identificable, rutas personales, correos ni patrones de credenciales.

HEAD permanece en el commit original; rama `chore/backend-preparation`, índice vacío, cinco archivos nuevos sin seguimiento y ningún cambio en archivos versionados. Fork, padre, origen de red, main y remotos verificados; sin repositorios anidados ni commits nuevos. No se crearon archivos de aplicación, pruebas, dependencias, infraestructura o pipelines, ni se hicieron push, PR o merges. Se revisaron únicamente documentos y Git: no se ejecutó SQL ni se realizaron pruebas de aplicación.

Revisión de reglas permanentes: etapa e historia concentradas en este plan; autorizaciones independientes y criterios documentales definidos en AGENTS.md; stack, convenciones y comandos reales pendientes de la etapa autorizada. Se contrastó la coherencia con requisitos y README, sin cambiar esos archivos. `git diff --check` y su variante para el índice, sin errores; revisión adicional con `--no-index --check` de los cinco documentos sin seguimiento, sin diagnósticos de espacios. Enlaces locales y privacidad del registro comprobados. La comparación con el inicio de esta corrección limita los cambios a AGENTS.md, este plan y el registro de sesión; el resto de los archivos, HEAD e índice permanecen intactos.

Validación de la base técnica autorizada:

- Instalación con versiones exactas, lockfile y resolución de dependencias sin errores de peers; Node 24.22.1 y npm 11.19.1 incluidos en esa distribución. `npm run typecheck` y `npm run build` correctos. Sin Fastify en el árbol instalado.
- Configuración Compose validada con el perfil de pruebas. Imagen por etapas construida en Linux arm64; `npm ci` de build y runtime correctos, con dependencias de desarrollo omitidas en la imagen final. API y base de desarrollo saludables; proceso de API sin privilegios de root.
- Arranque nativo y en contenedor usando Express; raíz HTTP 404 al no existir aún endpoints del challenge. PORT inválido rechazado al iniciar. La API se publica localmente en 3001 mediante `.env` ignorado, preservando el proceso existente en 3000; la base también acepta conexiones locales en 5432.
- PostgreSQL 18.6 y seed verificados tanto en desarrollo como en la base de pruebas: 4 usuarios, 66 instrumentos, 11 órdenes y 126 cotizaciones. Consultas de lectura mediante pg; NUMERIC recibido como texto y comprobación decimal exacta. No se alteró el SQL de origen.
- Se inició el perfil existente de Colima sin cambiar el contexto Docker activo. Compose 5.6.1 y Buildx 0.38.1 se usaron desde herramientas temporales verificadas, sin instalación global. La base de pruebas y su contenedor efímero se retiraron después de validar; API y base de desarrollo quedan en ejecución.
- No se creó ni ejecutó una suite funcional de órdenes ni se implementaron CDU, repositorios o reglas D01–D08. Estas comprobaciones validan infraestructura y arranque, no la solución funcional del challenge; se realizaron antes del commit de base técnica autorizado. Sin push.

Revisión documental de idempotencia y concurrencia:

- Se incorporan las definiciones aprobadas y sus pendientes, sin resolver D01–D08 por inferencia. Se actualizan las dependencias de implementación futura y se aclara la diferencia entre las etiquetas propuestas del diagrama y el stack ya aprobado.
- Enlaces locales y anclas de instrucciones, README, requisitos, plan y registro comprobados: 24 destinos válidos. Se revisa coherencia documental; se conservan sin cambios consigna, SQL, instrucciones, README, requisitos y el registro previo con modificaciones ajenas, verificados por hash respecto del inicio de esta revisión.
- `git diff --check`, revisión del índice y comprobación de espacios del nuevo registro sin diagnósticos. Registro revisado por privacidad. Solo se modifican este plan y el nuevo registro de la conversación; no se implementa ni ejecuta código, migraciones o pruebas de aplicación, ni se realiza commit o publicación.

Confirmación documental de reservas D02:

- Se mueve D02 desde pendientes a decisiones confirmadas, con reservas de pesos para compras y de acciones para ventas `NEW`, sin duplicarlas al reintentar. Se sincronizan las referencias de requisitos y los pendientes vigentes; D01 y D03–D08 continúan abiertos.
- Revisión de diferencias, índice, espacios, enlaces locales, anclas y privacidad del registro. Solo se actualizan plan, referencias de requisitos y el mismo registro de sesión. No se crean ni ejecutan implementación, migraciones o pruebas de aplicación; sin commits ni publicación.

## Implementación y validación B01

Implementación autorizada por el usuario el 2026-10-27, limitada a B01; sin commit, push, PR ni merge. El código, los identificadores y los mensajes internos nuevos quedaron en inglés por instrucción del usuario; la documentación se mantiene en español.

### Revisión independiente y corrección B01-R1

- Requisito adicional explícito del usuario: pruebas unitarias aisladas en servicios, adapters, contratos de puertos y persistencia. Se conserva Vitest ya instalado y aprobado. Los puertos sin código ejecutable se verifican con consumidores/implementaciones tipados y pruebas de contrato; no se crean pruebas vacías para interfaces.
- En la inspección inicial se identificaron dos casos unitarios del adapter pg/escape y pruebas HTTP con un repositorio falso, además de integración PostgreSQL y HTTP con base real. Faltaban pruebas unitarias puras del servicio/CDU y de los adapters HTTP, así como completar casos aislados de persistencia, configuración y diagnóstico.
- Hallazgo inicial reproducido con datos sintéticos: `sanitizeDiagnostic` solo eliminaba la forma `password=...`; conservaba credenciales de una URL de conexión y valores interpolados en mensajes de error. Además concatenaba `name` y `code` sin normalizar, permitiendo saltos de línea en el log. AC24 quedó pendiente en esa revisión.
- Validación inicial de la revisión: typecheck de aplicación y pruebas, y build correctos con Node 24.22.1; 4 archivos y 48 pruebas aprobadas. La corrección B01-R1 se validó por separado.
- **Resolución B01-R1:** `sanitizeDiagnostic` recibe contexto estático de operación y emite únicamente operación validada, nombre de error permitido, código permitido con descripción estática y causas acotadas. No emite mensajes arbitrarios, URLs, credenciales ni valores de solicitudes. El filtro HTTP usa `instrument-search` y el pool usa `postgres-idle-client`; ambos consumidores tienen pruebas del contenido real del logger. Los códigos desconocidos o mal formados se omiten.
- Se añadieron unitarias aisladas para servicio/CDU, controller, pipe/DTO, filtro HTTP, persistencia con cliente pg falso, configuración, creación/cierre del pool con dobles y diagnósticos. No se exportaron clases internas para facilitar pruebas. Los contratos de puertos se verificaron con dobles tipados y las implementaciones existentes.
- Se separaron las configuraciones: `npm run test:unit` no carga entorno de base ni servicios; `npm run test:integration` usa PostgreSQL aislado; `npm run test:http` ejecuta las pruebas HTTP; `npm test` conserva la suite completa.
- Validación: 8 archivos y 53 unitarias aprobadas sin `db-test`; 1 archivo y 15 pruebas de integración; 2 archivos y 31 pruebas HTTP; suite completa 11 archivos y 99 pruebas. Typecheck de aplicación y pruebas, y build con Node 24.22.1. La regresión HTTP conserva contrato, búsqueda literal, proyección, nulos y reglas Unicode.
- La evidencia real del consumidor HTTP mostró `operation=instrument-search; SearchInstrumentsError: error message redacted <- Error [ECONNREFUSED]: connection refused`, sin credenciales ni saltos de línea. La prueba del pool verifica el mismo criterio con el contexto `postgres-idle-client`.
- PostgreSQL real de `db-test` se creó con el contexto Colima por comando, sin cambiar el contexto activo ni tocar desarrollo. Tras las pruebas: 66 instrumentos, 11 órdenes, 126 cotizaciones y ningún fixture de instrumentos con id >= 1000. Se retiró únicamente el contenedor de pruebas creado para esta revisión. Consigna y SQL idénticos al original.
- Diferencias e índice revisados; índice vacío y comprobaciones de espacios sin diagnósticos. No se realizó commit, push, PR ni merge. B02 no comienza todavía.

### Resultado de revisión final

- Se inspeccionaron la corrección, las ocho suites unitarias y sus consumidores. Diagnósticos limitados a operación estática y metadatos permitidos; el filtro HTTP y el pool verifican el contenido del logger. Los pendientes B01-R1 quedan resueltos.
- Ejecución independiente en Node 24.22.1: tipos de aplicación y pruebas y build correctos; grupo unitario con `db-test` apagado y `TEST_PGDATABASE` deliberadamente incompatible con integración: 8 archivos y 53 pruebas aprobadas. Suite completa con PostgreSQL aislado: 11 archivos y 99 pruebas aprobadas.
- Después de la suite se comprobaron 66 instrumentos, 11 órdenes, 126 cotizaciones y cero fixtures de instrumentos con id >= 1000. Se retiró únicamente el contenedor efímero creado para la revisión. SQL y consigna originales intactos; dependencias sin cambios de versión.
- B01 aceptado para su commit local autorizado. No se ejecutó nuevamente la imagen Docker de la aplicación ni un benchmark; las regresiones HTTP se ejecutaron con Nest/Express mediante la suite. No se atribuyen estas validaciones a portfolio u órdenes.

### Alcance implementado

- `GET /instruments?query=...` de extremo a extremo: controller HTTP → puerto de entrada → `SearchInstrumentsService` → puerto de salida → `PostgresInstrumentSearchRepository` → pg/PostgreSQL.
- Validación en el adapter HTTP: una sola clave `query`, valor string, `trim` exterior, 1–255 puntos de código Unicode y rechazo de ausencia, vacío, espacios, listas, objetos, repetición y otros parámetros con 400 genérico. El `SearchInstrumentsQueryPipe` usa class-transformer/class-validator; el `ValidationPipe` global se conserva y la validación no depende de metadatos de decoradores para ejecutarse en Vitest.
- Búsqueda: patrón `%texto%` con escape único de `!`, `%` y `_` en `toLiteralContainsPattern`; SQL parametrizado con `$1`, `ILIKE ... ESCAPE '!'`, `type = 'ACCIONES'` y paréntesis sobre el OR; orden `ticker ASC, id ASC`; proyección `id, ticker, name`; sin join a `marketdata`.
- Errores: `InstrumentsExceptionFilter` responde 400 genérico para entrada inválida y 500 genérico para fallos. `SearchInstrumentsError` envuelve el error del repositorio; el diagnóstico sanitizado se registra solo en el servidor. Un fallo no se sustituye por `[]`.
- pg: `DatabaseModule` crea un único `Pool` con `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER` y `PGPASSWORD`, y lo cierra en `onApplicationShutdown`. Los tokens `PG_POOL`, `SEARCH_INSTRUMENTS_USE_CASE` e `INSTRUMENT_SEARCH_REPOSITORY` componen con `useFactory`; no se registran instancias duplicadas. Dominio y CDU no importan Nest, HTTP ni SQL.
- Los nombres `SearchInstrumentsQueryPipe`, `SearchInstrumentsService`, `PostgresInstrumentSearchRepository`, `InstrumentsExceptionFilter`, `DatabaseModule`, `PG_POOL` y `toLiteralContainsPattern` son detalles técnicos de esta implementación, no decisiones previas.
- La longitud se cuenta con `Array.from`, es decir, puntos de código Unicode, no unidades UTF-16. Es la interpretación técnica de «caracteres Unicode» ya aprobada.
- Los mensajes públicos elegidos son `Invalid request.` y `Instrument search could not be completed.`; no se fijó un texto común para el resto de la API.

### Pruebas y evidencia

- Unitarias aisladas (`npm run test:unit`): servicio/CDU, controller, pipe/DTO, filtro HTTP con host/respuesta/logger falsos, persistencia con cliente pg falso, configuración, creación/cierre del pool con dobles y diagnósticos. Cubren delegación y error con causa, trim, Unicode y límites, mapeo y nulos, parámetros separados del SQL, fallo del cliente, configuración válida/inválida, cierre del pool y sanitización del logger. 8 archivos y 53 pruebas.
- `test/instruments/postgres-instrument-search.repository.integration.test.ts`: PostgreSQL real de `db-test`; ILIKE sin distinguir mayúsculas, ticker O name sin duplicado, orden ticker/id, nulos, `%`/`_`/`!` literales con señuelos, texto SQL-like, filtro `ACCIONES` en ambos lados, ARS/PESOS, acción sin cotización y ausencia de cambios en `orders`. Fixtures 1101–1199 eliminados al finalizar. 15 pruebas.
- `test/instruments/search-instruments.validation.http.test.ts`: app Nest/Express real con repositorio falso; entradas inválidas devuelven 400 genérico sin invocar el puerto de consulta; 255 astrales se aceptan; un fallo devuelve 500 genérico, no `[]`, y el test inspecciona el contenido sanitizado del logger.
- `test/instruments/search-instruments.http.test.ts`: app Nest/Express y PostgreSQL real de `db-test`; trim/mayúsculas, búsqueda por nombre, proyección exacta, `[]`, ARS/PESOS, acción sin cotización, MONEDA en ambos lados, nulos, orden/duplicados, escapes, SQL-like, límites 255/256 y astrales, texto numérico y 400 por repetidos/estructurados. Fixtures 1001–1099 eliminados al finalizar. 31 pruebas HTTP entre ambos archivos.
- Sanitización: filtro y pool tienen pruebas del contenido real del logger; la instancia HTTP real registró `operation=instrument-search; SearchInstrumentsError: error message redacted <- Error [ECONNREFUSED]: connection refused`, sin URL, credenciales, valores de solicitud, controles ni saltos de línea. Los códigos desconocidos o mal formados se omiten.
- Seed verificado después de la suite: 66 instrumentos, 11 órdenes, 126 cotizaciones y 0 filas con id mayor o igual a 1000. `database.sql` no se modificó.
- Comandos: `npm run test:unit` sin base activa; `npm run test:integration` y `npm run test:http` con `db-test`; `npm test` para la suite completa; `npm run typecheck`, `npm run build` y `npm run test:typecheck`. También typecheck, build, tipos de pruebas y suite con Node 24.22.1 mediante `npx --yes node@24.22.1 ...`. Resultado: 53 unitarias, 15 de integración, 31 HTTP y 99 totales.
- Evidencia HTTP real con el binario `dist/main.js` y Node 24.22.1 contra `db-test`: `GET /instruments?query=%20pAmP%20` → 200 con PAMP; `holding` → PAMP entre las coincidencias; `ARS` y `PESOS` → 200 `[]`; `PGR` → 200 con la acción sin cotización; inválidas, repetidas y estructuradas → 400 `{"message":"Invalid request."}`; 255 Unicode → 200 y 256 → 400; 255/256 astrales → 200/400. Una segunda instancia con pg inaccesible devolvió 500 `{"message":"Instrument search could not be completed."}` y el log sanitizado indicado arriba.
- `db-test` se levantó con `DOCKER_CONTEXT=colima docker-compose --profile test up -d --wait db-test`, porque el host no tenía el plugin `docker compose`; el contenedor efímero se retiró después de validar.
- `git diff --check` y la comprobación de archivos nuevos no reportaron espacios. El índice permaneció vacío. No se hizo commit, push, PR ni merge.

### Limitaciones

- Solo se implementó búsqueda. Portfolio, órdenes, cancelación, reservas, idempotencia y migraciones siguen fuera de este bloque.
- No se agregaron índices, extensiones, caché, paginación ni búsqueda difusa; no hay benchmark de latencia.
- La integración PostgreSQL y las pruebas HTTP con base real requieren `db-test` activo; las 53 unitarias y la validación HTTP con repositorio falso no requieren base.
- El diagnóstico privilegia la seguridad sobre el detalle textual: no emite mensajes arbitrarios del driver. Conserva operación, clase permitida, código permitido y descripción estática.
- La evidencia HTTP se ejecutó en el host macOS; Docker se usó para PostgreSQL real, no para ejecutar la suite dentro de un contenedor Node.

## Implementación y validación B02

Implementación autorizada por el usuario el 2026-10-27, limitada a la base interna de recursos de una cuenta. No se expusieron endpoints, no se modificaron órdenes ni el seed y no se hizo commit, push, PR ni merge. Código, identificadores y pruebas en inglés; documentación en español.

### Alcance y contratos internos

- `AccountMovement` es el modelo propio de una fila relevante de `orders`: `id`, `instrumentId`, `side`, `status`, `size` y `price`. El precio se conserva como texto decimal, tal como lo entrega PostgreSQL para `NUMERIC`, sin pasar por coma flotante binaria.
- `calculateAccountResources(movements)` es una función pura de dominio, independiente de NestJS, HTTP y SQL. Procesa todos los movimientos de una cuenta y devuelve `AccountResources`: `accountingCash`, `reservedBuyCash`, `availableCash` e `instruments`, con cantidad ejecutada, cantidad reservada por ventas y cantidad disponible por instrumento.
- `AccountMovementRepository.findByUserId(userId)` es el puerto de salida. `PostgresAccountMovementRepository` consulta `orders` con `userid = $1`, alias explícitos para `instrument_id` y `price::text`, y mapea cada fila al modelo propio. Rechaza `side`, `status` o `size` almacenados no admitidos en lugar de convertirlos en cero.
- El adapter depende de `PostgresQueryable`, satisfecho tanto por `Pool` como por `PoolClient`. Esto deja preparada la reutilización de un mismo cliente en una transacción futura, sin abrir transacciones, bloquear filas, aplicar aislamiento, reintentar ni prometer atomicidad en este bloque.
- `GetAccountResourcesService` implementa el puerto de entrada interno `GetAccountResourcesUseCase`, lee la cuenta y aplica el cálculo. Envuelve cualquier fallo de lectura o de datos en `AccountResourcesError` con su causa. Una lista vacía del repositorio significa cuenta sin movimientos; un fallo no se transforma en recursos cero.
- `ResourcesModule` compone el repositorio y el servicio mediante los tokens `ACCOUNT_MOVEMENT_REPOSITORY` y `GET_ACCOUNT_RESOURCES_USE_CASE`, reutiliza `PG_POOL` y queda importado por `AppModule`. No registra controllers ni rutas; el puerto de entrada queda disponible para futuros CDU.

### Reglas aplicadas

- `BUY FILLED` suma `size` a la tenencia del instrumento y resta `size × price` al efectivo contable. `SELL FILLED` resta `size` y suma `size × price`. La regla depende de `status` y `side`, por lo que incluye ejecuciones `MARKET` y `LIMIT` sin leer el tipo de orden.
- `CASH_IN FILLED` suma `size` al efectivo y `CASH_OUT FILLED` lo resta. Se reconocen por `side` y no generan posición accionaria; en el seed están asociados a ARS/MONEDA.
- `BUY NEW` reserva `size × price`; `SELL NEW` reserva `size` acciones del instrumento. Las reservas no alteran efectivo contable ni tenencia ejecutada. Un `BUY NEW` no crea una entrada de instrumento y un `SELL NEW` sí puede crear una con ejecución cero.
- `REJECTED` y `CANCELLED` no aportan ejecución ni reserva. Cambiar una orden de `NEW` a `CANCELLED` elimina su reserva sin revertir ejecuciones.
- Efectivo disponible = efectivo contable − reservas de compras `NEW`; cantidad disponible = tenencia ejecutada − reservas de ventas `NEW` del mismo instrumento. No se limitan a cero.
- Los importes se calculan con `decimal.js`, sin redondeos intermedios, divisiones ni reglas de presentación. Un precio ausente, no numérico, no finito o no positivo para un movimiento que lo requiere produce error. `NEW` con `CASH_IN`/`CASH_OUT` también se rechaza por no tener una reserva aprobada.
- La tenencia negativa del seed se conserva aritméticamente. No se suma `NEW`, no se corrige el origen y no se infiere soporte de ventas en corto.

Los nombres de clases, tokens y función son decisiones técnicas de esta implementación, no acuerdos funcionales previos. No se agregaron índices, migraciones, tablas, caché, colas ni dependencia de marketdata.

### Corrección B02-R1 — precisión de acumulados

La revisión independiente reprodujo el defecto con cinco movimientos `BUY NEW` de `size = 2147483647` y `price = "99999999.99"`: la reserva exacta es `1073741823392625817.65`, pero la precisión global predeterminada de 20 dígitos significativos devolvía `1073741823392625817.70`. También se observó dependencia del orden al mezclar compras y ventas.

La corrección mantiene `decimal.js` y crea una instancia local con `Decimal.clone` por cálculo. Su precisión se deriva de los datos y de la operación:

- Para cada movimiento monetario se obtienen los dígitos enteros del `size` (INT) y los del precio, y los decimales escritos del precio. Un producto necesita como máximo la suma de los dígitos enteros y conserva los decimales del precio.
- Sumar como máximo `n` movimientos puede agregar `digits(n)` dígitos enteros. Cada movimiento contribuye a un solo acumulador —ejecutado o reservado— y la diferencia disponible está acotada por esa misma suma de `n` términos.
- La precisión local es `dígitos enteros máximos + decimales máximos + digits(n)`, con `n` igual a la cantidad de movimientos. No se usa una constante de precisión arbitraria, no se recortan agregados al rango de una columna y no se modifica la configuración global.
- Los acumuladores, precios y productos usan esa instancia local. Los resultados que caben en la precisión global se devuelven con el constructor global; los que la exceden usan un constructor local estable por cantidad de dígitos significativos, de modo que valores iguales sean estructuralmente comparables. No se impone `ORDER BY`; el resultado exacto es invariante ante permutaciones.

Esta corrección no define Q03: no introduce divisiones, redondeos de presentación, costo promedio, rendimientos ni cotizaciones.

Revisión independiente finalizada el 2026-10-28: no se detectaron pendientes bloqueantes para el alcance B02/B02-R1 con los movimientos leídos del esquema actual. Se contrastó el build con un oráculo de centavos enteros independiente en siete tamaños de historia (1, 5, 9, 10, 99, 100 y 1000 movimientos), cada uno en orden directo e inverso, y la regresión original de cinco reservas máximas. Todos coincidieron exactamente y la configuración global se conservó. Tipos, build y las 75 pruebas unitarias sin base ya habían pasado sobre los mismos archivos, cuya identidad se comprobó por hash; se completó ahora la suite PostgreSQL/HTTP: 15 archivos y 126 pruebas aprobadas con Node 24.22.1. Después se verificó seed intacto y ausencia de fixtures; se retiró el contenedor de pruebas usado en esta revisión. No se modificaron implementación ni pruebas.

### Pruebas y evidencia

| Garantía | Tipo de prueba | Resultado |
| --- | --- | --- |
| Efectivo, tenencia, reservas y disponibles; `NEW`/`REJECTED`/`CANCELLED`; aislamiento por instrumento; decimales exactos; tenencia negativa; precio inválido; acumulados grandes y permutaciones | Unitarias de dominio con datos en memoria | 11 pruebas aprobadas |
| Lectura por cuenta a través del puerto; cuenta sin movimientos; fallo de lectura e inválidos envueltos con causa | Unitarias de servicio con doble tipado | 4 pruebas aprobadas |
| Parametrización por cuenta, mapeo, texto decimal y nulos, valores almacenados inválidos y propagación de errores | Unitarias del adapter con cliente falso | 7 pruebas aprobadas |
| Adapter y composición reales; tres cuentas fixture; aislamiento por cuenta e instrumento; decimal `0.30`; caso límite INT/NUMERIC(10,2); lectura del seed y conservación de la negativa | Integración con PostgreSQL aislado | 5 pruebas aprobadas |
| Regresión del contrato y comportamiento de búsqueda B01 | HTTP con Nest/Express y PostgreSQL aislado | 31 pruebas aprobadas |

La fixture principal reproduce el criterio aprobado: `CASH_IN` de 1.000, `BUY FILLED` de 3 a 100 y `SELL FILLED` de 1 a 120 dejan efectivo contable 820 y tenencia 2. Una `BUY NEW` de 2 a 50 deja reserva 100 y disponible 720; una `SELL NEW` de 1 deja una acción disponible sin cambiar efectivo contable ni tenencia ejecutada. `REJECTED` y `CANCELLED` no modifican esos valores.

La regresión B02-R1 confirma que cinco reservas `BUY NEW` con `size = 2147483647` y `price = "99999999.99"` producen exactamente `1073741823392625817.65`; el efectivo contable queda en `0.00` y el disponible en `-1073741823392625817.65`. Un conjunto mixto de cinco compras, una venta, una entrada y una salida de efectivo más reservas produjo `-858993457948668544.12` de efectivo contable, `214748364678525163.53` de reserva y `-1073741822627193707.65` de disponible, con el mismo resultado en todas las permutaciones probadas. El caso combinado de importes grandes y centavos conserva reservas como `214748364678525163.83` y el caso 3 × 0.10 sigue en `0.30`. La configuración global de `Decimal` no cambió. Los valores se contrastaron con un oráculo de centavos enteros independiente de `decimal.js`.

La lectura del seed sin cambios produjo efectivo contable `753000`, reservas de compras `125500`, disponible `627500` y tenencias `31 = -10`, `47 = 40`, `54 = 500`. No se listó ARS/MONEDA como posición y el `BUY NEW` del instrumento 31 no corrigió la cantidad negativa.

Comandos ejecutados con Node 24.22.1, sin cambios de versiones:

- `npx --yes node@24.22.1 node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`: correcto.
- `npx --yes node@24.22.1 node_modules/typescript/bin/tsc --noEmit -p tsconfig.test.json`: correcto.
- `npx --yes node@24.22.1 node_modules/typescript/bin/tsc -p tsconfig.json`: build correcto.
- `npx --yes node@24.22.1 node_modules/vitest/vitest.mjs run --config vitest.unit.config.ts`: 11 archivos y 75 pruebas, con `db-test` todavía apagado.
- `npx --yes node@24.22.1 node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts`: 2 archivos y 20 pruebas con `db-test`.
- `npx --yes node@24.22.1 node_modules/vitest/vitest.mjs run`: 15 archivos y 126 pruebas (75 unitarias, 20 de integración y 31 HTTP).
- `DOCKER_CONTEXT=colima docker-compose --profile test up -d --wait db-test`: PostgreSQL de pruebas saludable; el contenedor se retiró al finalizar.

Después de la suite se verificaron 4 usuarios, 66 instrumentos, 11 órdenes, 126 cotizaciones, cero fixtures B02 y cero instrumentos con id mayor o igual a 1000. Las fixtures propias se eliminaron; `database.sql` permanece intacto.

### Decisiones pendientes y limitaciones

- B02 y B02-R1 están aceptados tras revisión independiente y el usuario autorizó su único commit local. Esa autorización no se extiende a otros bloques ni a publicación; la revisión no cierra sus decisiones funcionales pendientes.
- No hay endpoint de portfolio, envío, cancelación ni transferencias. El resultado interno con `Decimal` no fija su serialización HTTP.
- D03 sigue abierto: la cantidad negativa se conserva, pero no se decide su representación pública, valoración, costo o rendimiento.
- No se implementaron costo promedio móvil, valoración, retorno, precios, conversión por monto, idempotencia, migraciones ni bloqueos. Q01–Q04/Q06/Q07 continúan abiertas en sus comportamientos afectados. Q03 no queda resuelta por la precisión interna de suma y producto.
- Esta lectura no ofrece garantías de concurrencia para enviar órdenes y no debe presentarse como protocolo transaccional completo.

## Implementación y validación B03

Implementación autorizada por el prompt B03 el 2026-10-28, limitada al puerto de lectura, modelo propio y adapter pg de la última cotización por instrumento. No se expusieron endpoints, no se agregaron consumidores ni cálculos y no se hizo commit, push, PR o merge. Código, identificadores y pruebas en inglés; documentación en español.

### Alcance y contratos internos

- `LatestQuote` es el modelo propio de la fila seleccionada: `id`, `instrumentId`, `date`, `close` y `previousClose`. `date` es un texto de calendario `YYYY-MM-DD`, sin hora ni zona horaria; `close` y `previousClose` son texto decimal o `null`, sin conversión a coma flotante.
- `LatestQuoteRepository.findLatestByInstrumentId(instrumentId)` es el puerto de salida. Devuelve `Promise<LatestQuote | null>`; `null` representa ausencia de fila con fecha utilizable y un rechazo representa un fallo de lectura.
- `PostgresLatestQuoteRepository` consulta `marketdata` con `instrumentid = $1`, exige `date IS NOT NULL`, ordena por `marketdata.date DESC, marketdata.id DESC` y limita a una fila. La referencia calificada fuerza la columna `DATE` nativa y evita que el alias textual de la proyección participe en el orden. No filtra `close`, `previousClose` ni valores positivos, y no busca una fila anterior.
- `to_char(date, 'YYYY-MM-DD')` conserva el día de calendario sin construir una hora intradiaria ni depender de la zona horaria del proceso. `close::text` y `previousclose::text` conservan la representación `NUMERIC` que entrega PostgreSQL, incluidos sus nulos.
- El adapter depende de la interfaz estructural local `PostgresQueryable`, satisfecha por `Pool` y por `PoolClient`. Queda preparado para recibir un cliente transaccional futuro, pero no abre transacciones, no bloquea filas y no reintenta.
- `QuotesModule` registra `LATEST_QUOTE_REPOSITORY` mediante `useFactory` con `PG_POOL` y exporta el token; `AppModule` lo importa. No crea un pool nuevo, controller, ruta, servicio de aplicación ni CDU REST.
- Los nombres `LatestQuote`, `LatestQuoteRepository`, `PostgresLatestQuoteRepository`, `LATEST_QUOTE_REPOSITORY` y `QuotesModule` son decisiones técnicas de esta implementación, no acuerdos funcionales previos.

### Reglas aplicadas

- Para el instrumento solicitado se consideran solo filas con `date` no nula. Gana la mayor fecha y, ante empate, el mayor `id`; la selección ocurre antes de evaluar cualquier precio.
- Una fila seleccionada con `close` nulo, cero o negativo se conserva tal como está; no se reemplaza por una fila anterior ni por otro dato. `previousClose` nulo tampoco se sustituye por `close`.
- No se introducen umbrales de antigüedad, validaciones de precio, retornos, ceros por defecto ni reglas para MARKET o portfolio.
- Sin filas, o con todas las fechas nulas, el puerto devuelve `null`. Un error de PostgreSQL se propaga sin convertirse en ausencia.
- La lectura no modifica `orders`, `users`, `instruments` ni `marketdata`, y no consulta los CDU de recursos, portfolio, órdenes o búsqueda.

### Pruebas y evidencia

| Garantía | Tipo de prueba | Resultado |
| --- | --- | --- |
| Parametrización por instrumento, selección de fecha/id en SQL, mapeo, fecha de calendario, nulos, ausencia y propagación del fallo | Unitarias del adapter con cliente falso | 5 pruebas aprobadas |
| Composición con `AppModule` y `PG_POOL`; fecha nativa frente al texto formateado; mayor fecha sobre menor id/precio; empate por mayor id; fecha nula excluida; ausencia total; `close` nulo/cero/negativo sin fallback; `previousClose` nulo; decimales exactos; aislamiento; seed conservado | Integración con PostgreSQL aislado | 11 pruebas aprobadas |
| Regresión de búsqueda, recursos y HTTP existente | Suite completa | 31 pruebas HTTP sin cambios |

La integración usó instrumentos y cotizaciones fixture con identificadores 3101–3199, eliminados al finalizar. Comprobó además la fila del seed del instrumento 12 (`2023-07-14`, `close = 20.50`, `previousClose = 20.50`) sin modificarla.

Comandos ejecutados con Node 24.22.1, sin cambios de versiones:

- `npx --yes node@24.22.1 node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`: correcto.
- `npx --yes node@24.22.1 node_modules/typescript/bin/tsc --noEmit -p tsconfig.test.json`: correcto.
- `npx --yes node@24.22.1 node_modules/typescript/bin/tsc -p tsconfig.json`: build correcto.
- `npx --yes node@24.22.1 node_modules/vitest/vitest.mjs run --config vitest.unit.config.ts`: 12 archivos y 80 pruebas.
- `npx --yes node@24.22.1 node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts`: 3 archivos y 31 pruebas con `db-test`.
- `npx --yes node@24.22.1 node_modules/vitest/vitest.mjs run`: 17 archivos y 142 pruebas (80 unitarias, 31 de integración y 31 HTTP).
- `DOCKER_CONTEXT=colima docker-compose --profile test up -d --wait db-test`: PostgreSQL de pruebas saludable; el contenedor se retiró al finalizar.

Después de la suite se verificaron 4 usuarios, 66 instrumentos, 11 órdenes, 126 cotizaciones y cero fixtures de instrumentos o cotizaciones con id 3101–3199. `database.sql` permanece intacto.

### Corrección B03-R1 — fecha nativa

- **Defecto reproducido:** `to_char(date, 'YYYY-MM-DD') AS date` y `ORDER BY date DESC` hacían que PostgreSQL resolviera el alias textual. Con las fechas `9999-12-31` y `10000-01-01`, el orden textual devolvía la primera aunque la columna `DATE` original indicara la segunda.
- **Corrección:** la proyección de calendario se conserva, pero el orden usa `marketdata.date DESC, marketdata.id DESC`. No se añadieron límites de fecha, validaciones de precios ni cambios de contrato.
- **Regresión:** se agregaron al fixture propio el instrumento 3112 y las cotizaciones con ids 3194 (`9999-12-31`) y 3112 (`10000-01-01`); la integración exige la segunda. La unitaria comprueba que el SQL referencia `marketdata.date` y no contiene `ORDER BY date DESC`.
- Se conservaron las regresiones de empate por id, fecha nula, ausencia, `close` nulo/cero/negativo, `previousClose` nulo, decimales exactos, aislamiento y seed.
- Validación B03-R1: tipos de aplicación y pruebas, build, 80 unitarias sin base, 31 de integración y 142 totales con Node 24.22.1. Después se verificaron 4 usuarios, 66 instrumentos, 11 órdenes, 126 cotizaciones y cero fixtures.

Revisión independiente finalizada el 2026-10-28: se inspeccionó la corrección de SQL y sus pruebas sin detectar pendientes bloqueantes para el alcance B03/B03-R1. Se ejecutaron tipos de aplicación y pruebas y build con Node 24.22.1, 80 pruebas del grupo unitario con base apagada y configuración deliberadamente incompatible con integración, y la suite completa con PostgreSQL aislado: 17 archivos y 142 pruebas aprobadas. La regresión nativa devuelve `10000-01-01` y las comprobaciones de empate, nulos, aislamiento, ausencia y fallo se conservan. Se verificó seed intacto y ausencia de fixtures; se retiró únicamente el contenedor de pruebas propio. No se modificaron código ni pruebas, y el índice quedó vacío. No se hizo commit ni publicación.

### Limitaciones y decisiones abiertas

- B03/B03-R1 aceptados tras revisión independiente; el usuario autorizó su único commit local. No hay autorización de publicación ni de commits de otros bloques.
- La revisión independiente previa detectó el defecto de ordenación; B03-R1 modificó la implementación y las pruebas y aportó la nueva evidencia de validación. La corrección no cambia el criterio funcional ni resuelve las ambigüedades de F07/Q06.
- La cobertura de selección de AC25 incluye el caso nativo y está aceptada dentro de B03. La fila leída no se declara válida para operar. No se implementa la fórmula de retorno diario, las validaciones concretas de precios, la persistencia de MARKET no procesable ni los contratos públicos de F07/Q06; AC26–AC28 no se ejecutaron.
- No hay endpoint, controller, CDU de aplicación ni consumidor de portfolio u órdenes. La ausencia interna `null` todavía no tiene traducción HTTP.
- No se agregaron índices, migraciones, caché, umbrales de antigüedad, transacciones, bloqueos ni reintentos. La interfaz `PostgresQueryable` solo deja preparada la reutilización futura de un cliente transaccional.
- La lectura conserva los valores almacenados, sujetos a la precisión aceptada de `NUMERIC(10,2)`. No se corrigió ni depuró el seed.
- La validación se ejecutó en el host macOS con PostgreSQL 18.6 en `db-test`; no se ejecutó la suite dentro de un contenedor Node ni se realizó un benchmark.

## Implementación y validación B04-A

Implementación autorizada por el prompt B04-A el 2026-10-28, limitada al puerto transaccional por cuenta y su adapter pg. No se implementaron endpoints, envío/cancelación, idempotencia, migraciones, reintentos automáticos ni nuevas esperas. No se hizo commit, push, PR ni merge. Código, identificadores y pruebas en inglés; documentación en español.

### Alcance y contratos internos

- `AccountTransactionRunner.run(userId, work)` es el puerto de salida independiente de pg, SQL, Nest y HTTP. Devuelve `Promise<AccountTransactionResult<T>>`, donde el resultado es `{ status: 'committed', value }` o `{ status: 'account-not-found' }`. La cuenta inexistente queda representada internamente; este bloque no decide su traducción HTTP.
- `AccountTransactionContext` expone `userId`, `accountMovements` y `latestQuotes`, ligados al cliente de esa ejecución. Las capacidades reutilizan los puertos `AccountMovementRepository` y `LatestQuoteRepository`; no se exponen `PoolClient`, SQL libre ni entidades de persistencia a la aplicación. El contexto solo es válido mientras corre `work`.
- `PostgresAccountTransactionRunner` depende de `PostgresConnectionPool`/`PostgresTransactionClient`, interfaces estructurales de infraestructura. Construye un `PostgresAccountMovementRepository` y un `PostgresLatestQuoteRepository` nuevos por ejecución sobre el mismo cliente; no reemplaza ni redirige los providers singleton basados en el pool.
- `AccountTransactionError` conserva `stage` (`connection`, `begin`, `lock`, `work`, `commit`, `rollback`, `release`), `commitOutcome` (`not-attempted`, `confirmed`, `rolled-back`, `uncertain`), `commitCommand` cuando PostgreSQL devolvió una respuesta para COMMIT, `clientDisposition`, la causa original, `rollbackError` y `releaseError` cuando existen. Sus mensajes son estáticos y no incluyen SQL, parámetros ni datos personales.
- `TransactionsModule` registra `ACCOUNT_TRANSACTION_RUNNER` con `useFactory` sobre `PG_POOL` y lo exporta; `AppModule` lo importa. No crea un pool nuevo, controller, ruta, CDU REST ni consultas de cotización obligatorias.
- Los nombres `AccountTransactionRunner`, `AccountTransactionContext`, `PostgresAccountTransactionRunner`, `ACCOUNT_TRANSACTION_RUNNER` y `TransactionsModule` son decisiones técnicas de esta implementación, no acuerdos funcionales previos.

### Ciclo de vida aplicado

- Por invocación se adquiere un cliente del pool existente y se ejecuta `BEGIN TRANSACTION ISOLATION LEVEL READ COMMITTED`, de forma explícita.
- Inmediatamente después, en un statement separado, se ejecuta `SELECT id FROM users WHERE id = $1 FOR UPDATE`. El trabajo se invoca solo después de que ese bloqueo se adquiere y se mantiene hasta `COMMIT` o `ROLLBACK`.
- Si la fila del usuario no existe, se revierte la transacción, se devuelve `account-not-found` y no se ejecuta `work`.
- Si `work` falla, se intenta `ROLLBACK` una vez y se conserva la causa original. Un fallo de rollback se expone en `rollbackError` y la conexión se descarta. No se repite el trabajo.
- Si `work` resuelve, no se inspeccionan estados de órdenes ni se decide un rollback por el resultado. Se ejecuta `COMMIT`; solo se devuelve el valor si `QueryResult.command` es `COMMIT`.
- Si PostgreSQL responde `command: 'ROLLBACK'` al COMMIT, la transacción quedó revertida de forma conocida. Se rechaza con `commitOutcome: 'rolled-back'` y `commitCommand: 'ROLLBACK'`, sin devolver el valor del trabajo; la conexión se libera.
- Si `COMMIT` falla o devuelve un comando inesperado, el error se marca con `commitOutcome: 'uncertain'`; no se devuelve el valor ni se afirma que hubo rollback seguro. Se intenta una limpieza de mejor esfuerzo y la conexión se descarta. La recuperación idempotente queda pendiente de sus subbloques.
- Un fallo al liberar el cliente no reemplaza un error original: se adjunta como `releaseError`. Si el `COMMIT` ya estaba confirmado, el error de liberación conserva `commitOutcome: 'confirmed'` para que el flujo futuro no lo trate como fallo de negocio.
- No hay reintentos, backoff, FIFO estricto ni timeouts nuevos. Distintas cuentas no comparten el bloqueo; la serialización es por fila de usuario.

### Pruebas y evidencia

| Garantía | Tipo de prueba | Resultado |
| --- | --- | --- |
| Orden BEGIN READ COMMITTED → bloqueo separado → trabajo → COMMIT; un solo cliente; trabajo posterior al bloqueo; resultado solo con `command: 'COMMIT'`; sin trabajo duplicado | Unitarias del adapter con pool/cliente falsos tipados | 17 pruebas aprobadas |
| Fallos de conexión, inicio, bloqueo, trabajo, COMMIT, rollback y liberación; cuenta inexistente; causas conservadas; COMMIT incierto; rollback conocido; descarte y liberación; contextos independientes | Unitarias del adapter con dobles tipados | Incluidas en las 17 anteriores |
| Aislamiento efectivo `read committed`; lecturas del contexto con el cliente transaccional, incluida una fila no confirmada y una cotización; composición desde `AppModule` y pool compartido | Integración con PostgreSQL aislado | 9 pruebas aprobadas |
| Serialización de una cuenta, progreso de otra, espera evidenciada por bloqueo, lectura posterior de cambios confirmados y limpieza ante falla controlada | Integración con PostgreSQL aislado, señales y metadatos de bloqueo | Incluidas en las 9 anteriores |
| Rollback de escrituras fixture, liberación del bloqueo y operación posterior; COMMIT real con `command: 'ROLLBACK'` y escritura revertida; cuenta inexistente; seed conservado | Integración con PostgreSQL aislado | Incluidas en las 9 anteriores |

La prueba de aislamiento consulta `SHOW transaction_isolation` con el mismo cliente de la transacción y obtiene `read committed`; la unitaria verifica el statement `BEGIN TRANSACTION ISOLATION LEVEL READ COMMITTED`. La prueba de contexto inserta una fila no confirmada con el cliente real de la transacción y comprueba que `accountMovements` la ve; una lectura desde otro cliente no podría verla. También lee `latestQuotes` con el mismo cliente y comprueba la fila fixture.

La regresión de confirmación efectiva inserta una orden fixture, captura dentro del trabajo un error PostgreSQL `22012` y resuelve. PostgreSQL responde `command: 'ROLLBACK'` al COMMIT; el runner rechaza con `commitOutcome: 'rolled-back'` y `commitCommand: 'ROLLBACK'`, no devuelve el valor y la fila no persiste. Una operación posterior sobre la misma cuenta confirma que el cliente y el bloqueo quedaron utilizables.

Evidencia de concurrencia: la operación A adquiere el bloqueo de la cuenta 4102 y actualiza su email; un monitor externo con `FOR UPDATE NOWAIT` recibe `55P03`, lo que demuestra que la fila está bloqueada. La operación B, iniciada antes del `COMMIT` de A, aparece en `pg_stat_activity` con `wait_event_type = 'Lock'` y el pid de A en `pg_blocking_pids`; su `work` no se ejecuta. La operación C sobre la cuenta 4103 completa mientras A sigue bloqueada. Tras liberar A, B adquiere el bloqueo, lee el email confirmado por A y completa. La espera se coordina con señales y se acota con un sondeo de metadatos, no con un sleep fijo.

El escenario concurrente usa un helper con `try/finally`: ante cualquier fallo de aserción, sondeo o timeout, libera A, espera ambas operaciones y conserva el error original. Una prueba controlada lanza un error dentro de la espera, comprueba que se propaga sin sustituirse y que una operación posterior obtiene el bloqueo, sin promesas ni bloqueos pendientes.

La prueba de rollback inserta una orden fixture, falla en `work` y comprueba que la fila no quedó persistida. Después ejecuta otra operación sobre la misma cuenta con límite de tiempo y comprueba que puede escribir, lo que evidencia la liberación del bloqueo. Los fixtures usan identificadores 4101–4199 y se eliminaron al finalizar; se verificaron 4 usuarios, 66 instrumentos, 11 órdenes y 126 cotizaciones del seed, sin filas fixture restantes.

Comandos ejecutados con Node 24.22.1, sin cambios de versiones:

- `npx --yes node@24.22.1 node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`: correcto.
- `npx --yes node@24.22.1 node_modules/typescript/bin/tsc --noEmit -p tsconfig.test.json`: correcto.
- `npx --yes node@24.22.1 node_modules/typescript/bin/tsc -p tsconfig.json`: build correcto.
- `npx --yes node@24.22.1 node_modules/vitest/vitest.mjs run --config vitest.unit.config.ts`: 13 archivos y 98 pruebas con `db-test` apagado.
- `npx --yes node@24.22.1 node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts`: 4 archivos y 40 pruebas con `db-test`.
- `npx --yes node@24.22.1 node_modules/vitest/vitest.mjs run --config vitest.http.config.ts`: 2 archivos y 31 pruebas.
- `npx --yes node@24.22.1 node_modules/vitest/vitest.mjs run`: 19 archivos y 169 pruebas (98 unitarias, 40 de integración y 31 HTTP).
- `DOCKER_CONTEXT=colima docker-compose --profile test up -d --wait db-test`: PostgreSQL de pruebas saludable; el contenedor se retiró al finalizar.

La validación de B04-A-R1 detuvo y retiró únicamente el contenedor `db-test` y la red del proyecto; no ejecutó `docker-compose down` sobre el proyecto completo. El volumen `cocos-backend_postgres-data` se conservó. No se alteró `database.sql` ni el seed.

### Limitaciones y decisiones abiertas

- B04-A-R1 está implementado y validado localmente. B04-A/B04-A-R1 aceptados tras revisión independiente; el usuario autorizó su único commit local, sin publicación.
- Solo se implementó un intento transaccional. No hay reintentos automáticos, backoff, presupuestos de espera, timeouts nuevos ni recuperación idempotente.
- No hay migración, columnas de idempotencia, endpoints, envío/cancelación ni escrituras de órdenes de producción. El adapter no interpreta estados de órdenes.
- Un COMMIT incierto se simuló con dobles y con la evidencia de error del adapter; no se probó recuperación idempotente porque no pertenece a este bloque.
- El contexto ofrece lectura de recursos y cotizaciones, pero no ejecuta cotizaciones por sí mismo; la política de lectura consistente de portfolio no se decide aquí.
- La suite se ejecutó en el host macOS con PostgreSQL 18.6 en `db-test`; no se ejecutó dentro de un contenedor Node ni se realizó un benchmark.

### Revisión independiente B04-A — correcciones requeridas

Revisión del 2026-10-28: se inspeccionaron puerto, contexto, error interno, adapter, módulo, composición, dobles, pruebas unitarias e integración, diagnósticos y documentación. Se verificaron READ COMMITTED explícito, bloqueo inicial en statement separado, mismo cliente y adapters por ejecución sin redirigir providers compartidos. En esa primera revisión no se aceptó B04-A por los siguientes problemas, corregidos después en B04-A-R1:

- **P1 — Confirmación falsa:** el adapter ignora `QueryResult.command` al ejecutar COMMIT y marca cualquier promesa resuelta como confirmación. Reproducción independiente en PostgreSQL: una transacción sobre un usuario fixture realiza una escritura, captura dentro del trabajo un error SQL `22012` y resuelve. PostgreSQL devuelve `command: 'ROLLBACK'` al COMMIT, la escritura no queda persistida, pero el runner devuelve `{ status: 'committed', value: 'work-resolved' }`. Debe comprobarse la confirmación efectiva y representar el rollback conocido sin confundirlo con un COMMIT incierto. Los dobles actuales devuelven `SELECT` para todos los statements, por lo que tampoco detectan esta garantía.
- **P2 — Limpieza incompleta de la prueba concurrente:** la señal que libera la operación A solo se resuelve en el camino exitoso. Un fallo de aserción, sondeo o timeout previo deja A esperando y puede mantener B y el teardown bloqueados. Es una conclusión de inspección del flujo; no se inyectó ese fallo en la suite. Se requiere liberación y espera de las operaciones iniciadas también por el camino de error, sin ocultar el fallo original.

Validación independiente realmente ejecutada con Node 24.22.1: tipos de aplicación y pruebas, build, 95 unitarias con la base inactiva y una configuración incompatible con integración, y suite completa con PostgreSQL 18.6 aislado: 164 pruebas aprobadas (95 unitarias, 38 integración y 31 HTTP). Esos resultados no cubren el fallo P1, demostrado por una reproducción adicional ejecutada contra el build actual, sin modificar código o pruebas del proyecto. En el momento de esa revisión no existía una prueba de regresión persistida para él; B04-A-R1 la añadió después, como se documenta abajo.

Se comprobó ausencia de cambios en consigna, SQL, dependencias y Compose. Tras la suite y la reproducción adicional, la base conservó 4 usuarios, 66 instrumentos, 11 órdenes y 126 cotizaciones, sin fixtures de pruebas; esto comprueba cantidades y limpieza, no una comparación exhaustiva de cada valor del seed. Se retiró únicamente el contenedor `db-test` creado para esta revisión. No se modificaron implementación ni pruebas, no se hizo commit ni publicación y el índice se conserva vacío.

### Corrección B04-A-R1 — confirmación efectiva y limpieza

Implementación de B04-A-R1 el 2026-10-28, limitada a los dos problemas de la revisión. No se añadieron endpoints, migraciones, idempotencia, reintentos, backoff, timeouts de producción ni cambios de esquema o dependencias.

- **P1 corregido:** el runner examina `QueryResult.command` después de COMMIT. Solo devuelve `{ status: 'committed', value }` cuando el comando es `COMMIT`. Si PostgreSQL responde `ROLLBACK`, rechaza con `stage: 'commit'`, `commitOutcome: 'rolled-back'` y `commitCommand: 'ROLLBACK'`; no devuelve el valor del trabajo. Un comando inesperado o un rechazo de COMMIT conserva `commitOutcome: 'uncertain'` y el tratamiento conservador de limpieza/descarte. El error conserva causa, `rollbackError` y `releaseError` cuando existan.
- **P2 corregido:** el escenario concurrente se extrajo a un helper con `try/finally`. La señal de A se libera siempre; A y B se esperan con un límite del harness; un fallo primario se conserva y se relanza después de la limpieza. Se añadió una prueba con falla controlada que comprueba la propagación del error original y que una operación posterior obtiene el bloqueo.
- **Dobles:** modelan `BEGIN`, `SELECT`, `COMMIT` y `ROLLBACK` con sus `command` reales. Las pruebas unitarias cubren COMMIT confirmado, COMMIT con respuesta `ROLLBACK`, comando inesperado, COMMIT rechazado y fallos de liberación.
- **Regresión PostgreSQL real:** una escritura fixture seguida de un error `22012` capturado dentro del trabajo produce `command: 'ROLLBACK'` al COMMIT. El runner rechaza con `rolled-back`, la fila no persiste y una operación posterior confirma que el bloqueo y el cliente quedaron utilizables.
- **Resultados:** tipos de aplicación y pruebas, build, 98 unitarias con `db-test` apagado, 40 de integración PostgreSQL y 169 totales (31 HTTP), con Node 24.22.1. Seed final: 4 usuarios, 66 instrumentos, 11 órdenes y 126 cotizaciones; fixtures 4101–4199 eliminados. Se retiraron solo el contenedor `db-test` y la red propios de la validación; no se ejecutó `docker-compose down` sobre el proyecto completo.
- **Estado al entregar la corrección:** B04-A-R1 quedó pendiente de revisión de aceptación; la revisión independiente posterior se registra abajo. No se hizo commit, push, PR, merge ni cambio de rama. La recuperación idempotente y los reintentos siguen fuera de este bloque.

### Aceptación independiente B04-A/B04-A-R1

Revisión finalizada el 2026-10-28 sin nuevos hallazgos dentro del alcance aprobado. Se inspeccionaron código y pruebas por separado. Se verificó que solo `command: 'COMMIT'` permite devolver el resultado, que `ROLLBACK` produce un error de rollback conocido y que un resultado incierto conserva su tratamiento sin repetir el trabajo. Los dobles modelan los comandos reales. La regresión PostgreSQL reproduce el error SQL capturado, comprueba ausencia de la escritura y permite una operación posterior. La prueba de fallo controlado del escenario concurrente conserva el error original y permite obtener después el bloqueo de la cuenta.

Validación ejecutada independientemente con Node 24.22.1: tipos de aplicación y pruebas, build, 98 unitarias con PostgreSQL inactivo y `TEST_PGDATABASE=blocked_for_unit_tests`, y suite completa con PostgreSQL 18.6 en `db-test`: 169 pruebas aprobadas en 19 archivos (98 unitarias, 40 de integración y 31 HTTP). No se repitieron suites de integración/HTTP por separado tras la ejecución completa. La simulación de COMMIT incierto sigue siendo con dobles; no acredita recuperación idempotente.

Consigna, SQL, dependencias y Compose permanecen sin cambios respecto de HEAD. Tras las pruebas se comprobaron 4 usuarios, 66 instrumentos, 11 órdenes y 126 cotizaciones, sin fixtures en los rangos de prueba; la comprobación acredita cantidades y limpieza, no igualdad de todos los valores del seed. Se retiró solo el contenedor `db-test` creado para esta revisión. No se modificaron implementación ni pruebas durante la revisión.

B04-A/B04-A-R1 aceptados como infraestructura de un intento transaccional por cuenta. El usuario autorizó un único commit local de los 15 archivos de transacciones, composición, diagnósticos, pruebas y documentación, con mensaje `feat(transactions): add account-scoped transaction runner`. La autorización quedó limitada a ese commit y se materializó en `e57de25`; no habilita publicación ni commits de B04-B. El trabajo posterior fue B04-B, implementado y validado localmente más abajo.

### Continuidad B04-B — alcance aprobado e implementación

El usuario aprobó el 2026-10-28 UUID y objeto JSONB versionado en `orders`, columnas anulables para conservar filas históricas, presencia conjunta de clave/metadatos, unicidad por usuario/UUID y decimales del JSON como strings. No se inventan UUID históricos ni se añaden tablas. B04-B se limita a la migración aditiva y su validación; no cierra DTOs HTTP, estructura semántica completa, comparación, recuperación ni reintentos. Los escritores futuros deberán exigir identidad en las órdenes nuevas; la nulabilidad no lo impone por sí sola.

B04-B quedó implementado y validado localmente el 2026-10-28. La migración, sus nombres técnicos, comandos, pruebas y limitaciones se detallan en [Implementación y validación B04-B](#implementación-y-validación-b04-b). El usuario autorizó su único commit local, sin publicación; la revisión independiente aceptó B04-B/R1/R2.

## Implementación y validación B04-B

Implementación autorizada por el prompt B04-B el 2026-10-28, limitada a la migración aditiva de identidad en `orders` y su validación. No se implementaron endpoints, escritura de órdenes de producción, normalización/comparación de intenciones, recuperación, reintentos, cambios de reservas o precisión. No se hizo commit, push, PR ni merge. SQL y comentarios en inglés; documentación en español.

### Diseño y decisiones técnicas

- Migración: `db/migrations/20261028-b04b-order-idempotency.sql`. Es aditiva, no modifica columnas originales y conserva `database.sql` intacto.
- Columnas: `idempotency_key UUID NULL` e `idempotency_metadata JSONB NULL`. Las filas históricas quedan con SQL NULL en ambas; no se inventan UUID ni metadatos.
- Contenedor mínimo versionado: objeto JSONB con `version` entero positivo y `parameters` objeto. `parameters` permanece abierto; su estructura semántica completa, comparación y compatibilidad de reenvíos no se cierran aquí. Los decimales dentro de `parameters` se almacenan como strings por convención del futuro escritor.
- Presencia conjunta: `orders_idempotency_pair_check` exige que clave y metadatos estén ambos presentes o ambos ausentes, y que una fila con identidad tenga `userid`.
- Forma del contenedor: `orders_idempotency_metadata_check` exige objeto, `version` numérico entero positivo y `parameters` objeto. Un JSON `null` no se confunde con SQL NULL.
- Unicidad: `orders_user_idempotency_key_unique` sobre `(userid, idempotency_key)`. Los NULL históricos no colisionan; una misma clave puede existir en cuentas diferentes. No se atribuyen a UNIQUE garantías de recuperación, comparación o disponibilidad.
- No se agregan tablas de historial, hashes, caché, TTL ni un framework de migraciones. La migración no se ejecuta durante el arranque.
- Las verificaciones de esquema usan bloques `DO` explícitos y no `IF NOT EXISTS`. Para constraints existentes comparan exactamente la representación canónica de `pg_get_constraintdef`, el tipo, `convalidated`, `conenforced`, `condeferrable`, `condeferred`, `conperiod`, `conislocal`, `coninhcount`, `conparentid` y `connoinherit`; no se eliminan espacios ni se alteran literales. La unicidad exige además `conkey` exacto de `(userid, idempotency_key)`. Las variantes no soportadas se rechazan de forma conservadora.

### Mecanismo de aplicación

- Comando recomendado, con una única transacción y detención ante el primer error:
  ```sh
  docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -1 -f -' \
    < db/migrations/20261028-b04b-order-idempotency.sql
  ```
- Para `db-test`, el mismo comando con `docker compose --profile test exec -T db-test ...`. Si el CLI no tiene el plugin, se usa `docker-compose`. El flag `-1` es obligatorio: agrupa `LOCK TABLE orders IN ACCESS EXCLUSIVE MODE`, verificaciones y DDL en una transacción.
- **Primera ejecución:** agrega columnas y constraints. Las filas históricas conservan todos sus valores y reciben SQL NULL en las columnas nuevas.
- **Segunda ejecución:** verifica tipos, nulabilidad, ausencia de defaults y constraints. Si el esquema coincide, no cambia nada y emite avisos.
- **Esquema previo incompatible:** eleva una excepción con el detalle del desajuste; la transacción revierte sin cambios parciales.
- Después de inicializar desde `database.sql`, la migración se aplica manualmente con el comando anterior. No se aplicó a desarrollo en esta validación.

### Pruebas y evidencia

La migración no agrega lógica de scripts o adapters ejecutables; por eso no se crearon unitarias vacías para SQL. Su comportamiento se valida con PostgreSQL real aislado en `test/database/order-idempotency-migration.integration.test.ts`.

| Garantía | Verificación PostgreSQL | Resultado |
| --- | --- | --- |
| Aplicación sobre el esquema original y conservación de todos los valores de `orders` | Snapshot completo antes/después y comparación de filas | Aprobada |
| Columnas UUID/JSONB anulables, sin defaults, y constraints efectivas | `information_schema`, `pg_constraint`, columnas de la unicidad | Aprobada |
| Contenedor versionado válido y decimales exactos como strings | Inserción y lectura de `parameters.price = "10.10"` y `amount = "100.00"` | Aprobada |
| Objeto incompleto, versión inválida, `parameters` inválido, envoltura escalar/array/null | 11 casos con SQLSTATE `23514` | Aprobadas |
| Clave sin metadatos y metadatos sin clave | SQLSTATE `23514` | Aprobadas |
| SQL NULL histórico frente a JSON `null` | Ambos casos diferenciados | Aprobada |
| UUID inválido y orden con identidad sin cuenta | SQLSTATE `22P02` y `23514` | Aprobadas |
| Duplicado por usuario/UUID sin sobrescritura y misma clave en otra cuenta | SQLSTATE `23505`; fila original intacta; segunda cuenta aceptada | Aprobada |
| Segunda ejecución como no-op verificado | Segunda aplicación sin cambios de columnas/constraints | Aprobada |
| Falsa compatibilidad de firma | `UNIQUE` con `id` extra, `CHECK` con `OR true` en presencia y metadatos, `CHECK` `NOT VALID`, y literales `version`/`parameters` alterados con espacios | Rechazadas |
| Fallo seguro ante columna, constraint, estado incompleto o variante no soportada | Excepción y rollback; esquema original restaurado | Aprobadas |

Evidencia de conservación y limpieza: la prueba de histórico compara todas las columnas originales de `orders`, no solo cantidades. Las fixtures usan usuarios 4201/4202 e instrumento 4201 y se revierten con cada transacción. Después de la suite se comprobaron 4 usuarios, 66 instrumentos, 11 órdenes, 126 cotizaciones y ausencia de las columnas B04-B en `orders`. La aplicación manual con `psql -1` se validó en un `db-test` desechable: primera ejecución agregó el esquema, segunda no cambió nada. No se ejecutó la migración sobre desarrollo. Se retiraron únicamente el contenedor `db-test` y la red creados para la validación; no se ejecutó `docker-compose down` sobre el proyecto completo y el volumen de desarrollo se conservó.

Comandos ejecutados con Node 24.22.1 y PostgreSQL 18.6 en `db-test`:

- `npx --yes node@24.22.1 node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`: correcto.
- `npx --yes node@24.22.1 node_modules/typescript/bin/tsc --noEmit -p tsconfig.test.json`: correcto.
- `npx --yes node@24.22.1 node_modules/typescript/bin/tsc -p tsconfig.json`: build correcto.
- `npx --yes node@24.22.1 node_modules/vitest/vitest.mjs run --config vitest.unit.config.ts`: 13 archivos y 98 pruebas con `db-test` apagado.
- `npx --yes node@24.22.1 node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts`: 5 archivos y 68 pruebas.
- `npx --yes node@24.22.1 node_modules/vitest/vitest.mjs run --config vitest.http.config.ts`: 2 archivos y 31 pruebas.
- `npx --yes node@24.22.1 node_modules/vitest/vitest.mjs run`: 20 archivos y 197 pruebas (98 unitarias, 68 de integración y 31 HTTP).

### Limitaciones y decisiones abiertas

- B04-B/R1/R2 aceptados tras revisión independiente; el usuario autorizó su único commit local, sin publicación.
- La nulabilidad conserva el histórico, pero no obliga a todos los escritores futuros a enviar identidad. El futuro API deberá exigir clave y metadatos.
- UNIQUE no implementa recuperación, comparación de intenciones ni disponibilidad; esas garantías pertenecen a bloques posteriores.
- El objeto `parameters` es abierto: la migración no puede validar que todos los campos decimales de cualquier versión futura sean strings. Esa regla corresponde al escritor/validador futuro.
- La migración no incluye una operación de reversa ni un historial de migraciones; no forma parte de este alcance. No se ejecuta automáticamente al iniciar.
- La aplicación toma `ACCESS EXCLUSIVE` sobre `orders` y puede esperar transacciones abiertas; no se añadieron timeouts de producción. Es una operación manual.
- No se modifican recursos, reservas, estados, cotizaciones, precisión monetaria ni `database.sql`.
- La suite se ejecutó en macOS con PostgreSQL 18.6 en `db-test`; no dentro de un contenedor Node.

### Revisión independiente B04-B — corrección requerida

Revisión del 2026-10-28: migración y pruebas inspeccionadas por separado. La creación inicial incorpora UUID/JSONB anulables, presencia conjunta, contenedor versionado y unicidad. La verificación de un esquema existente no es suficiente: inspecciona tipo de constraint y presencia de palabras con `LIKE`, sin comprobar su definición efectiva.

**P1:** reproducción independiente en PostgreSQL 18.6 aislado: tras aplicar la migración, sustituir la unicidad por `UNIQUE (userid, idempotency_key, id)` conserva las palabras esperadas y la segunda ejecución informa compatibilidad; permite insertar dos filas con el mismo usuario/UUID. Reproducciones adicionales sustituyen cada CHECK por una expresión con las palabras esperadas y `OR true`: la segunda ejecución también las acepta y permite clave sin metadatos o contenedor inválido. Los tres casos se revirtieron. No hay una regresión persistida de estos casos en la suite recibida.

Validación independiente ejecutada con Node 24.22.1: tipos de pruebas y suite completa, 191 pruebas aprobadas en 20 archivos (98 unitarias, 62 integración y 31 HTTP). Estas pruebas no detectan P1. Se comprobó ausencia de cambios en código de aplicación, configuración, dependencias, consigna y SQL original; no se repitieron tipos de aplicación/build sin cambios pertinentes. Se comparó una huella del contenido de todas las filas de las cuatro tablas antes y después de suite/reproducciones, con coincidencia; esta comprobación no incluye secuencias. Estado final: 4 usuarios, 66 instrumentos, 11 órdenes, 126 cotizaciones y ninguna columna nueva de B04-B persistida. Se retiró solo el contenedor `db-test` creado para la revisión.

En aquella revisión B04-B no estaba aceptado. Siguiente acción en esa revisión: un único prompt B04-B-R1 para verificar de forma fiable las constraints existentes y añadir regresiones de falsa compatibilidad. La corrección posterior se documenta a continuación. No se modificaron SQL ni pruebas durante la revisión; solo documentación y registro. Sin commit ni publicación; índice vacío. No se cierran estructura semántica completa, comparación, recuperación, reintentos o contratos HTTP.

### Corrección B04-B-R1 — firma efectiva de constraints

Implementación del 2026-10-28, limitada a la verificación de constraints existentes y sus regresiones. No se modificaron columnas, reglas de negocio, `database.sql`, dependencias ni código de aplicación.

- **Verificación elegida:** comparación conservadora de la firma canónica normalizada de `pg_get_constraintdef` para las tres constraints, más tipo, columnas y propiedades de `pg_constraint`.
- **Presencia y metadatos:** se comprueba `contype = 'c'`, `convalidated`, `conenforced`, `condeferrable`, `condeferred`, `conperiod`, `conislocal`, `coninhcount`, `conparentid`, `connoinherit` y la definición normalizada. Las variantes `OR true`, `NOT VALID` y otras no soportadas se rechazan.
- **Unicidad:** se comprueba `contype = 'u'`, las mismas propiedades, `conkey` exacto de `(userid, idempotency_key)` y la firma `UNIQUE (userid, idempotency_key)`. Una clave con `id` adicional, columnas incluidas o una variante de diferibilidad se rechaza.
- **Sin reparación silenciosa:** ante una diferencia, la migración eleva una excepción y la transacción revierte. No reemplaza ni repara constraints existentes.
- **Regresiones nuevas:** `UNIQUE (userid, idempotency_key, id)`, `CHECK` de presencia con `OR true`, `CHECK` de metadatos con `OR true` y `CHECK` `NOT VALID`. Cada una demuestra que el esquema débil sería aceptado por la verificación anterior, exige el rechazo actual y comprueba que el rollback deja el esquema original.
- **Resultados:** 26 pruebas de migración PostgreSQL, 66 de integración, 31 HTTP y 195 totales en 20 archivos, con Node 24.22.1. Las 98 unitarias y la comprobación de todos los valores históricos se conservan.
- **Limpieza:** seed final de 4 usuarios, 66 instrumentos, 11 órdenes y 126 cotizaciones; fixtures 4201/4202/4201 revertidos; sin columnas B04-B persistidas. Se retiraron únicamente el contenedor `db-test` y la red de la validación; no se ejecutó `docker-compose down` ni la migración sobre desarrollo.
- **Estado al entregar R1:** pendiente de revisión de aceptación; la corrección posterior R2 y su aceptación se registran abajo. No se hizo commit, push, PR, merge ni cambio de rama. La firma se fija a PostgreSQL 18.6 y rechaza variantes no soportadas de forma deliberadamente conservadora. La normalización de espacios de R1 fue reemplazada por comparación exacta en B04-B-R2.

### Revisión independiente B04-B-R1 — corrección B04-B-R2 requerida

La revisión comprobó las regresiones de unicidad con columna extra, ambos CHECK con `OR true` y `NOT VALID`. Esos casos quedan corregidos. Se detectó un problema restante en la comparación de firmas: `regexp_replace(..., '[[:space:]]+', '', 'g')` elimina espacios también dentro de literales SQL, alterando su significado.

**P2:** reproducciones independientes sobre PostgreSQL 18.6: sustituir los literales de clave JSON `version` por `ver sion`, o `parameters` por `para meters`, conserva la firma normalizada. La segunda ejecución acepta la constraint modificada y permite metadatos sin el campo obligatorio original. Ambos casos se revirtieron; no existe todavía una regresión persistida para ellos. Corrección mínima recomendada: comparar la representación canónica sin normalizar el contenido de los literales, manteniendo la estrategia conservadora y las comprobaciones de catálogo.

Validación ejecutada con Node 24.22.1: tipos de pruebas y suite completa, 195 pruebas aprobadas (98 unitarias, 66 integración y 31 HTTP). No detectan este caso adicional. No se repitieron tipos/build de aplicación porque código, configuración y dependencias permanecen sin cambios, al igual que consigna y SQL original. La huella del contenido de todas las filas de las cuatro tablas coincidió antes y después de la suite y reproducciones; no incluye secuencias. Cantidades finales: 4 usuarios, 66 instrumentos, 11 órdenes, 126 cotizaciones y ninguna columna B04-B persistida. Se retiró solo el contenedor de pruebas propio.

En aquella revisión B04-B continuaba sin aceptación. Siguiente acción en esa revisión: un único prompt B04-B-R2, limitado a comparación segura de firmas y regresiones de literales con espacios. La corrección posterior se documenta a continuación. No se modificaron SQL ni pruebas durante la revisión; solo documentación y registro. Sin commit ni publicación; índice vacío. No hay decisiones funcionales nuevas.

### Corrección B04-B-R2 — literales preservados

Implementación del 2026-10-28, limitada a la comparación de firmas y sus regresiones. No se modificaron columnas, reglas funcionales, dependencias, `database.sql` ni código de aplicación.

- **Corrección:** se eliminó `regexp_replace(..., '[[:space:]]+', '', 'g')`. La comparación usa exactamente `pg_get_constraintdef` contra la firma canónica esperada, sin normalizar espacios ni alterar el contenido de literales SQL.
- **Comprobaciones conservadas:** tipo de constraint, `convalidated`, `conenforced`, `condeferrable`, `condeferred`, `conperiod`, `conislocal`, `coninhcount`, `conparentid`, `connoinherit` y, para unicidad, `conkey` exacto de `(userid, idempotency_key)`.
- **Regresiones nuevas:** una constraint de metadatos con `'version'` sustituido por `'ver sion'` y otra con `'parameters'` sustituido por `'para meters'`. En ambos casos se inserta un metadato que omite el campo original, demostrando que la constraint modificada es más débil; la segunda ejecución de la migración debe rechazarla y revertir.
- **Comportamiento conservado:** la definición original sigue siendo aceptada en la segunda ejecución; la primera aplicación, la atomicidad, el histórico y el rechazo de `UNIQUE` con columna extra, `OR true` y `NOT VALID` se mantienen.
- **Resultados:** 28 pruebas de migración PostgreSQL, 68 de integración, 31 HTTP y 197 totales en 20 archivos, con Node 24.22.1. Las 98 unitarias y la comparación completa de valores históricos se conservan.
- **Limpieza:** seed de 4 usuarios, 66 instrumentos, 11 órdenes y 126 cotizaciones; fixtures y columnas B04-B revertidos. Se retiraron únicamente el contenedor `db-test` y la red de la validación; no se ejecutó `docker-compose down` ni la migración sobre desarrollo.
- **Estado al entregar R2:** pendiente de revisión de aceptación; la revisión final se registra abajo. No se hizo commit, push, PR, merge ni cambio de rama. La comparación exacta rechaza variantes no soportadas y no intenta resolver equivalencia lógica de SQL.

### Aceptación independiente B04-B/R1/R2

Revisión finalizada el 2026-10-28 sin nuevos hallazgos dentro del alcance aprobado. Se inspeccionaron migración y pruebas por separado. La comparación exacta de `pg_get_constraintdef` conserva literales; ambas regresiones nuevas demuestran que los CHECK alterados admiten metadatos sin los campos originales y que la segunda ejecución los rechaza. Se mantienen las regresiones anteriores y la segunda ejecución compatible. La comparación es deliberadamente conservadora y está fijada a PostgreSQL 18.6; no resuelve equivalencia lógica arbitraria ni garantiza compatibilidad de su representación canónica con otras versiones.

Validación independiente ejecutada con Node 24.22.1: tipos de pruebas y suite completa con PostgreSQL 18.6 aislado, 197 pruebas aprobadas en 20 archivos (98 unitarias, 68 de integración y 31 HTTP). No se repitieron tipos/build de aplicación porque no hubo cambios pertinentes en código, configuración o dependencias. Consigna y SQL original sin cambios. La huella del contenido de todas las filas de las cuatro tablas coincidió antes y después de la suite; no incluye secuencias. Estado final: 4 usuarios, 66 instrumentos, 11 órdenes, 126 cotizaciones y ninguna columna B04-B persistida. Se retiró únicamente el contenedor `db-test` creado para esta revisión; no se aplicó la migración a desarrollo.

B04-B/R1/R2 aceptados como migración aditiva de identidad idempotente. No completan comparación, recuperación, reintentos ni envío de órdenes. Durante la revisión no se modificaron SQL ni pruebas, solo documentación y registro. El usuario autorizó un único commit local de los seis archivos de migración, integración y documentación, con mensaje `feat(database): add order idempotency migration`. La autorización se limitó a ese commit, materializado en `35f87f4`, y no habilita publicación ni commits de bloques posteriores. El trabajo posterior fue B04-C, implementado y validado localmente más abajo.

### B04-C — alcance y contrato interno aprobados

El usuario confirmó continuar el 2026-10-28 tras revisar el contrato propuesto y su contraste con la consigna. Se aprueba B04-C limitado al modelo interno de intención, normalización y comparación, sin HTTP, consultas/escrituras, recuperación ni reintentos.

- Metadatos versión 1: instrumento, BUY/SELL, MARKET/LIMIT, modo cantidad/monto y valor original; incluir precio solicitado solo para LIMIT. No incorporar close de ejecución MARKET, cantidad derivada por conversión, estado actual o disponibilidad como parte de la intención original.
- Cantidad y decimales se representan como strings canónicos sin exponente ni redondeo. Representaciones decimales válidas como `10`, `10.0` y `10.00` son equivalentes; modo size y modo amount siguen siendo intenciones distintas. Se valida antes de normalizar, sin convertir entradas inválidas en válidas.
- Metadatos persistidos inválidos o versión desconocida generan error interno, no coincidencia/conflicto de intención ni permiso de crear otra orden. La traducción HTTP queda abierta.
- Nombres y firmas concretas serán decisiones técnicas de implementación, conservando el contenedor mínimo de B04-B (`version` y `parameters`). No se cierra sintaxis HTTP, rangos nuevos, precisión de divisiones o redondeo de presentación. No se añade un framework de versionado ni nuevos CDU públicos.

Contraste funcional: instrumento, BUY/SELL, MARKET/LIMIT, cantidad o monto y precio LIMIT proceden de la consigna. Idempotencia, conservación de intención, comparación normalizada y JSONB versionado son agregados aprobados. El usuario adoptó después del contraste la estructura semántica de v1, cantidad como string canónico y política de error interno. La partición B04-C no sustituye la API ni el test funcional de envío exigidos.

B04-C quedó implementado y validado localmente el 2026-10-28. El componente, sus contratos, pruebas y límites se detallan en [Implementación y validación B04-C](#implementación-y-validación-b04-c). No hay autorización de implementación directa al coordinador ni publicación de B04-C; el usuario autorizó su único commit local. B04-B quedó versionado localmente en `35f87f4`; su autorización de commit está consumida.

## Implementación y validación B04-C

Implementación autorizada por el prompt B04-C el 2026-10-28, limitada al modelo puro de intención, normalización y comparación. No se implementaron endpoints, DTOs HTTP, consultas, escrituras, conversión de amount, ejecución, recuperación ni reintentos. No se modificaron dependencias, `database.sql`, efectivo, tenencias ni reservas. No se hizo commit, push, PR ni merge.

### Contratos y decisiones técnicas

- `src/orders/domain/order-intent.ts`: `createOrderIntent(input)` valida y devuelve `OrderIntent`; `orderIntentsEqual(left, right)` compara campos semánticos explícitos.
- `src/orders/domain/order-intent-metadata.ts`: `buildOrderIntentMetadata(intent)` construye `OrderIntentMetadataV1`; `readOrderIntentMetadata(value)` valida y reconstruye la intención.
- `src/orders/domain/order-intent.error.ts`: `OrderIntentError` con códigos internos para entrada inválida, metadatos inválidos y versión desconocida.
- `OrderIntent` contiene `instrumentId`, `side`, `type`, `mode`, `size`, `amount` y `limitPrice`. `limitPrice` es obligatorio y no nulo solo para LIMIT; MARKET no conserva close, cantidad derivada, estado, disponibilidad ni reservas.
- `size` y `amount` son modos distintos y excluyentes. La comparación incluye el modo y el valor original; no se usa cantidad derivada por conversión.
- Los decimales se validan y normalizan como strings canónicos sin exponente ni redondeo. `10`, `10.0` y `10.00` producen `"10"`. La escala monetaria efectiva se limita a dos decimales; los ceros finales escritos y la sintaxis léxica HTTP no se deciden aquí.
- `decimal.js` se usa con una configuración local derivada de cada valor; no se modifica la configuración global ni se convierten importes a `Number`. Se conservan valores grandes exactos.
- Metadatos v1:
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
  El campo del modo no elegido y `limitPrice` en MARKET se omiten. La lectura acepta ausencia o `null` en esos campos no aplicables, pero rechaza valores no nulos, tipos incorrectos, versión desconocida y metadatos incompletos.
- `readOrderIntentMetadata` no compara ni decide coincidencia/conflicto: ante metadatos inválidos o versión desconocida lanza `OrderIntentError`. La traducción HTTP queda fuera del bloque.
- La comparación no serializa el JSON ni depende del orden de propiedades; usa los campos semánticos.

### Pruebas y evidencia

| Garantía | Tipo de prueba | Resultado |
| --- | --- | --- |
| Normalización decimal exacta y equivalencia `10`/`10.0`/`10.00` | Unitarias de dominio | Aprobadas |
| Diferencias de instrumento, side, tipo, modo, valor y precio LIMIT | Unitarias de dominio | Aprobadas |
| `size` y `amount` distintos aunque compartan valor; montos distintos que podrían convertir a igual cantidad | Unitarias de dominio | Aprobadas |
| Construcción y lectura v1; campos omitidos; round-trip JSON | Unitarias de metadata | Aprobadas |
| Orden de propiedades JSON irrelevante | Unitaria de metadata con objeto reordenado | Aprobada |
| Metadatos incompletos, inválidos, claves alteradas y versión desconocida | Unitarias con códigos internos | Aprobadas |
| Configuración global de `Decimal` intacta y valores grandes sin `Number` | Unitaria de dominio | Aprobada |
| Sin close MARKET, cantidad derivada, estado, disponibilidad o reservas en la identidad | Unitaria de estructura del modelo | Aprobada |

Resultados ejecutados con Node 24.22.1:

- `tsc --noEmit -p tsconfig.json`: correcto.
- `tsc --noEmit -p tsconfig.test.json`: correcto.
- `tsc -p tsconfig.json`: build correcto.
- `vitest run --config vitest.unit.config.ts`: 15 archivos y 172 pruebas. B04-C aporta 74 unitarias nuevas.

No se repitieron integración PostgreSQL ni HTTP porque el bloque no modifica persistencia, red ni infraestructura; conservan sus últimas 68 y 31 pruebas, respectivamente. No se utilizaron servicios externos para esta validación.

### Limitaciones y decisiones abiertas

- B04-C aceptado tras revisión independiente; el usuario autorizó su único commit local, sin publicación.
- Q02/Q03 y los contratos HTTP restantes siguen abiertos: sintaxis pública, exponentes de entrada, ceros finales escritos, rangos nuevos, divisiones y redondeo de presentación. El componente recibe valores semánticos y no define esas reglas de transporte.
- Solo se soporta metadatos v1. No se añade un framework de versiones ni compatibilidad entre versiones futuras.
- No hay endpoint, DTO, repositorio, transacción, envío, recuperación, reintentos ni persistencia en este bloque. Los errores internos no tienen todavía traducción HTTP.
- La comparación y normalización no modifican efectivo, tenencias, reservas ni órdenes existentes.

### Aceptación independiente B04-C

Revisión finalizada el 2026-10-28 sin hallazgos que impidan aceptar el componente dentro de su alcance aprobado. Se inspeccionaron los tres archivos de dominio y las dos suites nuevas por separado de la evidencia recibida. Se verificaron validación semántica, normalización decimal exacta, comparación de los modelos canónicos por campos, distinción entre modos y monto original, construcción/lectura v1, errores internos y ausencia de dependencias Nest/HTTP/SQL.

Validación independiente ejecutada con Node 24.22.1: tipos de aplicación y pruebas, build y suite unitaria con `TEST_PGDATABASE=blocked_for_unit_tests` y PostgreSQL inactivo: 172 pruebas aprobadas en 15 archivos, incluidas las 74 nuevas. No se repitieron integración PostgreSQL ni HTTP: el código de aplicación existente, adapters, migración, dependencias, consigna y SQL original permanecen sin cambios respecto de HEAD; se agregan únicamente los modelos puros y sus unitarias. La última suite completa efectivamente ejecutada sigue siendo la de B04-B, con 197 pruebas; no se presenta una suma de grupos como una nueva ejecución completa.

B04-C aceptado como componente puro para construir, leer y comparar intención original v1. Los consumidores deberán usar las funciones de construcción/lectura para obtener los modelos canónicos que compara `orderIntentsEqual`; no se acredita validación HTTP, lookup por clave, persistencia, recuperación ni reintentos. Q02/Q03 y los contratos públicos pendientes conservan su estado.

Durante la revisión solo se actualizaron documentación y registro; no se modificaron código ni pruebas. El usuario autorizó un único commit local de los nueve archivos de dominio, pruebas y documentación con mensaje `feat(orders): model and compare original order intent`. La autorización se limitó a ese commit, materializado en `87f2276`, y no habilita publicación ni commits posteriores. El trabajo posterior fue B04-D, implementado y validado localmente más abajo.

### B04-D — Lectura y resolución interna de reenvíos

B04-D implementa la lectura por usuario/UUID, el adapter PostgreSQL ligado al cliente transaccional y la resolución interna de ausencia/coincidencia/conflicto usando B04-C. Implementa una parte de las garantías de F05 ya aprobadas; no introduce otro CDU público ni define la respuesta HTTP.

- La lectura debe ejecutarse después del bloqueo del usuario y con el repositorio ligado al cliente de B04-A. El resolvedor recibe ese repositorio como precondición; no adquiere el bloqueo por sí solo. El callback puede continuar dentro de esa transacción; no se cierra una transacción de consulta para crear luego en otra basándose en una ausencia obsoleta.
- Consultar por usuario y UUID, sin filtrar estados. Una coincidencia recupera la orden en su estado persistido actual, incluido CANCELLED; no la reabre, revalida disponibilidad, obtiene una cotización nueva ni cambia efectos.
- Comparar la intención original mediante el lector y comparador de B04-C. Diferencias válidas producen conflicto interno; metadatos inválidos, versión desconocida o fallo técnico producen error interno, nunca ausencia ni autorización de crear otra orden.
- La ausencia solo informa que no se encontró la clave bajo el bloqueo actual. B04-D no implementa creación de órdenes de producción, ejecución, cancelación, recuperación de COMMIT incierto, reintentos, timeouts o endpoints. No completa por sí solo la idempotencia.
- Los nombres, firmas y modelo interno de orden leída son decisiones técnicas de esta implementación, detalladas abajo. No se fijó proyección HTTP ni se cerraron Q02/Q03/Q04/Q06/Q07.
- Validación: unitarias aisladas del adapter/componente y PostgreSQL real en un esquema exclusivo para consulta, estado actual, cliente y bloqueo; se preservó el esquema público que requieren las suites anteriores.

## Implementación y validación B04-D

Implementación autorizada por el prompt B04-D el 2026-10-28, limitada a la lectura por usuario/UUID y la resolución interna de reenvíos. No se implementaron creación de órdenes, ejecución, cancelación, endpoints, DTOs, reintentos, timeouts ni recuperación automática. No se modificaron migración, `database.sql`, dependencias, reservas, reglas monetarias ni el esquema público de pruebas. No se hizo commit, push, PR ni merge.

### Contratos y decisiones técnicas

- `src/orders/domain/persisted-order.ts`: `PersistedOrder` contiene `id`, `userId`, `idempotencyKey`, `status` y `intentMetadata` crudo. `PersistedOrderStatus` cubre `NEW`, `FILLED`, `REJECTED` y `CANCELLED`.
- `src/orders/application/ports/out/persisted-order.repository.ts`: `PersistedOrderRepository.findByUserIdAndIdempotencyKey(userId, idempotencyKey)` devuelve la orden o `null`. El puerto no depende de pg.
- `src/orders/infrastructure/persistence/postgres-persisted-order.repository.ts`: consulta parametrizada por `userid` y `idempotency_key::uuid`, sin filtro de estado; selecciona `id`, usuario, estado, clave como texto y metadatos JSONB. Valida los campos estructurales de la fila y propaga fallos del cliente.
- `AccountTransactionContext.persistedOrders` se construye por ejecución con `PostgresPersistedOrderRepository(client)`. Comparte el cliente y el bloqueo de B04-A; no registra un provider singleton ni usa `pool.query` dentro de la transacción.
- `src/orders/application/resolve-order-replay.ts`: `resolveOrderReplay(repository, { userId, idempotencyKey, intent })` devuelve `absent`, `match` con la orden actual o `conflict`. Usa `readOrderIntentMetadata` y `orderIntentsEqual` de B04-C; no usa serialización JSON ni recalcula cantidad, precio o disponibilidad.
- Metadatos inválidos o de versión desconocida propagan `OrderIntentError`; un fallo de lectura se propaga sin convertirse en ausencia. Un conflicto no devuelve la orden ni sobrescribe la fila.
- La ausencia es un resultado de lectura bajo el bloqueo actual. El callback transaccional puede continuar con una futura creación dentro de la misma sección crítica; no se ofrece como permiso para crear fuera de ella.

### Pruebas y evidencia

| Garantía | Verificación | Resultado |
| --- | --- | --- |
| Parametrización por usuario/UUID, sin filtro de estado ni interpolación | Unitarias del adapter con cliente falso | Aprobadas |
| Mapeo de id, usuario, clave, estados y metadatos crudos; ausencia y propagación de fallos | Unitarias del adapter | Aprobadas |
| Coincidencia, diferencias semánticas, size/amount e independencia del orden JSON | Unitarias del resolvedor | Aprobadas |
| Metadatos inválidos/versión desconocida y fallo del repositorio no se convierten en ausencia/conflicto | Unitarias del resolvedor | Aprobadas |
| Misma clave en cuentas distintas recupera la fila correcta | PostgreSQL aislado en esquema exclusivo | Aprobada |
| Recuperación de `NEW`, `FILLED`, `REJECTED` y `CANCELLED` sin efectos | PostgreSQL aislado, cuatro estados | Aprobadas |
| Ausencia sin creación; conflicto y errores conservan la fila original | PostgreSQL aislado | Aprobadas |
| Lectura de fila no confirmada con el cliente del callback | PostgreSQL aislado con pool que registra el cliente | Aprobado |
| Espera verificable y lectura del estado confirmado por quien libera el bloqueo | PostgreSQL aislado, señales y `pg_blocking_pids` | Aprobado |

La integración crea el esquema exclusivo `b04d_test` dentro de `cocos_test`, aplica allí la migración B04-B, ejecuta fixtures y elimina el esquema al finalizar. No modifica el esquema público que requieren las suites anteriores. La prueba de cliente inserta una fila no confirmada mediante el mismo cliente y comprueba que el contexto la ve. La prueba concurrente bloquea la cuenta, actualiza CANCELLED en A, verifica que B espera en el lock y, tras el COMMIT de A, B lee CANCELLED. Los casos de conflicto y metadatos inválidos comparan la fila antes y después.

Comandos ejecutados con Node 24.22.1 y PostgreSQL 18.6:

- `tsc --noEmit -p tsconfig.json`: correcto.
- `tsc --noEmit -p tsconfig.test.json`: correcto.
- `tsc -p tsconfig.json`: build correcto.
- `vitest run --config vitest.unit.config.ts` con `db-test` apagado: 17 archivos y 201 pruebas.
- `vitest run --config vitest.integration.config.ts`: 6 archivos y 79 pruebas.
- `vitest run --config vitest.http.config.ts`: 2 archivos y 31 pruebas.
- `vitest run`: 25 archivos y 311 pruebas (201 unitarias, 79 de integración y 31 HTTP).

B04-D aporta 29 unitarias y 11 pruebas de integración nuevas. Seed final del esquema público: 4 usuarios, 66 instrumentos, 11 órdenes y 126 cotizaciones; sin columnas B04-B en `public.orders` y sin esquema `b04d_test` persistido. Se retiraron únicamente el contenedor `db-test` y la red de la validación; no se ejecutó `docker-compose down` sobre el proyecto completo.

### Limitaciones y decisiones abiertas

- B04-D aceptado tras revisión independiente; el usuario autorizó su único commit local, sin publicación.
- La lectura y el conflicto son internos: no hay traducción HTTP, códigos públicos, payloads ni endpoints.
- No se implementan creación, ejecución, cancelación, recuperación automática de COMMIT incierto, reintentos ni timeouts. La ausencia no autoriza crear fuera del callback protegido.
- El modelo persistido es de lookup, no la proyección pública completa de una orden. Incluye intención cruda para que B04-C la valide.
- La validación léxica del UUID de entrada corresponde al futuro DTO/HTTP. El adapter lo envía como parámetro y un formato inválido provoca un error de PostgreSQL propagado, nunca una ausencia.
- La prueba de concurrencia usa límites temporales del harness; no son timeouts de producción.
- Q02/Q03/Q04/Q06/Q07 y la idempotencia completa siguen abiertos.

### Aceptación independiente B04-D

Revisión finalizada el 2026-10-28 sin hallazgos que impidan aceptar el bloque dentro de su alcance. Se inspeccionaron puerto, modelo, adapter, resolvedor, composición transaccional y pruebas por separado. Se comprobaron SQL parametrizado por usuario/UUID sin filtro de estado, mapeo explícito, comparación de intención mediante B04-C, propagación de errores y ausencia de escrituras de producción. El contexto construye el adapter con el mismo cliente por ejecución, sin modificar providers singleton.

Se aclara una precondición: `resolveOrderReplay` no adquiere el bloqueo por sí solo. El futuro CDU debe invocarlo con `context.persistedOrders` dentro del callback de B04-A y continuar allí cualquier futura creación. El resultado `absent` no constituye autorización para crear en otra transacción. Esta revisión no acredita un CDU de envío todavía inexistente.

Validación independiente ejecutada con Node 24.22.1: tipos de aplicación y pruebas, build, 201 unitarias con PostgreSQL inactivo y `TEST_PGDATABASE=blocked_for_unit_tests`, y suite completa con PostgreSQL 18.6 aislado: 311 pruebas aprobadas en 25 archivos (201 unitarias, 79 integración y 31 HTTP). No se repitieron integración/HTTP por separado tras la suite completa. Las pruebas nuevas verifican las cuentas separadas con igual clave, cuatro estados, conflicto/errores sin efectos, lectura de fila no confirmada por el cliente del contexto y espera con metadatos de bloqueo seguida de lectura de CANCELLED confirmado.

El contenido de las filas de las cuatro tablas públicas conservó la huella anterior a la suite; no incluye secuencias. Estado final: 4 usuarios, 66 instrumentos, 11 órdenes, 126 cotizaciones, ninguna columna B04-B en `public.orders` y ausencia del esquema `b04d_test`. Se retiró únicamente el contenedor `db-test` creado para esta revisión. La integración usa tablas mínimas de fixture en su esquema exclusivo; no se presenta como test funcional de envío con el esquema completo. Consigna, SQL original, migración y dependencias permanecen sin cambios.

Durante la revisión solo se actualizaron documentación y registro; no se modificaron código ni pruebas. El usuario autorizó un único commit local de los 14 archivos de lectura/resolución, composición, pruebas y documentación con mensaje `feat(orders): resolve persisted order replays`. La autorización se limita a ese commit; no habilita publicación ni commits posteriores. El siguiente trabajo del coordinador es entregar un único prompt B04-E, sin implementar código directamente. Creación, ejecución, HTTP, reintentos y recuperación automática siguen pendientes.

### B04-E — Escritura atómica de una orden preparada

Siguiente bloque seleccionado para el prompt externo: puerto de escritura, modelo propio de orden preparada y adapter pg ligados al cliente transaccional. Inserta los valores ya decididos y conserva UUID y metadatos originales en la misma fila de `orders`. Aplica la atomicidad y estados de F04/F05 ya aprobados; no cierra el CDU de envío ni contratos HTTP.

- Recibir cantidad, precio, estado y fecha ya preparados. No seleccionar cotización, convertir amount, comprobar suficiencia o decidir estado/fecha en el repositorio. Conservar la intención original de B04-C y su diferencia frente a valores derivados. Nombres, firmas y representación técnica del registro preparado se definen al implementar.
- Escribir dentro del callback bloqueado de B04-A con el mismo cliente. No abrir otra transacción, confirmar por cuenta propia o usar `pool.query`; la futura secuencia de envío deberá resolver B04-D, calcular y escribir dentro de esa misma sección crítica.
- INSERT parametrizado con UUID/metadatos junto a las columnas originales. Sin tablas adicionales, defaults que inventen UUID o metadatos históricos ni sobrescritura ante conflicto. Propagar fallos de SQL/constraints con evidencia preservada, sin convertirlos en éxito, ausencia o recuperación automática.
- Persistir órdenes preparadas en NEW/FILLED/REJECTED; no crear CANCELLED ni implementar cancelación. El escritor no vuelve a decidir suficiencia ni revierte un REJECTED preparado por ser un rechazo de negocio. Los efectos derivados de cada estado se validan reutilizando B02, sin nuevas tablas de saldos o reservas.
- Respetar representabilidad del esquema y no truncar/redondear silenciosamente datos preparados; esto no decide errores HTTP ni rangos de aceptación públicos. No definir política temporal: persistir la fecha recibida y dejar la asignación del tiempo al futuro CDU. No cerrar Q02/Q03/Q06 o la recuperación/reintentos de Q04.
- Validación con unitarias aisladas y PostgreSQL real en esquema exclusivo cargado desde el SQL original intacto y la migración B04-B: inserción, identidad conjunta, rollback, unicidad y efectos observables en B02. Escrituras de preparación de escenarios solo en fixtures; no se presenta como test funcional del CDU de envío todavía inexistente.

Estado: prompt preparado, implementación externa pendiente; no hay autorización de implementación directa al coordinador, commit o publicación de B04-E.

## Revisión del diseño de alto nivel

El usuario autorizó completar y actualizar [diseno-alto-nivel.excalidraw](diseno-alto-nivel.excalidraw). El High Level Design representa una API NestJS con Express, controllers y ValidationPipe, cuatro CDU independientes —portfolio, búsqueda, envío y cancelación— y puertos de salida con adapters pg conectados a PostgreSQL. Se conserva el archivo original descargado de la raíz y las notas de requisitos; se actualiza el bloque de contratos HTTP conforme a las secuencias aprobadas.

Se retiran las referencias a componentes o stack «propuestos» y las etiquetas antiguas de API Gateway. El diagrama muestra la arquitectura aprobada, con reservas, idempotencia, estados y cancelación independientes; las decisiones no se atribuyen automáticamente a la consigna. El usuario indicó que ya había agregado las entidades faltantes y pidió omitir ese cambio: se conservan el nodo DB y su listado actual. Las notas originales de requisitos no añaden obligaciones a la fuente backend.

Esta revisión solo modifica el artefacto de diseño, este registro de decisiones y el registro de sesión. No autoriza implementación, commits ni publicación del repositorio. Validación: inspección visual del canvas, revisión de conexiones y tipografía, comprobación del JSON nativo y preservación de las notas y archivos originales. Se comprueban enlaces locales, espacios e índice; no se ejecutan pruebas de aplicación.

### Secuencias aprobadas — 2026-10-27

- Por solicitud del usuario se agregan cuatro marcos editables al mismo Excalidraw: consultar portfolio, buscar instrumentos, enviar orden y cancelar orden. Se conserva el contenido anterior y se sitúan los nuevos diagramas a su derecha.
- Las secuencias muestran cliente, adapter HTTP, puerto de entrada/CDU, puertos de salida/adapters pg y PostgreSQL. Incorporan alternativas de cotización, idempotencia, estados y efectos sobre reservas. El usuario aprobó los cuatro diagramas; se retiran las marcas de revisión y aprobación pendiente. Esta aprobación del diseño no concede autorización de implementación.
- Se revisaron las herramientas disponibles y se editó el JSON nativo, sin investigación externa. A petición del usuario se realizó una sola revisión visual de los cuatro marcos y se corrigió el espaciado detectado; no se repitieron validaciones del proyecto ni se ejecutaron aplicación o pruebas. Solo se modifica diseño y documentación asociada; sin commits o publicación.
- El único follow-up solicitado hasta ahora, sobre precisión y redondeo monetario, se muestra en verde y conserva su registro en README. Las definiciones todavía no concretadas se conservan como notas neutras; aprobar un flujo no inventa los valores que el diagrama no especifica.
- Actualización del High Level Design: se incorpora cancelación con sus conexiones y se sincronizan stack y contratos, conservando entidades y secuencias. Una revisión visual del bloque, sin ejecutar aplicación o pruebas ni repetir validaciones del proyecto. La lectura del checkout solo encuentra bootstrap/configuración NestJS; el dibujo representa arquitectura aprobada y no acredita una implementación funcional ausente del árbol visible.
