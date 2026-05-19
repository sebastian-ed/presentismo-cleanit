# Clean It · Presentismo GPS

App web responsive para control de presentismo con Supabase Auth, GPS y asignaciones semanales fijas.

## Qué cambia en esta versión

- Login con la estructura operario / supervisor en una sola pantalla.
- Sin PIN y sin modo local.
- Login normal con email y contraseña de Supabase Auth.
- Compatible con el esquema donde `public.profiles.id` es el mismo UUID que `auth.users.id`.
- El panel supervisor administra servicios, usuarios operativos y asignaciones semanales fijas.
- El operario marca presencia con GPS sobre sus servicios asignados para el día.

## Flujo correcto de usuarios

1. Crear el usuario en Supabase > Authentication > Users.
2. Copiar el `User UID`.
3. Crear el perfil en `public.profiles` usando ese mismo UUID en la columna `id`.
4. Asignar el rol:
   - `operator` para operario.
   - `supervisor` para supervisor.

Ejemplo:

```sql
insert into public.profiles (id, full_name, role, phone, is_active)
values ('UUID_DEL_USUARIO_AUTH', 'Nombre Apellido', 'supervisor', '+5491100000000', true);
```

Si tu usuario ya existe en Auth pero no podés ingresar, ejecutá:

```text
supabase/bootstrap_current_user_profile.sql
```

Reemplazando primero el UUID del usuario.

## Instalación en Supabase

### Si tu base ya tiene el esquema anterior que subiste

Ejecutá:

```text
supabase/migration_from_uploaded_schema_to_assignments.sql
```

Esto agrega:

- `assignments` para asignaciones semanales fijas.
- Campos extra en `sites`: zona, supervisor y tipo de servicio.
- Compatibilidad de `attendance_events` con turnos materializados desde asignaciones.
- Políticas RLS ajustadas al modelo `profiles.id = auth.users.id`.

### Si vas a instalar desde cero

Ejecutá:

```text
supabase/schema.sql
```

## Publicación

Subí estos archivos al repo o hosting:

```text
index.html
styles.css
js/config.js
js/storage.js
js/app.js
```

El archivo `js/config.js` ya está configurado con tu proyecto Supabase.

## Uso operativo

El supervisor carga:

- Usuarios operativos vinculados a Supabase Auth.
- Servicios / consorcios con ubicación GPS.
- Contacto WhatsApp del consorcio.
- Asignaciones fijas por día y horario.

Ejemplo de asignación:

```text
Operario: Ana Pérez
Servicio: Alvarez Thomas 550
Días: lunes, miércoles y viernes
Horario: 08:00 a 12:00
```

La app genera automáticamente el turno del día según la fecha seleccionada.

## Punto crítico

Si el usuario existe en Supabase Auth pero no existe en `public.profiles` con el mismo UUID, el login va a fallar. Eso no es un bug: es control de acceso. Auth valida la contraseña; `profiles` define qué puede hacer esa persona dentro de la app.
