# Clean It · Presentismo GPS

App web responsive para control de presentismo con Supabase Auth, GPS y asignaciones semanales fijas.

## Qué resuelve

- Login normal con Supabase Authentication: email y contraseña.
- Vista operario para registrar presencia, demora o ausencia.
- Registro de hora, latitud, longitud, precisión GPS, distancia al servicio y validación contra radio permitido.
- Vista supervisor con panel en vivo de presentes, demorados, ausentes y pendientes.
- Servicios con ubicación GPS, zona, supervisor y contacto de WhatsApp del consorcio.
- Asignaciones fijas semanales: por ejemplo lunes, miércoles y viernes de 08:00 a 12:00.
- Operarios con uno o varios servicios asignados.
- Administración de perfiles operativos desde la app: crear, editar, desactivar y asignar rol.
- Botón de WhatsApp para avisar rápido al consorcio según el estado del servicio.
- Exportación CSV de registros.

## Archivos principales

```text
index.html
styles.css
js/config.js
js/storage.js
js/app.js
supabase/schema.sql
supabase/migration_from_pin_to_supabase_auth.sql
supabase/bootstrap_supervisor_template.sql
```

## Configuración

El archivo `js/config.js` ya queda con esta estructura:

```js
window.APP_CONFIG = {
  SUPABASE_URL: "https://TU-PROYECTO.supabase.co",
  SUPABASE_ANON_KEY: "TU_ANON_KEY",
  TIMEZONE: "America/Argentina/Buenos_Aires",
  COMPANY_NAME: "Clean It"
};
```

## Instalación limpia

Usá esta opción si el proyecto Supabase todavía no tiene las tablas de esta app.

1. Ir a Supabase > SQL Editor.
2. Ejecutar:

```text
supabase/schema.sql
```

3. Ir a Supabase > Authentication > Users.
4. Crear el primer usuario supervisor con email y contraseña.
5. Copiar el `User UID` de ese usuario.
6. Abrir:

```text
supabase/bootstrap_supervisor_template.sql
```

7. Reemplazar:

```text
PEGAR_AUTH_USER_UID_AQUI
supervisor@cleanit.com
Supervisor Clean It
```

8. Ejecutar el SQL.
9. Entrar a la app con ese email y contraseña.

## Migración desde la versión con PIN

Usá esta opción si ya habías ejecutado una versión anterior de la app.

1. Ejecutar en Supabase SQL Editor:

```text
supabase/migration_from_pin_to_supabase_auth.sql
```

2. Crear o verificar los usuarios en Supabase > Authentication > Users.
3. Para el primer supervisor, ejecutar `bootstrap_supervisor_template.sql` con el `User UID` real.
4. Desde el panel supervisor, editar o crear los perfiles operativos con el mismo email que tienen en Supabase Auth.

La lógica es simple: Supabase Auth valida la identidad; la tabla `profiles` define el rol operativo y los datos internos de la app.

## Modelo de login

Ya no se usa PIN.

El flujo correcto es:

1. Usuario existe en Supabase Authentication.
2. Usuario existe en `public.profiles` con el mismo email.
3. Al primer login, la app vincula automáticamente `profiles.auth_user_id` con `auth.users.id`.
4. A partir de ahí, el rol se toma desde `profiles.role`:
   - `operator`: vista operario.
   - `supervisor`: vista supervisor.

## Alta de operarios

Desde la app podés crear el perfil operativo, pero la contraseña no se crea desde el front-end. Eso es deliberado.

Para que un operario pueda entrar:

1. Crear el usuario en Supabase Authentication.
2. Crear el perfil en la app con el mismo email.
3. Asignarle servicios y horarios.

Crear usuarios de Auth desde el navegador con permisos administrativos sería una mala práctica. Eso requiere una Edge Function con service role o hacerlo desde el panel de Supabase.

## Publicación

Podés subir estos archivos a GitHub Pages, Netlify o Vercel.

Para que el GPS funcione bien en celulares, la app debe correr en HTTPS. `localhost` sirve para desarrollo, pero en producción usá dominio con certificado.

## Seguridad

La app usa Row Level Security:

- Operarios solo leen sus asignaciones y sus registros.
- Supervisores administran servicios, perfiles y asignaciones.
- El acceso anónimo a tablas queda revocado.
- La identidad se valida con Supabase Auth.

No publiques `service_role` en el front-end. Nunca. Eso no es una optimización: es dejar la caja abierta con un cartel de “no tocar”.
