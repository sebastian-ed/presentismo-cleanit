# Clean It · Presentismo GPS — Supabase

App web mobile-first para control de presentismo con GPS, horarios fijos por servicio y panel vivo de supervisión.

Esta versión trabaja **solo con Supabase**. No incluye persistencia local ni fallback con `localStorage`.

## Qué resuelve

- El operario marca presencia desde el celular con un checkbox y botón único.
- La app registra hora, ubicación GPS, precisión, distancia al servicio y si está dentro del radio permitido.
- El supervisor ve el estado operativo en vivo: presente, demorado, ausente, pendiente o fuera de radio.
- Cada servicio tiene asignaciones semanales fijas: por ejemplo lunes, miércoles y viernes de 08:00 a 12:00.
- Un operario puede tener varios servicios asignados.
- Un servicio puede tener más de un operario el mismo día.
- El supervisor puede crear, editar o eliminar servicios, usuarios y asignaciones desde la app.
- Cada servicio puede tener WhatsApp precargado para avisar rápido al consorcio.

## Archivos importantes

```text
index.html
styles.css
js/config.js
js/storage.js
js/app.js
supabase/schema.sql
supabase/migration_v1_to_assignments.sql
```

`js/config.js` ya contiene la configuración Supabase provista para este proyecto.

## Instalación en Supabase

### Si el proyecto Supabase está vacío

Ejecutar:

```text
supabase/schema.sql
```

Eso crea las tablas nuevas y un supervisor inicial con PIN `9999`.

### Si ya habías usado la versión anterior de la app

Ejecutar:

```text
supabase/migration_v1_to_assignments.sql
```

Ese script:

- Agrega `pin` y `notes` a `profiles`.
- Desacopla `profiles.id` de `auth.users` para que puedas crear usuarios desde la app.
- Agrega `zone`, `supervisor_name` y `service_type` a `sites`.
- Crea `assignments` para horarios fijos semanales.
- Migra turnos puntuales antiguos a asignaciones limitadas a esa fecha.
- Ajusta `attendance_events` para que funcione con turnos generados desde asignaciones.
- Reemplaza políticas RLS anteriores por políticas compatibles con este MVP por PIN.

## Acceso

La app usa acceso por PIN operativo guardado en `profiles`.

- Supervisor inicial: `9999`, si corrés el SQL de instalación limpia o la migración y no existe otro PIN.
- Después conviene entrar como supervisor, crear usuarios reales y cambiar el PIN inicial.

## Publicación

Subí estos archivos a GitHub Pages, Netlify o cualquier hosting estático con HTTPS.

El GPS en celulares requiere HTTPS. GitHub Pages y Netlify ya lo resuelven.

## Uso operativo

1. Entrar como supervisor.
2. Cargar operarios en **Usuarios**.
3. Cargar servicios/consorcios en **Servicios** con latitud, longitud y radio GPS.
4. Cargar horarios fijos en **Asignaciones**.
5. Ver el estado diario en **En vivo**.
6. Usar el botón de WhatsApp para avisar rápido al consorcio ante demora o ausencia.

## Criterio GPS recomendado

- CABA/consorcios: radio entre 80 y 150 metros.
- Plantas grandes o predios amplios: radio mayor, pero justificado.
- No uses radios enormes. Si el radio es demasiado amplio, el dato pierde valor operativo y probatorio.

## Nota crítica de seguridad

Este MVP usa PIN + políticas RLS abiertas para que la operación sea simple desde una app estática. Es práctico para empezar, pero no es el modelo definitivo si el sistema escala.

Para una versión más sólida: Supabase Auth, roles reales, Edge Functions para alta de usuarios y políticas RLS por usuario. No lo mezcles a medias: seguridad improvisada es deuda técnica con intereses.
