# B. Especificación del producto

## Visión

Que nadie tenga que adivinar por qué un PR no se puede fusionar.

## Qué NO es (no objetivos)

- No exige ni bloquea fusiones por su cuenta. GitHub es la autoridad.
- No fusiona ni actualiza ramas.
- No ejecuta código del repositorio ni del PR.
- No soporta GitLab ni Bitbucket en la primera versión.
- No usa IA para decidir nada. La IA queda fuera del MVP.
- No guarda el código fuente.
- No recolecta datos de uso ni pide cuenta propia.

## Recorridos principales

1. **Autor del PR**: abre un PR, ve el check "PRotocol / readiness" y su resumen dice qué
   falta, por qué y qué hacer, con links a cada check y revisión.
2. **Mantenedor**: escribe `/protocol status` en Discord (o mira el resumen diario) y ve qué
   PR están listos, cuáles esperan revisión de quién y cuáles esperan al autor.
3. **Quien lo instala**: instala la GitHub App en un repo, sin escribir configuración, y el
   check aparece en el próximo evento.

## Requisitos funcionales (MVP)

| ID | Requisito |
|---|---|
| F1 | Recibir webhooks de GitHub (`pull_request`, `pull_request_review`, `check_run`, `check_suite`, `status`, `workflow_run`, `push` a la base) y verificar su firma. |
| F2 | Leer los requisitos efectivos de la rama base: checks requeridos, revisiones requeridas, CODEOWNERS y aprobación del último push. |
| F3 | Leer el estado actual del PR: commit `head`, base, borrador, conflictos, checks, estados y revisiones. |
| F4 | Calcular un veredicto: `ready`, `blocked`, `pending` o `unknown`. Nunca `ready` con evidencia faltante. |
| F5 | Clasificar cada requisito: cumplido, pendiente, fallido, viejo (otro commit) o de base desconocida, con la evidencia que lo respalda. |
| F6 | Decir quién debe actuar en cada requisito: autor, un revisor o equipo, o CI. |
| F7 | Publicar o actualizar **un** check run de solo lectura por commit `head`, nunca duplicado. |
| F8 | Ignorar eventos repetidos y descartar evaluaciones de un commit que ya no es el `head`. |
| F9 | (Opcional) Discord: `/protocol status <repo>` y un aviso cuando un PR pasa a `ready` o a `blocked`. |
| F10 | Archivo opcional `.github/protocol.yml`, leído **de la rama base**, para ajustar avisos y textos; nunca para aflojar lo que GitHub exige. |

## Requisitos no funcionales

- **Corrección antes que velocidad**: ante la duda, `unknown` y la razón.
- **Mínimos permisos** (ver C, Seguridad).
- **Liviano**: un solo proceso y una base SQLite, corre en una PC o una VM gratuita.
- **Sin costo obligatorio**: ningún servicio pago.
- **Observable**: registros estructurados con el ID de entrega del webhook.

## Alcance del MVP

F1 a F8 en un repo. F9 y F10 en el segundo hito. Fuera: tablero web, IA, riesgo, otros
proveedores, adaptadores externos.

## Hoja de ruta posterior (solo si el MVP se usa)

1. Tablero web de solo lectura con la vista del mantenedor.
2. Indicadores de riesgo **explicados** (rutas sensibles, migraciones, dependencias), como
   aviso y nunca como bloqueo.
3. Resumen con IA opcional y local, marcado como hipótesis, con la evidencia citada.
4. Más proveedores de checks externos.

## Métricas de éxito

Se miden en repos reales, con permiso de sus dueños:

- **Veredictos incorrectos**: PR marcados `ready` que GitHub no deja fusionar, y al revés.
  Meta: cero errores del tipo `ready` incorrecto en la muestra revisada a mano.
- **Duplicados**: más de un check o un mensaje de Discord por el mismo cambio. Meta: cero.
- **Utilidad**: cuántos mantenedores lo dejan instalado después de un mes. No hay meta
  numérica hasta tener una primera medición.
- **Latencia** desde el evento hasta el check actualizado: se fija la meta después de medir
  con una carga definida (ver plan de pruebas en C).
