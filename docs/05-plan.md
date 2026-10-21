# E. Plan de implementación

Hitos chicos y en orden. Ninguno se da por terminado sin sus pruebas en verde.

## Hito 0: comprobar los supuestos (antes de escribir el producto)

- **Objetivo**: confirmar lo marcado "Por verificar" en C.
- **Tareas**: crear una GitHub App de prueba con los permisos mínimos; en un repo de prueba,
  llamar al endpoint de reglas por rama y a la protección clásica, y anotar qué permiso pide
  cada uno; guardar como fixtures las respuestas de `check_run`, `workflow_run` y revisiones.
- **Hecho cuando**: hay una nota en `docs/adr/001-permisos.md` con los permisos reales y los
  fixtures están en `test/fixtures/`.
- **Riesgo**: si leer reglas exige administración, F2 pasa a ser opcional.

## Hito 1: el evaluador puro

- **Archivos**: `src/evaluator/*`, `test/evaluator/*`.
- **Tareas**: tipos del dominio; reglas del veredicto en el orden de C; frescura; textos.
- **Pruebas**: una por regla de la tabla de semántica, más los casos adversos (SHA viejo,
  app equivocada, evidencia faltante).
- **Hecho cuando**: todas las reglas tienen una prueba que falla si se borra la regla.

## Hito 2: leer GitHub

- **Archivos**: `src/github/requirements.ts`, `evidence.ts`, `app.ts`.
- **Tareas**: traducir las respuestas de la API (fixtures del hito 0) a `Requirement` y
  `Evidence`; manejo de paginación, límites y errores → `unknown`.
- **Hecho cuando**: con los fixtures, el evaluador produce el veredicto esperado de cada caso.

## Hito 3: webhooks y cola

- **Archivos**: `src/webhook/receiver.ts`, `src/jobs/*`, `src/db.ts`, `migrations/001.sql`.
- **Pruebas**: firma inválida, entrega repetida, desorden, proceso muerto a mitad de un job.
- **Hecho cuando**: las cuatro pruebas pasan sin red, con una base temporal.

## Hito 4: publicar el check (primer MVP usable)

- **Archivos**: `src/github/checkRun.ts`, `src/main.ts`, `Dockerfile`.
- **Tareas**: un check por `head`, actualizado en el lugar; resumen con veredicto, lista de
  requisitos, frescura, actor y links.
- **Hecho cuando**: instalado en un repo de prueba, diez PR armados a mano (verde, rojo,
  borrador, conflicto, check viejo, revisión pendiente...) muestran el veredicto correcto, y
  ninguno tiene dos checks.

## Hito 5: Discord opcional

- **Archivos**: `src/discord/*`.
- **Tareas**: `/protocol status`; aviso cuando el veredicto cambia; tabla `notifications`.
- **Hecho cuando**: dos eventos sin cambio de veredicto no generan mensaje, y sin
  `DISCORD_TOKEN` el resto anda igual.

## Hito 6: proyecto abierto

- README con capturas reales, CONTRIBUTING, SECURITY, plantillas, CI, primera versión 0.1.0.

## Qué valida el MVP

El hito 4 alcanza para la pregunta central: **¿a quien mantiene un repo le sirve ver el estado
explicado y la frescura, o la caja de fusión de GitHub ya le alcanza?** Si no le sirve, se para
ahí y no se construye Discord ni lo demás.
