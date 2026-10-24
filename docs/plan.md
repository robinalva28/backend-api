# Plan y decisiones de preimplementación

Este documento prepara la revisión. Las propuestas no representan decisiones aprobadas ni autorizan implementación. Los requisitos y sus criterios están en [requisitos.md](requisitos.md); las reglas de autorización y sesiones, en [AGENTS.md](../AGENTS.md).

## Etapa vigente y restricciones

La etapa vigente es preparación y revisión documental. La gestión de ramas tampoco autoriza implementar. La autorización explícita para implementar sigue pendiente y es independiente de las autorizaciones de commit, push, PR y merge, según AGENTS.md.

En esta etapa no crear endpoints, lógica de negocio, pruebas, scaffold, dependencias, `package.json`, lockfiles, infraestructura ni pipelines. No modificar el esquema ni los datos de `database.sql`. Solo está autorizado el commit de setup descrito en la sección de versionado; no hacer push, PR ni merges. Mantener intactos los otros Markdown y preservar cualquier trabajo existente.

## Estado verificado y decisiones confirmadas

- El directorio inicial estaba vacío, sin instrucciones locales existentes ni repositorio Git propio o padre. No había trabajo previo que trasladar.
- Se verificó una única cuenta activa de GitHub y ausencia de un fork adecuado o conflicto de nombre. Se creó el [fork](https://github.com/robinalva28/cocos-challenge), cuyo padre y origen de red son el [repositorio original](https://github.com/cocoscap/cocos-challenge).
- El usuario retiró la restricción sobre inicializar Git después de consultar la diferencia entre inicializar y clonar. Se usó **clonación con el historial original**; no se ejecutó `git init` ni se creó historia independiente.
- `origin` apunta al fork y `upstream` al original. El HEAD local, `origin/main` y el `main` remoto del original se verificaron en `abae77016b4e07e97161a9567239dcde5c0c00e1`. Se creó la rama local `chore/backend-preparation` para preparar documentación.
- Por indicación del usuario, esa rama se renombró a `feature/backend-implementation`, única rama local de trabajo. Se eliminó la referencia local `main` después de verificar que apuntaba al mismo commit; se conservan el historial original, los archivos pendientes y `origin/main`. No se modificaron ramas remotas ni se hizo push.
- El usuario reemplazó la limpieza inicial por la instrucción de conservar los otros `.md` tal cual. No se elimina ningún archivo. Permanecen frontend, fullstack, QA y React Native, sin tratarlos como fuentes del backend.

## Alternativas técnicas propuestas

Evaluación de complejidad para tres capacidades REST y cuatro tablas; no se hicieron benchmarks ni se instalaron paquetes. Las valoraciones de conveniencia son criterio de ingeniería, no requisitos de Cocos.

| Área | Alternativas y costo | Recomendación pendiente de aprobación |
| --- | --- | --- |
| Framework | [Express](https://expressjs.com/) ofrece una capa pequeña de routing/middleware y exige definir validación, errores y separación de responsabilidades. [NestJS](https://docs.nestjs.com/) aporta estructura, módulos e inyección de dependencias, con más convenciones y código inicial. | Express: handlers delgados, funciones de dominio y acceso a datos separado. NestJS es razonable si su estructura ya resulta familiar, pero no se necesita su complejidad para este alcance. |
| Lenguaje | JavaScript satisface Node.js sin compilación adicional. TypeScript añade contratos estáticos y configuración; no sustituye validación de entradas. | TypeScript por los contratos de órdenes y resultados; es una propuesta, no una exigencia de la consigna backend. Elegir versión soportada de Node y compatibilidad de herramientas al comenzar, sin fijar versiones por memoria. |
| Base y acceso | PostgreSQL con [node-postgres (`pg`)](https://node-postgres.com/features/queries) permite SQL parametrizado, agregados y control explícito de transacciones sobre el esquema existente. [Prisma](https://www.prisma.io/docs/orm/overview/introduction/what-is-prisma) ofrece cliente generado y tipado, a cambio de modelado/mapeo y generación adicionales; las consultas contables y bloqueos siguen requiriendo diseño. | PostgreSQL + `pg`: menor trabajo de adaptación para estas cuatro tablas y consultas contables. El motor no está impuesto por nombre, pero esta elección encaja con el DDL provisto. No proponer cambios de tablas sin una necesidad demostrada. |
| Pruebas | [`node:test`](https://nodejs.org/api/test.html) evita otro runner; [Vitest](https://vitest.dev/guide/) añade herramientas de ejecución y una dependencia. [Supertest](https://github.com/forwardemail/supertest) permite verificar HTTP con cualquiera de los dos. | `node:test` + Supertest y una base PostgreSQL aislada para el test funcional de órdenes. Si se elige TypeScript, compilar también los tests para usar el runner; Vitest es alternativa si se prioriza su flujo con TypeScript. Resolver herramientas conjuntamente en T01. |

Propuesta de diseño: calcular portfolio desde órdenes, sin una tabla adicional de posiciones. En el envío, realizar lectura de recursos, validación y persistencia dentro de una transacción usando el mismo cliente de `pg`; un rechazo por recursos se guarda y confirma como resultado de negocio, no se pierde por un rollback genérico. Para evitar que dos órdenes gasten los mismos recursos, evaluar bloqueo de la fila de usuario durante esa transacción. Es una protección propuesta para R07, no un requisito independiente de la consigna. Referencias: [transacciones de pg](https://node-postgres.com/features/transactions) y [bloqueos de PostgreSQL](https://www.postgresql.org/docs/current/explicit-locking.html).

No se propone un servicio externo de mercado, microservicios, caché ni infraestructura adicional. En esta etapa tampoco se crean archivos de configuración. No hacen falta otros documentos o plantillas: este plan y la matriz de requisitos cubren la revisión.

## Documentación técnica pendiente

Cuando se autorice la implementación, incorporar progresivamente el stack aprobado y sus versiones, las convenciones de código adoptadas y los comandos reales. No tratarlos como definidos por esta preparación:

- `AGENTS.md`: stack y convenciones de estructura, nombres, acceso a datos y pruebas que efectivamente se adopten en T01/T02; sin anticipar configuraciones inexistentes.
- `README.md`: comandos de instalación, ejecución, preparación de datos y verificaciones solo cuando existan y se hayan comprobado, indicando requisitos y resultados reales.

Hasta entonces, las alternativas técnicas permanecen como propuestas de este plan y no se agregan instrucciones operativas de aplicación.

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

Todas son planificación: ninguna tarea de aplicación se ejecuta en esta etapa.

| Tarea | Depende de | Entrega y validación prevista |
| --- | --- | --- |
| T00 — Revisar preparación | Esta documentación | Revisar requisitos, propuestas y límites. Autorizar explícitamente pasar a implementación; el permiso no incluye commits ni publicación. |
| T01 — Cerrar contrato y stack | T00 | Resolver D01–D08 o aprobar supuestos concretos; elegir framework, lenguaje, acceso, runner y versiones compatibles. Vincular resultados esperados con R01–R15. |
| T02 — Base técnica y datos | T01 | Solo en la etapa autorizada: configurar el mínimo de aplicación, conexión y base aislada. Importar el SQL original sin editarlo y verificar nombres, escala y lectura. Definir transacciones y contrato de errores. |
| T03 — Consultas contables y de mercado | T02; D01–D03, D07 | Cálculo de tenencias, cash/disponibilidad, costo y último precio; validar casos deterministas y tratamiento aprobado del seed inconsistente. Base compartida por portfolio y órdenes. |
| T04 — Portfolio y búsqueda | T03 para portfolio; T02 para búsqueda; D05/D06 | Implementar R01/R02 y contraste con los criterios aprobados; no copiar contratos de otros challenges. La búsqueda puede avanzar sin esperar el cálculo de portfolio. |
| T05 — Envío de órdenes y test funcional | T03; D02/D04/D05/D07 | BUY/SELL, MARKET/LIMIT, cantidad/monto, persistencia de FILLED/NEW/REJECTED y actualización observable. Incluir el test funcional de R14 junto al comportamiento. Proponer casos de insuficiencia, conversión y concurrencia por riesgo, sin inventar cobertura obligatoria. |
| T06 — Cancelación, si se aprueba | T05; D08 | Aplicar R08 a la operación acordada y verificar estados y reservas. Si se excluye el endpoint, dejar documentada la decisión y el límite de la regla. |
| T07 — Validación y documentación de entrega | T04/T05; T06 si aplica | Ejecutar pruebas existentes, contrastar R01–R15 y documentar comandos reales, decisiones y resultados. Añadir O01 solo si se elige. Revisar privacidad y diff; preparar propuesta de commit(s) para autorización. |
| T08 — Publicación y PR futuros | T07; autorizaciones separadas | Confirmar repositorio destino y base main; revisar rama y commits aprobados, publicar solo con permiso explícito y abrir PR solo cuando esté autorizado. No hacer merge por inferencia. |

Los commits futuros se agrupan por tarea coherente y se autorizan individualmente o como conjunto delimitado. La separación de tareas no obliga a fragmentar cambios que necesiten viajar juntos para funcionar.

## Condiciones para comenzar la implementación

1. Revisión de esta etapa y autorización explícita para implementar; todavía pendiente y sin implicar permisos de commit, push, PR o merge.
2. Acordar stack y herramientas de T01; resolver o aprobar supuestos para D01–D08 antes de codificar los comportamientos afectados.
3. Verificar nuevamente trabajo local, rama y remotos. El fork y su historial ya están disponibles; no hay un bloqueo de acceso conocido.
4. Disponer de un entorno PostgreSQL aislado si se aprueba esa propuesta, sin modificar la fuente SQL ni usar servicios de producción. No se preparó infraestructura en esta etapa.

## Versionado autorizado y flujo de entrega propuesto

La preparación y la implementación posterior, cuando se autorice, se mantienen en `feature/backend-implementation`, sin crear una rama adicional para la solución. La base sigue siendo el main original conservado en el fork.

El usuario autorizó expresamente un único commit con los diez archivos de documentación, diseño y registros del setup, excluyendo `.DS_Store`, con mensaje `docs: prepare backend challenge setup`. La autorización incluye el registro de esta aprobación y el estado del plan; no habilita otros commits, implementación, push, PR ni merge. Las reglas de commits atómicos y autorizaciones independientes permanecen vigentes.

Flujo propuesto: `feature/backend-implementation` local → commits autorizados → publicación autorizada en el fork → PR autorizado hacia `main` del **repositorio confirmado por el usuario**. Hay dos destinos posibles: main del fork o main de `cocoscap/cocos-challenge`. Ninguno fue elegido. Antes de cualquier publicación, confirmar repositorio base, rama base y rama de origen; no asumir que `origin` decide el destino del PR. El usuario mantiene la instrucción de no hacer push.

## Criterios de finalización de esta etapa

- Estado del fork, copia local e historial verificado o bloqueo concreto documentado; fuentes originales y Markdown de otros challenges conservados intactos.
- Documentación lista para revisión: requisitos verificables, plan con dependencias, decisiones confirmadas separadas de propuestas, dudas y condiciones de inicio; documentación técnica futura identificada como pendiente.
- Reglas permanentes en AGENTS.md y registro de esta conversación actualizado y ofuscado; etapa e historia del repositorio concentradas en este plan.
- Validación documental de AGENTS.md completada, diferencias y resultados presentados; ninguna implementación ni operación prohibida realizada. Las dudas funcionales explícitas no impiden cerrar la preparación, pero deben resolverse o aprobarse como supuestos antes del comportamiento afectado.

## Resultados de validación

Validación inicial de preparación:

Resultado: seis archivos originales idénticos byte por byte al commit de referencia, incluidos SQL y todos los Markdown de otros challenges; cinco documentos nuevos y 16 enlaces locales válidos en todos los Markdown. Los documentos nuevos no tienen espacios finales y terminan con salto de línea. Registro revisado para ofuscar información personal; comprobación adicional sin cuenta identificable, rutas personales, correos ni patrones de credenciales.

HEAD permanece en el commit original; rama `chore/backend-preparation`, índice vacío, cinco archivos nuevos sin seguimiento y ningún cambio en archivos versionados. Fork, padre, origen de red, main y remotos verificados; sin repositorios anidados ni commits nuevos. No se crearon archivos de aplicación, pruebas, dependencias, infraestructura o pipelines, ni se hicieron push, PR o merges. Se revisaron únicamente documentos y Git: no se ejecutó SQL ni se realizaron pruebas de aplicación.

Revisión de reglas permanentes: etapa e historia concentradas en este plan; autorizaciones independientes y criterios documentales definidos en AGENTS.md; stack, convenciones y comandos reales pendientes de la etapa autorizada. Se contrastó la coherencia con requisitos y README, sin cambiar esos archivos. `git diff --check` y su variante para el índice, sin errores; revisión adicional con `--no-index --check` de los cinco documentos sin seguimiento, sin diagnósticos de espacios. Enlaces locales y privacidad del registro comprobados. La comparación con el inicio de esta corrección limita los cambios a AGENTS.md, este plan y el registro de sesión; el resto de los archivos, HEAD e índice permanecen intactos.

## Revisión del diseño de alto nivel

El usuario autorizó cargar su archivo de Excalidraw en el canvas vacío del MCP y completar el diseño. Se conserva el archivo descargado de la raíz y se guarda el resultado editable en [diseno-alto-nivel.excalidraw](diseno-alto-nivel.excalidraw). Se mantienen las notas originales y el estilo; la entrada HTTP existente se identifica como componente lógico propuesto de una sola API. Se añaden portfolio, búsqueda, envío de órdenes y acceso a datos compartido, con sus conexiones al almacenamiento existente.

Node.js y los estados de órdenes se distinguen como requisitos de la fuente. Express, pg, PostgreSQL y la distribución interna siguen siendo propuestas; no se fijan versiones ni contratos nuevos. Los pendientes D01–D08 permanecen abiertos: el diagrama no decide fórmulas de rendimiento, reservas, tratamiento de tenencias negativas, conversión por monto, contratos, coincidencia, cotizaciones ausentes ni exposición de cancelación. Las anotaciones anteriores de contratos y RNF se conservan como borrador, sin ratificar sus propuestas.

Esta revisión solo modifica el artefacto de diseño, este registro de decisiones y el registro de sesión. No autoriza implementación, commits ni publicación del repositorio. Validación: inspección visual del canvas, revisión de conexiones y tipografía, comprobación del JSON nativo y preservación de las notas y archivos originales. Se comprueban enlaces locales, espacios e índice; no se ejecutan pruebas de aplicación.
