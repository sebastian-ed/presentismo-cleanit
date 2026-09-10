# Corrección GPS jornada flexible — 2026-09-10

Se corrigió exclusivamente el fichaje de entrada de operarios con modalidad de jornada flexible.

## Problema
El nuevo flujo flexible llamaba a una función inexistente (`getCurrentPosition()`), mientras que la aplicación ya utiliza el helper `getPosition()` para obtener la geolocalización del navegador.

## Corrección
- Se reutiliza `getPosition()` igual que en el resto de los fichajes.
- Se toman `latitude`, `longitude` y `accuracy` desde `position.coords`.
- Se conserva la hora real entregada por la geolocalización para el registro.
- Se mantiene el control de radio GPS del servicio.
- No se modificó la lógica de jornadas normales, nocturnas, novedades, ausencias, horas extra ni asignaciones especiales.
- Se incrementó la versión de caché/PWA para forzar la actualización del JavaScript corregido.
