# Corrección de fecha y zona horaria — 14/08/2026

## Problema corregido
La app generaba algunas fechas de servicio con `new Date().toISOString().slice(0, 10)`. `toISOString()` trabaja en UTC. En Argentina, desde las 21:00, UTC ya corresponde al día siguiente, por lo que una marcación realizada el 13/08 a las 22:00 podía quedar asociada al 14/08.

## Cambios
- La fecha operativa ahora se calcula explícitamente con `America/Argentina/Buenos_Aires`.
- `shift_date` de las entradas toma el día real del turno, no la fecha UTC del navegador.
- La salida conserva siempre el `shift_date` de la entrada. Esto evita que un turno nocturno 22:00–06:00 se parta en dos fechas.
- Las coberturas/refuerzos extraordinarios usan la fecha argentina del momento GPS.
- Los rangos mensuales y las fechas históricas dejaron de depender de `toISOString().slice(0, 10)`.
- Las marcaciones manuales se interpretan en horario de Buenos Aires.
- Los horarios programados se convierten explícitamente desde la zona horaria operativa.
- La visualización de horas y fechas de timestamps usa Buenos Aires.
- Se incrementó la versión del Service Worker para forzar la actualización en los celulares.

## Instalación
Reemplazar en GitHub: `index.html`, `js/app.js`, `js/storage.js` y `sw.js`. Se incluyen los demás archivos para facilitar un reemplazo completo.

No requiere SQL ni cambios en Supabase.
