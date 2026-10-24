# Reglas de trabajo

## Objetivo y fuentes

Resolver el challenge backend de Cocos dentro del alcance autorizado por el usuario.

Fuentes: [repositorio original](https://github.com/cocoscap/cocos-challenge), [consigna backend](backend-challenge.md), [datos y esquema originales](database.sql) y [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/). El análisis está en [requisitos](docs/requisitos.md). La etapa vigente, sus restricciones temporales, el estado e historia del repositorio, las decisiones y los pendientes se mantienen en el [plan](docs/plan.md).

La consigna backend define el alcance funcional; los otros challenges no aportan requisitos a este trabajo. Ante diferencias entre la consigna y el SQL, documentarlas y resolverlas explícitamente.

## Preservación y decisiones

- Antes de modificar archivos, inspeccionar instrucciones aplicables, estado Git, diferencias e índice. Identificar cambios ajenos y conservarlos.
- Mantener cambios pequeños y vinculados con la tarea. No sobrescribir trabajo previo, descartar cambios, reescribir historia ni generar repositorios anidados.
- Conservar consigna, SQL, licencias y atribuciones existentes. No añadir licencias por suposición ni eliminar los otros Markdown.
- Documentar decisiones relevantes, supuestos y consecuencias en `docs/plan.md`; mantener separados los requisitos de la fuente, las decisiones confirmadas, las propuestas y las dudas.
- Preguntar cuando una ambigüedad afecte alcance, datos existentes o acciones remotas. Resolver autónomamente detalles menores y reversibles.
- Validar lo efectivamente modificado y comunicar limitaciones. No presentar inspecciones documentales como pruebas de aplicación.

## Autorizaciones independientes

- Obtener autorización explícita del usuario para comenzar la implementación, con un alcance identificable, antes de crear o modificar código, pruebas, scaffold, dependencias o configuración de la aplicación. La revisión o aprobación de documentos y propuestas técnicas no concede ese permiso.
- Las autorizaciones para implementar, hacer commit, push, abrir PR y hacer merge son independientes: ninguna concede las demás. Respetar el alcance de cada autorización y las restricciones vigentes del plan.

## Commits y publicación

- Usar [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/): `tipo(alcance opcional): descripción`. Usar `feat` para funcionalidades y `fix` para correcciones; `docs`, `test` y `chore` son tipos permitidos según el cambio. Marcar incompatibilidades con `!` o el pie `BREAKING CHANGE` cuando corresponda.
- Cada commit debe ser atómico: una tarea o un cambio coherente, con su documentación y validación pertinentes. No mezclar cambios ajenos.
- Obtener autorización explícita del usuario antes de **cada commit**, salvo autorización expresa para un conjunto concreto y delimitado.
- Antes de solicitarla, presentar el cambio ya preparado: archivos y diferencias relevantes, validación ejecutada y resultados, limitaciones y mensaje de commit propuesto. Revisar también que el índice incluya únicamente lo aprobado.
- Antes de publicar, confirmar el repositorio y la rama destino: `main` del fork y `main` del original son destinos diferentes. Mantener el flujo de entrega y el destino confirmado en el plan.

## Finalización y validación documental

- Considerar terminada una tarea documental solo cuando cubra el alcance autorizado y los criterios de su etapa definidos en el plan, sin pendientes que se presenten como resueltos ni propuestas como decisiones aprobadas.
- Comprobar que los enlaces locales resuelvan a archivos existentes y que las anclas utilizadas existan. Revisar coherencia entre instrucciones, plan, requisitos y README: fuentes, restricciones, autorizaciones, decisiones y estado deben coincidir, sin duplicar información útil.
- Ejecutar `git diff --check` y revisar las diferencias e índice. Para archivos sin seguimiento, comprobar también su contenido con `git diff --no-index --check -- /dev/null <archivo>`: el primer comando no los incluye. Verificar que no se modificó ni eliminó trabajo ajeno.
- Actualizar el registro con la revisión de privacidad indicada abajo. Al entregar, mostrar las diferencias y la validación realmente realizada, junto con pendientes y limitaciones; no afirmar que se ejecutaron pruebas de aplicación por haber validado documentos.

## Registro de sesiones y privacidad

- Mantener un Markdown independiente por conversación o sesión en `ailogs/`, con nombre `YYYY-MM-DD-HHMM-tema.md` y hora de `America/Argentina/Buenos_Aires`. Reutilizar el mismo archivo durante esa sesión; no crear uno por turno.
- Registrar únicamente prompts del usuario, respuestas del agente y decisiones breves. Identificar como **resumen** toda condensación de contenido extenso. Usar la menor verbosidad que conserve restricciones, autorizaciones y decisiones.
- Registrar solo el historial disponible. No inventar sesiones previas, incluir razonamiento interno, secretos ni volcados de herramientas.
- **Antes de cada escritura o actualización**, revisar y ofuscar información personal del usuario y terceros, incluso nombres, cuentas, correos, teléfonos, domicilios, documentos, identificadores, rutas y datos que permitan identificar indirectamente a una persona. Aplicar la regla también a títulos y nombres de archivo.
- Usar marcadores consistentes, por ejemplo `[PERSONA_1]`, `[RUTA_1]`, `[EMAIL_1]` o `[CUENTA_1]`. Omitir datos personales innecesarios. No guardar originales ni tablas de equivalencias. No copiar datos personales del SQL a los registros.
- Actualizar el registro durante la sesión y **antes de cerrar cada turno**. Revisar nuevamente la ofuscación del archivo resultante antes de guardarlo.
