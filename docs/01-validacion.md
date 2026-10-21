# A. Informe de validación

Fecha de la investigación: 21/10/2026. Cada dato sobre otro proyecto lleva su fuente. Lo que
es interpretación propia está marcado como **Interpretación**; lo que todavía hay que
comprobar, como **Por verificar**.

## 1. El problema

En un repositorio con ramas protegidas, quien abre un pull request (PR) quiere saber tres
cosas: si puede fusionarse, qué falta y quién tiene que actuar. Quien lo mantiene quiere lo
mismo para todos los PR abiertos a la vez. Las reglas viven en varios lugares (reglas de
GitHub, checks de CI, revisiones, CODEOWNERS) y el estado cambia con cada commit, con cada
cambio en la rama base y con cada re-ejecución de CI.

## 2. Usuarios y casos de uso

| Usuario | Caso |
|---|---|
| Quien aporta a un proyecto abierto | "¿Por qué mi PR no se puede fusionar y qué hago?" |
| Quien mantiene un proyecto chico | "¿Qué PR están listos, cuáles esperan a alguien y a quién?" |
| Un equipo chico autoalojado | Reglas propias de aprobación por rutas, sin pagar un servicio |

## 3. Qué existe hoy (verificado)

Estado consultado en la API pública de GitHub el 21/10/2026 (`archived`, licencia, último
commit y última versión publicada).

| Proyecto | Qué hace | Licencia | Estado | Fuente |
|---|---|---|---|---|
| **GitHub rulesets y protección de ramas** | Checks requeridos, revisiones requeridas, CODEOWNERS, descartar aprobaciones viejas, exigir aprobación del último push, exigir rama al día | Nativo | Rulesets disponibles en repos públicos con GitHub Free; en privados desde Pro/Team | [docs: about rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets) |
| **GitHub merge queue** | Prueba cada PR contra la base actualizada antes de fusionar | Nativo | Repos públicos de organizaciones y privados con Enterprise Cloud (anuncio de 2023, **Por verificar** si cambió) | [changelog 2023](https://github.blog/changelog/2023-07-12-pull-request-merge-queue-is-now-generally-available/) |
| **policy-bot** (Palantir) | GitHub App autoalojable: políticas de aprobación por archivos, autores, equipos; lee la política de la rama destino; invalida aprobaciones al hacer push; falla cerrado si GitHub da datos incompletos | Apache-2.0 | Activo, v1.41.2 (21/7/2026) | [repo](https://github.com/palantir/policy-bot), [releases](https://github.com/palantir/policy-bot/releases) |
| **bulldozer** (Palantir) | Fusiona automáticamente PR que cumplen condiciones | Apache-2.0 | Activo, v1.19.3 (26/6/2025) | [repo](https://github.com/palantir/bulldozer) |
| **Mergify** | Servicio: protecciones de fusión con condiciones, cola de fusión, auto-merge | El motor ya no es público: el repo `mergify-engine` redirige a un repositorio de issues sin código | Gratis para proyectos abiertos; pago por persona en privados | [precios](https://next.mergify.com/pricing), [docs merge protections](https://docs.mergify.com/merge-protections/custom-rules) |
| **Kodiak** | GitHub App de auto-merge y actualización de ramas | AGPL-3.0 | Activo, v0.59.1 (13/3/2026) | [repo](https://github.com/chdsbd/kodiak) |
| **Danger JS** | Reglas sobre el PR escritas en TypeScript, corren dentro del CI | MIT | Activo, 14.0.6 (27/8/2026) | [repo](https://github.com/danger/danger-js) |
| **Reviewpad** | Automatización de revisiones | Desconocida | El repositorio `reviewpad/reviewpad` ya no existe (404) | API de GitHub |
| **bors-ng** | Cola de fusión | Apache-2.0 | Archivado (solo lectura) | [repo](https://github.com/bors-ng/bors-ng) |
| **Prow / Tide** (Kubernetes) | CI y fusión por etiquetas a gran escala | Apache-2.0 | Activo; pensado para infraestructura grande | [repo](https://github.com/kubernetes-sigs/prow) |
| **gitStream** (LinearB) | Reglas de PR en YAML que corren como Action | Apache-2.0 | Activo, sin versiones publicadas | [repo](https://github.com/linear-b/gitstream) |
| **Allstar** (OpenSSF) | Revisa que la configuración de seguridad del repo (incluida la protección de ramas) se cumpla | Apache-2.0 | Activo | [repo](https://github.com/ossf/allstar) |
| **Probot** | Framework en TypeScript para escribir GitHub Apps | ISC | Activo | [repo](https://github.com/probot/probot) |

## 4. Comparación de capacidades

`✔` existe · `~` parcial · `✘` no existe · `?` no verificado

| Capacidad | GitHub nativo | policy-bot | Mergify | Kodiak | Danger JS |
|---|---|---|---|---|---|
| Checks requeridos | ✔ | ~ (los usa como condición) | ✔ | ~ | ✘ |
| Aprobaciones por rutas y equipos | ~ (CODEOWNERS) | ✔ | ✔ | ✘ | ~ (con código propio) |
| Invalidar aprobaciones con commits nuevos | ✔ | ✔ | ✔ | ✘ | ✘ |
| Evidencia atada a la base actual | ✔ ("rama al día" o merge queue) | ? | ✔ (cola) | ~ (actualiza ramas) | ✘ |
| Explicación de qué bloquea | ~ (caja de fusión) | ✔ (página de detalles) | ✔ | ~ | ✔ (comentarios propios) |
| Autoalojable y gratuito | n/a | ✔ | ✘ | ✔ | ✔ (en tu CI) |
| Vista de todos los PR de un repo con "quién debe actuar" | ✘ | ✘ | ? | ✘ | ✘ |
| Aviso a un canal de chat cuando un PR cambia de estado | ~ (webhooks e integraciones genéricas) | ✘ | ? | ✘ | ✘ |
| IA | ✘ en las reglas | ✘ | ? | ✘ | ✘ |

## 5. Conclusiones de la comparación

**Problemas ya resueltos razonablemente** (construirlos de nuevo sería duplicar):

1. Exigir checks y aprobaciones: GitHub lo hace gratis en repos públicos, y es la fuente de
   autoridad. Ninguna app externa puede impedir una fusión que GitHub permite, salvo
   publicando un check que GitHub exija.
2. Políticas de aprobación avanzadas por rutas y equipos: policy-bot, abierto y activo.
3. Fusión automática y colas: GitHub merge queue, Mergify, Kodiak, bulldozer.
4. Reglas sobre el contenido del PR dentro del CI: Danger JS.

**Funciones que solo duplicarían:** un motor de políticas propio que exija checks y
aprobaciones, una cola de fusión, y auto-merge.

**Huecos con fundamento** (**Interpretación**, sustentada en la tabla anterior):

1. **Explicar, en un solo lugar, el estado completo de un PR**, leyendo lo que GitHub ya
   exige (rulesets y protección) en vez de una configuración paralela que puede contradecirlo.
   La caja de fusión de GitHub dice *qué* falta, pero no *por qué* un check verde no cuenta, ni
   *quién* tiene que actuar.
2. **Frescura de la evidencia**: un check verde que corrió sobre un commit anterior, o contra
   una base que avanzó, es fácil de leer como válido. GitHub lo resuelve con "rama al día" o
   con la cola, pero las dos cuestan re-ejecuciones y la cola no está en repos personales.
   Mostrar la frescura sin exigir re-ejecutar es un hueco real. **Por verificar**: qué datos
   de base expone cada tipo de check (ver §7).
3. **La vista del mantenedor**: qué PR están listos, cuáles esperan revisión y de quién, y
   cuáles esperan al autor. Ninguna de las herramientas verificadas lo ofrece como función
   central.
4. **Aviso a Discord sin ruido**: un resumen y cambios de estado, no un mensaje por evento.

**Interesantes sin justificación suficiente hoy:** puntaje numérico de riesgo, selección de
tests por riesgo, análisis con IA, adaptadores para otros CI, soporte de GitLab o Bitbucket,
excepciones autorizadas con auditoría (GitHub ya tiene "bypass" en rulesets).

## 6. Estrategia de diferenciación

PRotocol **no exige nada**: lee lo que GitHub ya exige y lo explica. Publica un único check
de solo lectura ("PRotocol / readiness") con el veredicto, lo que falta, por qué un check no
cuenta y quién debe actuar; y un resumen opcional en Discord para quien mantiene.

Ventajas de este recorte:

- No compite con GitHub ni con policy-bot: los complementa.
- No necesita permisos de escritura sobre el código ni ejecutar código del PR.
- Es útil desde el primer repo, sin escribir una política.
- Es chico: lo puede mantener una persona.

## 7. Riesgos

| Riesgo | Tipo | Mitigación |
|---|---|---|
| La caja de fusión de GitHub ya cubre lo suficiente para la mayoría | Adopción | Medirlo con usuarios reales antes de agregar funciones (§ métricas en B) |
| Leer los rulesets y la protección de una rama requiere permisos que un dueño no quiera dar | Técnico y de confianza | **Por verificar** el permiso mínimo del endpoint de reglas por rama; si pide administración, degradar a "solo checks y revisiones" y decirlo en la explicación |
| No todos los checks dicen contra qué base corrieron | Técnico | Marcar "frescura respecto de la base: desconocida", nunca "fresca" |
| Límites de la API de GitHub en repos con muchos PR | Técnico | Recalcular por evento con espera (debounce), sin recorrer todo el repo |
| Ser un proyecto más que nadie usa | Adopción | Usarlo primero en repos propios y medir |

## 8. Recomendación: **REVISAR**

El concepto original (motor de políticas, adaptadores, riesgo e IA) **no se justifica**: lo
central ya lo resuelven GitHub y policy-bot, gratis y con años de uso. Construirlo de nuevo
sería más trabajo y menos confianza.

Se recomienda la versión recortada: **PRotocol, un explicador de solo lectura del estado de
cada PR, con la frescura de la evidencia y la vista del mantenedor, más Discord opcional.**
La IA y el puntaje de riesgo quedan fuera hasta que el producto base se use y se pueda medir.
