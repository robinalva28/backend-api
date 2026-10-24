# Plan y decisiones del proyecto

Este documento concentra el estado, decisiones y planificación. Las propuestas no representan decisiones aprobadas. Los requisitos y sus criterios están en [requisitos.md](requisitos.md); las reglas de autorización y sesiones, en [AGENTS.md](../AGENTS.md).

## Etapa vigente y restricciones

El usuario aprobó los puntos de arquitectura y solicitó incorporarlos al plan, crear Dockerfile y Compose, usar Express y fijar versiones estables actuales de PostgreSQL, pg y las demás dependencias. La etapa vigente prepara la base técnica y su arranque local; no implementa aún los CDU ni decide las reglas funcionales pendientes.

Resolver o aprobar los supuestos D01–D08 antes de implementar el comportamiento afectado. Conservar el SQL original, los otros Markdown y cualquier trabajo existente. El usuario autorizó un único commit de la base técnica descrito en la sección de versionado; no hay autorización para otros commits, push, PR o merges.

## Estado verificado y decisiones confirmadas

- El directorio inicial estaba vacío, sin instrucciones locales existentes ni repositorio Git propio o padre. No había trabajo previo que trasladar.
- Se verificó una única cuenta activa de GitHub y ausencia de un fork adecuado o conflicto de nombre. Se creó el [fork](https://github.com/robinalva28/cocos-challenge), cuyo padre y origen de red son el [repositorio original](https://github.com/cocoscap/cocos-challenge).
- El usuario retiró la restricción sobre inicializar Git después de consultar la diferencia entre inicializar y clonar. Se usó **clonación con el historial original**; no se ejecutó `git init` ni se creó historia independiente.
- `origin` apunta al fork y `upstream` al original. El HEAD local, `origin/main` y el `main` remoto del original se verificaron en `abae77016b4e07e97161a9567239dcde5c0c00e1`. Se creó la rama local `chore/backend-preparation` para preparar documentación.
- Por indicación del usuario, esa rama se renombró a `feature/backend-implementation`, única rama local de trabajo. Se eliminó la referencia local `main` después de verificar que apuntaba al mismo commit; se conservan el historial original, los archivos pendientes y `origin/main`. No se modificaron ramas remotas ni se hizo push.
- El usuario reemplazó la limpieza inicial por la instrucción de conservar los otros `.md` tal cual. No se elimina ningún archivo. Permanecen frontend, fullstack, QA y React Native, sin tratarlos como fuentes del backend.
- El setup quedó versionado en `57c518e` (`docs: prepare backend challenge setup`), con diez archivos y sin `.DS_Store`. No se hizo push. Posteriormente el usuario pidió continuar definiendo el stack y confirmó Docker para ejecución local.

## Decisiones técnicas aprobadas

Elecciones aprobadas por el usuario para tres capacidades REST y cuatro tablas. Las alternativas se conservan como justificación; no son requisitos impuestos por Cocos. Versiones estables comprobadas el 2026-10-24 contra el registro npm, las publicaciones de PostgreSQL y las imágenes oficiales. Dependencias directas sin rangos y resoluciones transitivas en el lockfile; sin benchmarks de rendimiento.

| Área | Alternativas consideradas | Decisión aprobada |
| --- | --- | --- |
| Framework | Express directo requiere menos estructura inicial. NestJS aporta módulos, providers e inyección de dependencias. | NestJS 12.2.0 y `@nestjs/platform-express` 12.2.0 con Express 5.3.0. Monolito modular; Fastify no está instalado. |
| Lenguaje y runtime | JavaScript reduce configuración; TypeScript permite expresar contratos sin sustituir validación de entradas. | TypeScript 7.0.2 estricto y ESM; Node 24.22.1, última revisión de la rama [LTS elegida](https://nodejs.org/en/about/previous-releases). Tipos de Node 24.19.2, últimos compatibles con esa rama en vez de los tipos de Node 26. |
| Base y acceso | SQL directo facilita agregaciones y control transaccional; un ORM añadiría modelado y generación para cuatro tablas. | PostgreSQL 18.6, [última estable publicada](https://www.postgresql.org/support/versioning/), y pg 8.23.1. PostgreSQL 19 está en RC y no se usa. No se modifica el esquema de referencia. |
| Pruebas | Nest mantiene sus utilidades independientes del runner. | Vitest 5.0.5, Supertest 7.3.1 y `@nestjs/testing` 12.2.0. Unitarias de reglas/CDU y test funcional con PostgreSQL real; suite y configuración específica de los futuros tests aún pendientes. |
| Ejecución local | Compose coordina servicios y espera su disponibilidad. | Dockerfile por etapas y Compose con `app`, `db` persistente y `db-test` efímera bajo perfil `test`. SQL montado solo para lectura y healthchecks de arranque. |
| Dinero y entradas | La escala de base no reemplaza la aritmética decimal de la aplicación. | decimal.js 10.6.0; ValidationPipe con class-validator 0.15.1 y class-transformer 0.5.1; `@nestjs/config` 12.0.1. El arranque actual valida PORT; reglas de dinero y validación del adapter de datos se completarán con sus CDU. |

Organización aprobada: controller → puerto de entrada del CDU → implementación del CDU → puertos de salida → adapters de infraestructura, agrupados por funcionalidad. Una interfaz por CDU con parámetros y retornos explícitos; puertos de salida para repositorios, cotizaciones y transacciones, sin interfaces para cada clase auxiliar. Dominio y CDU independientes de Nest, HTTP y SQL; modelos propios y mapeadores en adapters. Tokens centralizados, como [Symbol](https://docs.nestjs.com/fundamentals/custom-providers), porque las interfaces desaparecen al compilar. Componer con `useFactory` o alias `useExisting`, evitando registros duplicados; errores de aplicación traducidos a HTTP en la entrada. Adapter permite reemplazar dependencias, no garantiza escalabilidad operativa. Estos contratos se crearán al implementar los CDU, sin copiar el scaffold de referencia.

Propuesta de diseño: calcular portfolio desde órdenes, sin una tabla adicional de posiciones. En el envío, realizar lectura de recursos, validación y persistencia dentro de una transacción usando el mismo cliente de `pg`; un rechazo por recursos se guarda y confirma como resultado de negocio, no se pierde por un rollback genérico. Para evitar que dos órdenes gasten los mismos recursos, evaluar bloqueo de la fila de usuario durante esa transacción. Es una protección propuesta para R07, no un requisito independiente de la consigna. Referencias: [transacciones de pg](https://node-postgres.com/features/transactions) y [bloqueos de PostgreSQL](https://www.postgresql.org/docs/current/explicit-locking.html).

La infraestructura se limita a Docker local. No se justificaron microservicios, caché ni un servicio externo de mercado. Dockerfile fija `node:24.22.1-bookworm-slim`; Compose fija `postgres:18.6-bookworm`. Para PostgreSQL 18 el volumen apunta a `/var/lib/postgresql`, conforme a la [imagen oficial](https://hub.docker.com/_/postgres); el seed se ejecuta solo en volúmenes vacíos. La base de tests usa tmpfs y no comparte el volumen de desarrollo. La API tiene un bootstrap mínimo con Express, validación de entrada y cierre por señales, sin endpoints funcionales ni conexión de repositorios implementada. Los archivos de entorno, build y dependencias generadas se excluyen de Git y del contexto de imagen según corresponda.

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

## Pendientes funcionales

No corregir los datos ni resolver estos puntos incorporando reglas de los otros challenges. Antes de implementar el comportamiento afectado, confirmar una regla o aprobar explícitamente un supuesto documentado.

| ID | Ambigüedad y consecuencia | Propuesta para revisión |
| --- | --- | --- |
| D01 | La consigna pide rendimiento total y explica retorno diario, pero no define costo base, ventas parciales ni ganancia realizada. Distintas fórmulas producen respuestas diferentes. | Proponer valor de posición = cantidad neta FILLED × último close y total de cuenta = efectivo contable + suma de valores de posiciones, sin descontar reservas dos veces. Separar retorno diario `100 × (close − previousClose) / previousClose` de rendimiento total de la posición abierta. Evaluar costo promedio ponderado móvil con operaciones FILLED en orden temporal; confirmar tratamiento de ventas, posiciones vacías/negativas y denominadores cero antes de fijar la fórmula total. No añadir métricas de ganancia realizada por defecto. |
| D02 | No se establece si NEW reserva pesos/acciones. Cambia la disponibilidad del portfolio y la aceptación de órdenes posteriores. | Proponer reservas: BUY NEW compromete `size × price`; SELL NEW compromete acciones. Separar efectivo contable de disponible y liberar reservas al cancelar, si se incluye cancelación. Alternativa más simple: disponibilidad basada solo en FILLED; requiere aceptación explícita de su efecto. |
| D03 | El ejemplo contiene una venta FILLED que deja una tenencia negativa. Ocultarla o ajustar el seed falsearía los datos y el costo/rendimiento no puede inferirse con seguridad. | Mantener los datos, mostrar la cantidad neta real y definir representación de costo/rendimiento no calculable. Confirmar cómo informar la inconsistencia; no asumir soporte para ventas en corto ni permitir nuevas ventas sin acciones. |
| D04 | No se define precio para convertir monto de una LIMIT, monto en ventas, ambos campos presentes, monto menor que una acción, ni precio recibido en MARKET. | Cantidad y monto mutuamente excluyentes; valores positivos; calcular `floor(monto / precio)` con precio LIMIT o último close para MARKET; cantidad cero inválida. Confirmar si el modo por monto también aplica a SELL y si un precio MARKET se rechaza o ignora. Usar aritmética decimal exacta o unidades mínimas y fijar redondeo/representación monetaria. |
| D05 | Sin autenticación, sigue faltando seleccionar usuario; tampoco hay rutas, payloads ni códigos HTTP definidos. No se aclara persistencia de solicitudes estructuralmente inválidas. | Usuario explícito en ruta o entrada, verificado contra `users`; proponer GET `/users/:userId/portfolio`, GET `/instruments?query=...` y POST `/users/:userId/orders`. Distinguir error de entrada de rechazo de negocio persistido por R07. Aprobar contratos y errores antes de escribir handlers. Son rutas propuestas, no exigidas por la fuente. |
| D06 | «Similares» y «ticker y/o nombre» no fijan coincidencia parcial, mayúsculas, combinación de filtros ni consulta vacía. | Subcadena sin distinguir mayúsculas, buscando ticker O nombre con un solo texto. Definir respuesta para búsqueda vacía y orden estable de resultados; no introducir búsqueda difusa, paginación ni campos extra por defecto. |
| D07 | La consigna menciona datetime de cotización; el SQL tiene date, cotizaciones históricas, instrumentos sin precio y posibles valores nulos. | Usar mayor `marketdata.date` por instrumento; si hay empate, definir desempate por id. ARS vale una unidad monetaria, sin buscar una cotización accionaria. Definir error/representación cuando no haya close válido o previousClose sea cero/nulo. No acudir al mercado real ni alterar el SQL. |
| D08 | Se exige que solo NEW pueda cancelarse, pero el resumen enumera tres capacidades y no describe endpoint de cancelación. Tampoco exige crear transferencias desde la API. | Confirmar si se incluye una operación de cancelación. Si se aprueba, transición NEW → CANCELLED y liberación de reservas según D02; no cancelar FILLED/REJECTED/CANCELLED. Contabilizar transferencias del seed sin añadir una API para crearlas. |

## Tareas futuras y dependencias

La preparación inicial está versionada. La parte técnica de T01 está aprobada y se prepara el arranque de T02; los contratos D01–D08 y las funcionalidades T03–T06 siguen pendientes.

| Tarea | Depende de | Entrega y validación prevista |
| --- | --- | --- |
| T00 — Revisar preparación | Esta documentación | Setup versionado en 57c518e. El usuario solicitó continuar hacia implementación, comenzando por definir el stack; no autorizó nuevos commits ni publicación. |
| T01 — Cerrar contrato y stack | T00 | Stack y arquitectura aprobados; versiones verificadas y fijadas. Resolver D01–D08 o aprobar supuestos antes del comportamiento afectado; vincular resultados esperados con R01–R15. |
| T02 — Base técnica y datos | Stack aprobado de T01 | Bootstrap, dependencias y Dockerfile/Compose preparados. Validar ejecución local y seed sin editar; completar conexión, transacciones y contrato de errores con los adapters, antes de avanzar a sus funcionalidades. |
| T03 — Consultas contables y de mercado | T02; D01–D03, D07 | Cálculo de tenencias, cash/disponibilidad, costo y último precio; validar casos deterministas y tratamiento aprobado del seed inconsistente. Base compartida por portfolio y órdenes. |
| T04 — Portfolio y búsqueda | T03 para portfolio; T02 para búsqueda; D05/D06 | Implementar R01/R02 y contraste con los criterios aprobados; no copiar contratos de otros challenges. La búsqueda puede avanzar sin esperar el cálculo de portfolio. |
| T05 — Envío de órdenes y test funcional | T03; D02/D04/D05/D07 | BUY/SELL, MARKET/LIMIT, cantidad/monto, persistencia de FILLED/NEW/REJECTED y actualización observable. Incluir el test funcional de R14 junto al comportamiento. Proponer casos de insuficiencia, conversión y concurrencia por riesgo, sin inventar cobertura obligatoria. |
| T06 — Cancelación, si se aprueba | T05; D08 | Aplicar R08 a la operación acordada y verificar estados y reservas. Si se excluye el endpoint, dejar documentada la decisión y el límite de la regla. |
| T07 — Validación y documentación de entrega | T04/T05; T06 si aplica | Ejecutar pruebas existentes, contrastar R01–R15 y documentar comandos reales, decisiones y resultados. Añadir O01 solo si se elige. Revisar privacidad y diff; preparar propuesta de commit(s) para autorización. |
| T08 — Publicación y PR futuros | T07; autorizaciones separadas | Confirmar repositorio destino y base main; revisar rama y commits aprobados, publicar solo con permiso explícito y abrir PR solo cuando esté autorizado. No hacer merge por inferencia. |

Los commits futuros se agrupan por tarea coherente y se autorizan individualmente o como conjunto delimitado. La separación de tareas no obliga a fragmentar cambios que necesiten viajar juntos para funcionar.

## Condiciones para comenzar la implementación

1. El usuario autorizó la base técnica, dependencias y Docker local. Esto no implica nuevos permisos de commit, push, PR o merge.
2. El stack está aprobado. Resolver o aprobar supuestos para D01–D08 antes de codificar los comportamientos afectados.
3. Verificar nuevamente trabajo local, rama y remotos. El fork y su historial ya están disponibles; no hay un bloqueo de acceso conocido.
4. Verificar el arranque de los servicios Compose y el seed en PostgreSQL aislado, sin modificar la fuente SQL ni utilizar servicios de producción. La configuración está preparada; registrar por separado su validación y su ejecución real.

## Versionado autorizado y flujo de entrega propuesto

La preparación y la implementación posterior, cuando se autorice, se mantienen en `feature/backend-implementation`, sin crear una rama adicional para la solución. La base sigue siendo el main original conservado en el fork.

El usuario autorizó el commit `docs: prepare backend challenge setup`, realizado como `57c518e` con los diez archivos del setup y sin `.DS_Store`. Esa autorización ya fue utilizada y no habilita otros commits, push, PR ni merge. La solicitud posterior de continuar con la implementación se trata con el alcance definido al inicio de este plan. Las reglas de commits atómicos y autorizaciones independientes permanecen vigentes.

Posteriormente autorizó un único commit de la base técnica preparada: `chore: bootstrap NestJS Express and Docker environment`. Incluye quince archivos de arranque, Docker, dependencias, convenciones, documentación y registro de sesión. Excluye `.env`, `.DS_Store`, dependencias instaladas y archivos compilados. No habilita push, PR, merge ni commits adicionales.

Flujo propuesto: `feature/backend-implementation` local → commits autorizados → publicación autorizada en el fork → PR autorizado hacia `main` del **repositorio confirmado por el usuario**. Hay dos destinos posibles: main del fork o main de `cocoscap/cocos-challenge`. Ninguno fue elegido. Antes de cualquier publicación, confirmar repositorio base, rama base y rama de origen; no asumir que `origin` decide el destino del PR. El usuario mantiene la instrucción de no hacer push.

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

## Revisión del diseño de alto nivel

El usuario autorizó cargar su archivo de Excalidraw en el canvas vacío del MCP y completar el diseño. Se conserva el archivo descargado de la raíz y se guarda el resultado editable en [diseno-alto-nivel.excalidraw](diseno-alto-nivel.excalidraw). Se mantienen las notas originales y el estilo; la entrada HTTP existente se identifica como componente lógico propuesto de una sola API. Se añaden portfolio, búsqueda, envío de órdenes y acceso a datos compartido, con sus conexiones al almacenamiento existente.

Node.js y los estados de órdenes se distinguen como requisitos de la fuente. Express, pg, PostgreSQL y la distribución interna siguen siendo propuestas; no se fijan versiones ni contratos nuevos. Los pendientes D01–D08 permanecen abiertos: el diagrama no decide fórmulas de rendimiento, reservas, tratamiento de tenencias negativas, conversión por monto, contratos, coincidencia, cotizaciones ausentes ni exposición de cancelación. Las anotaciones anteriores de contratos y RNF se conservan como borrador, sin ratificar sus propuestas.

Esta revisión solo modifica el artefacto de diseño, este registro de decisiones y el registro de sesión. No autoriza implementación, commits ni publicación del repositorio. Validación: inspección visual del canvas, revisión de conexiones y tipografía, comprobación del JSON nativo y preservación de las notas y archivos originales. Se comprueban enlaces locales, espacios e índice; no se ejecutan pruebas de aplicación.
