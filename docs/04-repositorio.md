# D. Estructura del repositorio

Un solo paquete. Separar en varios paquetes (monorepo) no se justifica todavía: hay un
producto, un proceso y una persona manteniéndolo.

```
PRotocol/
  src/
    evaluator/        Puro: requisitos + evidencia -> veredicto. Sin red.
      verdict.ts
      freshness.ts
      explain.ts      Textos para personas, en inglés
    github/           Único lugar que habla con GitHub
      app.ts          Autenticación de la App
      requirements.ts Reglas efectivas de la rama base
      evidence.ts     Checks, estados y revisiones
      checkRun.ts     Publicar o actualizar el check
    webhook/
      receiver.ts     Firma, duplicados, encolar
    jobs/
      queue.ts        Tabla jobs en SQLite
      worker.ts
    config/
      schema.ts       Esquema de .github/protocol.yml y de las variables de entorno
    discord/          Opcional; no se carga sin DISCORD_TOKEN
      bot.ts
      format.ts
    db.ts
    main.ts
  migrations/         SQL numerado
  test/
    evaluator/        Casos de la tabla de semántica, uno por regla
    fixtures/         Respuestas reales de la API guardadas (sin datos privados)
  docs/
    01-validacion.md ... 06-preparacion.md
    adr/              Decisiones de arquitectura, una por archivo
  .github/
    workflows/ci.yml  tipos, lint, tests, auditoría de dependencias
    ISSUE_TEMPLATE/
    pull_request_template.md
  Dockerfile
  README.md  CONTRIBUTING.md  SECURITY.md  CODE_OF_CONDUCT.md  CHANGELOG.md  LICENSE
```

Reglas de dependencia (las verifica una prueba que lee los `import`):

- `evaluator/` no importa de `github/`, `discord/`, `db.ts` ni `jobs/`.
- `discord/` no importa de `github/`: recibe evaluaciones ya hechas.

## Herramientas

| Uso | Herramienta |
|---|---|
| Tipos | TypeScript en modo estricto |
| Pruebas | Vitest |
| Lint y formato | ESLint + Prettier |
| Esquemas | Zod |
| SQLite | `better-sqlite3` (**Por verificar** compatibilidad con la versión LTS de Node elegida; alternativa: el módulo `node:sqlite`) |

## Configuración de ejemplo (opcional)

```yaml
# .github/protocol.yml, leído de la rama base
version: 1
notify:
  discord:
    on: [ready, blocked]   # cambios de veredicto que se avisan
labels:
  skip: ["wip"]            # PR con esta etiqueta no se avisan (el check se publica igual)
```

## Licencia recomendada

**Apache-2.0**: permite uso comercial y autoalojado, incluye una licencia de patentes explícita
y es la misma de policy-bot y bulldozer, con quienes conviene convivir. Se descartó AGPL
porque frena a empresas chicas que querrían autoalojarlo, y no hay un servicio propio que
proteger.

## Proceso del proyecto

- Versiones semánticas y `CHANGELOG.md` con el formato "Keep a Changelog".
- Cada cambio de comportamiento del evaluador lleva su prueba primero.
- Decisiones grandes en `docs/adr/NNN-titulo.md`.
- Sin telemetría ni llamadas a servicios propios.
