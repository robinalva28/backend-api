# Requisitos y aceptación

Fuente funcional: [consigna backend](../backend-challenge.md), contrastada con [database.sql](../database.sql), leídos completos. Referencia remota revisada: [consigna](https://github.com/cocoscap/cocos-challenge/blob/abae77016b4e07e97161a9567239dcde5c0c00e1/backend-challenge.md) y [SQL](https://github.com/cocoscap/cocos-challenge/blob/abae77016b4e07e97161a9567239dcde5c0c00e1/database.sql), commit `abae77016b4e07e97161a9567239dcde5c0c00e1` de `main` del original. La consigna se interpreta por sus secciones Resumen, Consideraciones funcionales, Consideraciones técnicas y Base de datos.

Los criterios siguientes son verificaciones futuras; todavía no existen endpoints ni pruebas. Las ambigüedades referidas como D se detallan en el [plan](plan.md).

## Obligatorios de la consigna

| ID | Requisito y sección de origen | Criterio de aceptación verificable |
| --- | --- | --- |
| R01 | Portfolio: valor total de cuenta, pesos disponibles y activos con cantidad, valor monetario y rendimiento total porcentual. Resumen. | Consultar una cuenta con movimientos conocidos y contrastar todos esos campos con cálculos independientes; fórmulas y datos inconsistentes dependen de D01–D03. |
| R02 | Buscar activos por ticker y/o nombre, devolviendo coincidencias similares. Resumen. | Una búsqueda por ticker encuentra el activo; otra por nombre también. Definir coincidencia y combinación en D06 antes de fijar ejemplos esperados. |
| R03 | Enviar compras `BUY` y ventas `SELL`, de tipo `MARKET` o `LIMIT`, y persistir estado y valores en `orders`. Resumen y funcionales. | Verificar cada combinación válida en la respuesta y en la fila persistida; contrato HTTP pendiente en D05. |
| R04 | Aceptar cantidad exacta o monto en pesos, calculando el máximo de acciones enteras; sin fracciones. Funcionales. | Con precio de referencia de 300 y monto de 1.000, obtener 3 acciones; con cantidad exacta, conservarla. Precio de conversión, campos incompatibles y alcance sobre ventas pendientes en D04. |
| R05 | Precios expresados en pesos; `MARKET` no requiere precio y usa el último `close`. Funcionales. | Una orden MARKET sin precio usa la cotización más reciente de su instrumento. Verificar selección temporal con los dos días del SQL; tratamiento de precio recibido y cotizaciones ausentes pendiente en D04/D07. |
| R06 | `MARKET` se ejecuta inmediatamente como `FILLED`; `LIMIT` requiere precio y queda `NEW`, salvo rechazo. Funcionales y Resumen. | Con recursos suficientes: MARKET persistida como FILLED y LIMIT como NEW con su precio. No introducir ejecución diferida ni simulación de mercado. |
| R07 | Insuficiencia de pesos al comprar o acciones al vender: rechazar y guardar `REJECTED`. Funcionales. | Provocar ambos casos y comprobar persistencia del rechazo y ausencia de cambios en efectivo/tenencia ejecutados. Recursos comprometidos por NEW pendientes en D02. |
| R08 | Estados `NEW`, `FILLED`, `REJECTED`, `CANCELLED`; solo cancelar órdenes `NEW`. Funcionales. | Si se expone cancelación, NEW puede pasar a CANCELLED y los demás estados no. La regla es obligatoria; el mecanismo público y su inclusión se resuelven en D08. |
| R09 | Derivar tenencia y efectivo de movimientos pertinentes de `orders`, usando `size`; posiciones calculadas con órdenes `FILLED`. Funcionales. | BUY FILLED suma acciones, SELL FILLED resta; órdenes rechazadas/canceladas no representan ejecuciones. Considerar CASH_IN/CASH_OUT existentes para efectivo. Política de reservas NEW pendiente en D02. |
| R10 | Cash ARS es un instrumento de tipo `MONEDA`; las transferencias se representan en el ejemplo con `CASH_IN` y `CASH_OUT`. Funcionales y SQL. | Reconocer ARS como efectivo y contabilizar los movimientos de ejemplo usando `size`, sin contarlo otra vez como una posición accionaria. No se exige una API de transferencias. |
| R11 | Actualizar las posiciones al ejecutarse una orden. Funcionales. | Después de una MARKET FILLED, consultar portfolio y comprobar que incorpora la operación persistida. La consigna no obliga a crear una tabla de posiciones. |
| R12 | Usar `close` y `previousClose` para retorno diario; usar operaciones `FILLED` para valor, rendimiento y cantidad de cada posición. Funcionales. | Contrastar retorno diario con ambas columnas y rendimiento total con el criterio aprobado en D01. Definir división por cero y costo base ausente; no confundir ambos rendimientos. |
| R13 | API REST en Node.js con framework a elección y estrategia de acceso a datos elegida. Técnicas. | La implementación futura usa Node.js y documenta framework y acceso a datos; Express, NestJS y ORM son alternativas, no tecnologías impuestas. |
| R14 | Implementar un test funcional sobre la función de envío de orden. Técnicas. | Ejecutar al menos un test funcional que recorra el envío y compruebe el resultado; alcance concreto y casos adicionales propuestos en el plan. |
| R15 | Documentar supuestos y decisiones de diseño relevantes; justificar cambios de base si los hubiera. Técnicas y Base de datos. | Las decisiones implementadas y sus consecuencias aparecen en documentación. En esta etapa el SQL permanece idéntico al original por instrucción del usuario. |

## Opcionales, libertades y límites

- **O01, único nice to have explícito:** colección de Postman, Insomnia o REST Client y ejemplos de invocación. Aceptación si se elige: ejemplos utilizables que correspondan al contrato real. No está aprobada ni creada.
- **Libertad de modelado:** la consigna permite modelar transferencias como órdenes y modificar tablas con justificación. Esto no exige endpoints de transferencias ni cambios de esquema. El SQL ya contiene movimientos de efectivo que deben interpretarse.
- **No requerido:** autenticación ni simulación de mercado. Se excluyen de la propuesta inicial; no son funcionalidades por construir para completar este challenge.
- **No especificado:** rutas exactas, forma de seleccionar usuario, contratos y códigos HTTP, cancelación como endpoint, motor de base, TypeScript, ORM concreto, cobertura mínima porcentual, Docker, CI o despliegue. Cualquier incorporación requiere justificación; no se toma de los otros challenges.
- **Restricción de esta etapa:** solo preparación documental. No implementar ni ejecutar pruebas de aplicación, instalar dependencias, generar scaffold/configuraciones de aplicación, modificar SQL, hacer commits, push, PR o merges.

## Observaciones verificadas del SQL

Inspección estática; no se creó ni cargó una base de datos.

- Contiene cuatro tablas: `users`, `instruments`, `orders`, `marketdata`; 4 usuarios, 66 instrumentos (65 acciones y ARS), 126 cotizaciones y 11 órdenes.
- Las cotizaciones corresponden a dos fechas históricas y cubren 63 acciones por fecha. No hay cotizaciones para dos acciones ni para ARS. «Último» debe resolverse desde los datos disponibles, sin introducir precios externos.
- `marketdata` tiene `date DATE`; la consigna enumera `datetime`. `orders` sí tiene `datetime TIMESTAMP`. La selección de cotización debe respetar la columna real; ver D07.
- Los identificadores camelCase del DDL están sin comillas. En PostgreSQL se normalizan a minúsculas; el acceso a datos deberá mapearlos sin renombrar el archivo. Véase la [documentación de identificadores de PostgreSQL](https://www.postgresql.org/docs/current/sql-syntax-lexical.html).
- `size` es entero y `price`/cotizaciones son `NUMERIC(10, 2)`. Algunos literales de cotización tienen más decimales: debe respetarse la escala efectiva al importar. Hay campos de cotización nulos y no hay tabla separada de saldos o posiciones.
- Como comprobación aritmética del ejemplo, contando solo ejecuciones: una cuenta tiene 40, −10 y 500 acciones en los instrumentos 47, 31 y 54; el efectivo sería 753.000 ARS sin reservas. Son resultados de lectura del SQL, **no respuestas verificadas de una aplicación**. La cantidad negativa y la disponibilidad frente a órdenes NEW requieren D02/D03.
- El árbol original revisado solo contiene la consigna, SQL y cuatro Markdown de otros challenges. No contiene archivo de licencia independiente. Se conservan todos los archivos originales y cualquier atribución incluida; no se presupone una licencia nueva.

Los otros Markdown se conservan por instrucción posterior del usuario. Sus contratos, estados y restricciones tecnológicas no se trasladan al backend.
