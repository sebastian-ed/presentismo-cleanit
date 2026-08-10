# Actualización 10/08/2026 — Panel operativo y mapa GPS

## Qué se agregó

- Click en **Coberturas del día** → listado completo de coberturas y estado actual.
- Click en **Entradas registradas** → listado de ingresos registrados.
- Click en **Salidas registradas** → listado de egresos registrados.
- Click en **Alertas operativas** → listado de demoras, ausencias, fichajes fuera de radio, salidas anticipadas y salidas pendientes/no registradas.
- Botones **Mapa entrada** y **Mapa salida** en “Estado por servicio”.
- Mapa con:
  - coordenada real del fichaje;
  - precisión GPS;
  - todos los servicios activos geolocalizados;
  - servicio asignado destacado;
  - radio GPS permitido;
  - distancia fichaje → servicio asignado;
  - servicio geolocalizado más cercano, para detectar rápidamente si la persona fichó cerca de otro servicio.
- Acceso compatible con roles `supervisor` y `admin`; los operarios no acceden a estas herramientas.

## Publicación en GitHub Pages

Reemplazar en el repositorio, como mínimo:

- `index.html`
- `styles.css`
- `js/app.js`

No hay que cambiar `js/config.js`.

## Supabase

### Si hoy solo usás `supervisor` y `operator`

No hace falta tocar la base para usar KPIs clickeables ni el mapa.

### Si querés crear un rol `admin` real

Ejecutar una sola vez en **Supabase → SQL Editor**:

`supabase/migrations/20260810_admin_ops_dashboard.sql`

Después podés cambiar el rol del perfil correspondiente a `admin`.

Si ese administrador también va a crear/restablecer operarios desde la app, redeployar la Edge Function:

- `supabase/functions/create-operator/index.ts`

La función `create-user` también quedó preparada para `admin` por consistencia.

## Dependencia de mapa

Se incorporó Leaflet 1.9.4 y OpenStreetMap. No requiere API key ni una cuenta adicional.
