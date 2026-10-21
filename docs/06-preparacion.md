# F. Antes de implementar

## Supuestos sin resolver

1. El permiso mínimo para leer las reglas efectivas de una rama (hito 0).
2. Qué tipos de check informan contra qué base corrieron (`workflow_run` sí, según su
   esquema; otros proveedores, no se sabe).
3. Si la caja de fusión de GitHub ya les alcanza a los mantenedores (se responde con el
   hito 4 en uso real).
4. Que `better-sqlite3` funcione con la versión LTS de Node elegida.

## Dependencias externas

- Una cuenta de GitHub para registrar la App (la del dueño del proyecto).
- Un repo de prueba propio.
- Para Discord: una aplicación de Discord y un servidor de prueba.
- Para recibir webhooks en local: un túnel.

## Decisiones que tiene que aprobar una persona

- El nombre definitivo y la licencia (recomendada Apache-2.0).
- Instalar la App en un repo real de otra persona: solo con su permiso.
- Publicar el repositorio.

## Qué se puede hacer en paralelo

- El hito 1 (evaluador puro) no depende de nada externo y puede empezar ya.
- Los hitos 2 a 4 dependen de los fixtures del hito 0.
- El hito 5 depende del 4 y de que el 4 haya demostrado utilidad.
