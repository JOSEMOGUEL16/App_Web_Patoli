# Patoli · Servicio social

Esta versión funcional conserva la identidad y las imágenes de tu página de **Documentos/Servicio Social**. Los archivos originales no se modificaron. La aplicación de Descargas no se importó ni se cambió.

## Abrir en Windows

1. Abre **INICIAR-PATOLI.cmd** con doble clic. La aplicación se abrirá en el navegador.
2. La primera vez, crea tu cuenta de **coordinación** usando tu correo y una contraseña de al menos 12 caracteres. Ese enlace inicial se genera únicamente en este equipo y deja de servir al crear la cuenta.
3. Los estudiantes pueden elegir **Crear cuenta** desde la pantalla de acceso. La meta inicial es de **480 horas** y coordinación puede ajustarla.

La dirección es **http://127.0.0.1:3000**. Para volver a abrir la configuración inicial, usa INICIAR-PATOLI.cmd. No abras directamente los archivos HTML ni uses Live Server: el registro de cuentas y horas necesita el servidor de Patoli.

Patoli utiliza Node.js 24 o posterior. El iniciador busca Node en Windows y también en la instalación local de Codex. No requiere descargar paquetes ni instalar otro servidor de bases de datos. Al cambiar de computadora puede ser necesario instalar Node desde [su sitio oficial](https://nodejs.org/).

## Estudiantes

- Crear cuenta, iniciar sesión, editar perfil y cambiar contraseña.
- Registrar fecha, descripción y duración de la jornada; se permiten fracciones de 15 minutos.
- Pulsar **Enviar a revisión**. Las horas quedan **En revisión** y todavía no suman al avance.
- Consultar **Aprobado** o **Devuelto** y el comentario de coordinación.
- Corregir y reenviar jornadas devueltas; editar o retirar las pendientes.
- Consultar horas aprobadas, pendientes, por corregir y restantes.

## Coordinación

- Revisar jornadas y elegir **Aprobar horas** o **Devolver para corregir**.
- Escribir un motivo obligatorio al devolverlas; los comentarios llegan al historial del estudiante.
- Buscar estudiantes y jornadas, ajustar metas y descargar un reporte CSV.
- Restablecer el acceso de un estudiante con una contraseña temporal. Compártela personalmente: el estudiante deberá cambiarla al ingresar.
- Publicar, editar y archivar actividades de la agenda. Las actividades pasadas se ocultan de la página de inicio.

Las horas aprobadas quedan bloqueadas para edición y retiro. Un reenvío vuelve al estado **En revisión**. El servidor conserva la auditoría de envíos, correcciones y revisiones.

## Datos y respaldo

- La base real es **data/patoli.sqlite**, dentro de esta carpeta. No contiene cuentas de demostración.
- Las cuentas, sesiones, jornadas, revisiones y actividades permanecen después de cerrar el navegador o reiniciar Patoli.
- Ejecuta **RESPALDAR-PATOLI.cmd** para crear una copia consistente en **backups/**. Funciona también con Patoli abierto.
- Usa **DETENER-PATOLI.cmd** cuando termines; espera a que no haya formularios guardándose.
- Para mover la aplicación, detenla y copia la carpeta completa. Para restaurar un respaldo, detén Patoli, conserva primero una copia de toda la carpeta `data`, y restaura el archivo respaldado como `data/patoli.sqlite` en una carpeta de datos nueva. No mezcles una base restaurada con archivos `-wal` o `-shm` de otra base.
- Los respaldos contienen información personal: guárdalos en un lugar privado.

## Alcance de esta entrega

La aplicación funciona **localmente en este equipo**. No está publicada en Internet ni se abre a otros dispositivos de la red. No envía correos de verificación, recuperación ni notificaciones: el seguimiento se consulta dentro de Patoli. La cuenta inicial de coordinación es la única cuenta administradora creada por la configuración; los registros públicos siempre crean estudiantes.

Para permitir acceso desde otros equipos se necesita un despliegue con dominio, HTTPS y almacenamiento persistente. La base SQLite sirve para esta instalación local; no se configuró PostgreSQL ni se modificó su instalación existente.

## Archivos para continuar el desarrollo

- `public/`: páginas HTML, estilos, fotografías y JavaScript del navegador.
- `server.mjs`: servidor y API con permisos por usuario y rol.
- `database.mjs`: tablas SQLite y transacciones.
- `scripts/`: iniciador, parada y respaldo.
- `test/app.test.mjs`: pruebas integrales del servidor.

Las contraseñas se guardan con scrypt y sal individual, siguiendo la [API criptográfica de Node](https://nodejs.org/docs/latest-v24.x/api/crypto.html). Las sesiones usan cookies HttpOnly y SameSite; las escrituras verifican origen y token CSRF. Los cálculos utilizan minutos enteros y consultas SQL parametrizadas. La persistencia usa el [módulo SQLite incluido en Node](https://nodejs.org/download/release/v24.22.1/docs/api/sqlite.html).

Desde una terminal en esta carpeta:

```text
node server.mjs --open
node --test test/app.test.mjs
node scripts/respaldo.mjs
```

Las pruebas crean y eliminan únicamente una base temporal propia. Se verificaron permisos, validaciones, duplicados, devolución y reenvío, aprobación, auditoría, recuperación de acceso, reportes y persistencia tras reinicio. El flujo principal también se probó en el navegador con datos ficticios, separado de la base real.
