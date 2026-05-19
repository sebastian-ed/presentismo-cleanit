# Clean It · Presentismo GPS

App web responsive para control de presentismo con Supabase Auth, GPS, asignaciones semanales fijas y registro de entrada/salida.

## Qué cambia en esta versión

- Login con la estructura operario / supervisor en una sola pantalla.
- Sin PIN y sin modo local.
- Login normal con email y contraseña de Supabase Auth.
- Compatible con el esquema donde `public.profiles.id` es el mismo UUID que `auth.users.id`.
- El panel supervisor administra servicios, usuarios operativos y asignaciones semanales fijas.
- El operario registra **entrada** con GPS y luego **salida** con GPS sobre el servicio asignado.
- El panel supervisor muestra entrada, salida, estado operativo, precisión GPS, distancia al punto cargado y alertas por salida anticipada o salida no registrada.
- El historial y el CSV diferencian `Entrada`, `Salida`, `Demora` y `Ausencia`.

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

### Si ya tenés instalada la versión anterior con asignaciones

Ejecutá:

```text
supabase/migration_add_checkout_events.sql
```

Esto actualiza `attendance_events` para permitir el nuevo evento:

```text
checkout
```

También actualiza los estados de salida:

```text
on_time_exit
early_exit
```

### Si tu base todavía tiene el esquema viejo de turnos puntuales

Ejecutá primero:

```text
supabase/migration_from_uploaded_schema_to_assignments.sql
```

Después ejecutá:

```text
supabase/migration_add_checkout_events.sql
```

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

## Lógica de entrada y salida

Entrada:

- El operario marca checkbox de entrada.
- Toca `Registrar entrada con GPS`.
- Se guarda hora, GPS, precisión, distancia al servicio y si está dentro del radio permitido.

Salida:

- La salida queda bloqueada hasta que exista una entrada registrada.
- El operario marca checkbox de salida.
- Toca `Registrar salida con GPS`.
- Se guarda hora, GPS, precisión, distancia al servicio y si salió antes del horario pactado.

La salida se considera anticipada si se registra antes de la hora de finalización menos la tolerancia configurada en la asignación.

## Punto crítico

Si el usuario existe en Supabase Auth pero no existe en `public.profiles` con el mismo UUID, el login va a fallar. Eso no es un bug: es control de acceso. Auth valida la contraseña; `profiles` define qué puede hacer esa persona dentro de la app.
