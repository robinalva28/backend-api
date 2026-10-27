# Plan y decisiones del proyecto

Este documento concentra el estado, decisiones y planificación. Las propuestas no representan decisiones aprobadas. Los requisitos y sus criterios están en [requisitos.md](requisitos.md); las reglas de autorización y sesiones, en [AGENTS.md](../AGENTS.md).

## Etapa vigente y restricciones

El usuario aprobó los puntos de arquitectura y solicitó incorporarlos al plan, crear Dockerfile y Compose, usar Express y fijar versiones estables actuales de PostgreSQL, pg y las demás dependencias. La base técnica y su arranque local están preparados. La revisión del 2026-10-27 organiza una [especificación SDD parcial](backend-features.spec) para D01 y D03–D08, con alternativa A de D05 confirmada. Incluye el análisis ILIKE de D06, errores públicos genéricos de D07 y diseño de cancelación independiente solicitado en D08. No implementa CDU, pruebas o migraciones. Permanecen preguntas de contrato y propuestas sin aprobar.

Resolver los casos residuales de D01/D04/D05, la investigación D03 y D06–D08 antes de implementar sus comportamientos afectados. D02 y las reglas aceptadas de D01/D04/D05 están confirmadas abajo; no se presentan propuestas técnicas del spec como aprobadas. Conservar el SQL original, los otros Markdown y cualquier trabajo existente. La autorización vigente incluye los commits locales de documentación y análisis delimitados en la sección de versionado; no habilita implementación, push, PR o merges.

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
| Pruebas | Nest mantiene sus utilidades independientes del runner. | Vitest 5.0.5, Supertest 7.3.1 y `@nestjs/testing` 12.2.0. Unitarias de reglas/CDU y test funcional con PostgreSQL real; suite y configuración específica de los futuros tests aún pendientes. |
| Ejecución local | Compose coordina servicios y espera su disponibilidad. | Dockerfile por etapas y Compose con `app`, `db` persistente y `db-test` efímera bajo perfil `test`. SQL montado solo para lectura y healthchecks de arranque. |
| Dinero y entradas | La escala de base no reemplaza la aritmética decimal de la aplicación. | decimal.js 10.6.0; ValidationPipe con class-validator 0.15.1 y class-transformer 0.5.1; `@nestjs/config` 12.0.1. El arranque actual valida PORT; reglas de dinero y validación del adapter de datos se completarán con sus CDU. |

Organización aprobada: controller → puerto de entrada del CDU → implementación del CDU → puertos de salida → adapters de infraestructura, agrupados por funcionalidad. Una interfaz por CDU con parámetros y retornos explícitos; puertos de salida para repositorios, cotizaciones y transacciones, sin interfaces para cada clase auxiliar. Dominio y CDU independientes de Nest, HTTP y SQL; modelos propios y mapeadores en adapters. Tokens centralizados, como [Symbol](https://docs.nestjs.com/fundamentals/custom-providers), porque las interfaces desaparecen al compilar. Componer con `useFactory` o alias `useExisting`, evitando registros duplicados; errores de aplicación traducidos a HTTP en la entrada. Adapter permite reemplazar dependencias, no garantiza escalabilidad operativa. Estos contratos se crearán al implementar los CDU, sin copiar el scaffold de referencia.

Propuesta de diseño aún pendiente: calcular portfolio desde órdenes, sin una tabla adicional de posiciones. La concurrencia y la idempotencia del envío ya cuentan con decisiones aprobadas en la sección siguiente; las reservas se confirman en D02. D01 cuenta con valoración y costo promedio móvil aprobados para historias válidas; permanecen abiertos los casos residuales y el tratamiento de datos inconsistentes de D03.

La infraestructura se limita a Docker local. No se justificaron microservicios, caché ni un servicio externo de mercado. Dockerfile fija `node:24.22.1-bookworm-slim`; Compose fija `postgres:18.6-bookworm`. Para PostgreSQL 18 el volumen apunta a `/var/lib/postgresql`, conforme a la [imagen oficial](https://hub.docker.com/_/postgres); el seed se ejecuta solo en volúmenes vacíos. La base de tests usa tmpfs y no comparte el volumen de desarrollo. La API tiene un bootstrap mínimo con Express, validación de entrada y cierre por señales, sin endpoints funcionales ni conexión de repositorios implementada. Los archivos de entorno, build y dependencias generadas se excluyen de Git y del contexto de imagen según corresponda.

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

**Alternativa A seleccionada:** UUID tipado y parámetros normalizados comparados directamente en `orders`, UNIQUE por usuario/UUID y bloqueo por cuenta; sin hash, caché, cola ni tabla adicional. Se mantienen los reintentos acordados; no se adopta delegarlos al cliente ni omitir la comparación. La elección no fija por sí sola la forma de metadatos (JSONB era un ejemplo), el aislamiento ni los detalles de contrato aún pendientes.

**Pendientes técnicos de este acuerdo:** representación de los parámetros originales normalizados, respuesta de recuperación/conflicto y migración compatible con las filas originales sin UUID. Precisar errores reintentables, esperas entre intentos y límites para adquirir conexión, esperar bloqueos, ejecutar y completar todos los intentos. No se han aprobado valores de timeout. `READ COMMITTED` con consultas de recursos posteriores al bloqueo y espera creciente con variación aleatoria siguen como propuestas; no se presupone una configuración implementada. El [análisis de casos límite y alternativas](backend-features.spec#análisis-de-casos-límite-y-consistencia) no revoca las garantías aprobadas.

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
| D05 | Alternativa A, rutas de portfolio/envío y códigos 201/200/409 de la secuencia confirmados, además de header, comparación y bloqueo. | Cerrar Q04: payloads, errores restantes, metadatos/migración, compatibilidad, aislamiento y límites. Las opciones B/C no se adoptan; no se elimina comparación, bloqueo o reintentos. |
| D06 — contrato cerrado | Ruta, universo y flujo de búsqueda literal ILIKE aprobados; Q05 cerrada por aprobación explícita de proyección, query única, máximo 255 caracteres Unicode y errores 400/500 genéricos. | Preparar B01 para el modelo externo; no volver a preguntar estos acuerdos ni presentar la búsqueda como implementada. |
| D07 | Selección fecha/id, sin reemplazo anterior, null para retorno diario sin base, error completo si falta close y mensajes genéricos confirmados. | Cerrar F07/Q06: fórmula/validaciones concretas, ausencia de fila para MARKET no procesable, nombre del campo diario y códigos/cuerpo técnico. ARS no necesita cotización. No reabrir las reglas confirmadas. |
| D08 | Endpoint, ruta/método, repetición 200 sin efectos, conflicto 409, entrada inválida 400, mismo 404 para orden inexistente/ajena y replay actual confirmados. | Cerrar F08/Q07: proyección de salida, validación concreta, usuario inexistente y mensajes. No reabrir órdenes ni duplicar reservas con el mismo UUID. Transferencias existentes sin API de creación. |

## Tareas futuras y dependencias

La preparación inicial está versionada y la base técnica de T02 está validada. Stack, arquitectura, idempotencia, concurrencia y reservas D02 están definidos; D01/D04/D05 tienen reglas aceptadas y preguntas residuales en el spec. D06/Q05 está cerrado; D03 y los contratos residuales de D07–D08 siguen abiertos. El diseño de cancelación ya está incluido. Las funcionalidades T03–T06 no están implementadas.

Coordinación SDD del 2026-10-27: el agente prepara prompts y revisa resultados de un modelo externo, sin implementar directamente salvo solicitud explícita. Bloque actual B01: búsqueda completa con conexión pg mínima y validación aislada; sin resultados externos recibidos ni validación funcional actual. La aprobación del contrato no autoriza implementación directa, commits o publicación. Siguiente acción: entregar un único prompt acotado y revisar su resultado antes de avanzar. Los demás bloques se delimitan cuando se alcance su dependencia funcional.

| Tarea | Depende de | Entrega y validación prevista |
| --- | --- | --- |
| T00 — Revisar preparación | Esta documentación | Setup versionado en 57c518e. El usuario solicitó continuar hacia implementación, comenzando por definir el stack; no autorizó nuevos commits ni publicación. |
| T01 — Cerrar contrato y stack | T00 | Stack, arquitectura y reservas D02 aprobados; versiones verificadas y fijadas. Cerrar preguntas residuales de D01/D04/D05, investigar D03 y revisar D06–D08 antes del comportamiento afectado; vincular spec y R01–R15. |
| T02 — Base técnica y datos | Stack aprobado de T01 | Bootstrap, dependencias y Dockerfile/Compose preparados. Validar ejecución local y seed sin editar; completar conexión, transacciones y contrato de errores con los adapters. Preparar, cuando se autorice implementar, la migración de idempotencia en `orders` conservando el SQL original. |
| T03 — Consultas contables y de mercado | T02; D01–D03, D07 | Cálculo de tenencias, cash/disponibilidad, costo y último precio; validar casos deterministas y tratamiento aprobado del seed inconsistente. Base compartida por portfolio y órdenes. |
| T04 — Portfolio y búsqueda | T03 para portfolio; T02 para búsqueda; D05/D06 | Implementar R01/R02 y contraste con los criterios aprobados; no copiar contratos de otros challenges. La búsqueda puede avanzar sin esperar el cálculo de portfolio. |
| T05 — Envío de órdenes y test funcional | T03; D02/D04/D05/D07; acuerdo de idempotencia y concurrencia | BUY/SELL, MARKET/LIMIT, cantidad/monto, persistencia de FILLED/NEW/REJECTED y actualización observable. Incorporar UUID por operación, unicidad por usuario, comparación de parámetros originales, bloqueo inicial y política de reintentos acordada. Incluir el test funcional de R14 y verificar el acuerdo de idempotencia; casos adicionales de insuficiencia y conversión según riesgo, sin inventar cobertura porcentual obligatoria. |
| T06 — Cancelación independiente | T02; reservas D02 y protocolo D05; contrato D08 | Alcance de diseño incluido. Implementar cuando se autorice, con CDU propio y puertos compartidos, sin llamar al CDU de envío. Verificar estados, reservas, pertenencia y concurrencia/reenvíos junto con T05. |
| T07 — Validación y documentación de entrega | T04/T05/T06 | Ejecutar pruebas existentes, contrastar R01–R15 y documentar comandos reales, decisiones y resultados. Añadir O01 solo si se elige. Revisar privacidad y diff; preparar propuesta de commit(s) para autorización. |
| T08 — Publicación y PR futuros | T07; autorizaciones separadas | Confirmar repositorio destino y base main; revisar rama y commits aprobados, publicar solo con permiso explícito y abrir PR solo cuando esté autorizado. No hacer merge por inferencia. |

Los commits futuros se agrupan por tarea coherente y se autorizan individualmente o como conjunto delimitado. La separación de tareas no obliga a fragmentar cambios que necesiten viajar juntos para funcionar.

## Condiciones para comenzar la implementación

1. El usuario autorizó la base técnica, dependencias y Docker local. Esto no implica nuevos permisos de commit, push, PR o merge.
2. El stack, D02 y las reglas documentadas de D01/D04/D05 están aprobados. Resolver sus preguntas residuales, D03 y D06–D08 antes de codificar los comportamientos afectados. El spec parcial no concede autorización de implementación.
3. Verificar nuevamente trabajo local, rama y remotos. El historial local está conservado; `origin` apunta ahora a `backend-cocos`. El cambio de URL no verifica acceso ni contenido del nuevo repositorio.
4. Verificar el arranque de los servicios Compose y el seed en PostgreSQL aislado, sin modificar la fuente SQL ni utilizar servicios de producción. La configuración está preparada; registrar por separado su validación y su ejecución real.

## Versionado autorizado y flujo de entrega propuesto

La preparación y la implementación posterior, cuando se autorice, se mantienen en `feature/backend-implementation`, sin crear una rama adicional para la solución. La base sigue siendo el historial original conservado localmente; `origin` apunta a `backend-cocos` y el fork anterior deja de ser el destino de trabajo.

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

## Revisión del diseño de alto nivel

El usuario autorizó cargar su archivo de Excalidraw en el canvas vacío del MCP y completar el diseño. Se conserva el archivo descargado de la raíz y se guarda el resultado editable en [diseno-alto-nivel.excalidraw](diseno-alto-nivel.excalidraw). Se mantienen las notas originales y el estilo; la entrada HTTP existente se identifica como componente lógico propuesto de una sola API. Se añaden portfolio, búsqueda, envío de órdenes y acceso a datos compartido, con sus conexiones al almacenamiento existente.

Node.js y los estados de órdenes se distinguen como requisitos de la fuente. Express, pg, PostgreSQL y la distribución interna siguen siendo propuestas; no se fijan versiones ni contratos nuevos. Los pendientes D01–D08 permanecen abiertos: el diagrama no decide fórmulas de rendimiento, reservas, tratamiento de tenencias negativas, conversión por monto, contratos, coincidencia, cotizaciones ausentes ni exposición de cancelación. Las anotaciones anteriores de contratos y RNF se conservan como borrador, sin ratificar sus propuestas.

Esta revisión solo modifica el artefacto de diseño, este registro de decisiones y el registro de sesión. No autoriza implementación, commits ni publicación del repositorio. Validación: inspección visual del canvas, revisión de conexiones y tipografía, comprobación del JSON nativo y preservación de las notas y archivos originales. Se comprueban enlaces locales, espacios e índice; no se ejecutan pruebas de aplicación.
