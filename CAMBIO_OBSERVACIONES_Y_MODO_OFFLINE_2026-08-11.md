# Observaciones de coberturas/refuerzos + fichaje sin conexión

## Observaciones para supervisión
- En `En vivo`, las coberturas/refuerzos con notas muestran `Ver observación`.
- El modal muestra observación de entrada, observación de salida y, si existe, nota de la asignación extraordinaria.
- Se mantiene la validación de trabajos extraordinarios declarados por operarios.

## Fichaje offline
- Se agregó `manifest.webmanifest`, `sw.js` e iconos PWA.
- Tras una visita online, la app guarda el shell para poder abrirse sin conexión.
- Se guarda localmente el último perfil de operario, sus servicios, asignaciones y eventos recientes.
- Si Supabase no está disponible, una entrada/salida se guarda localmente con:
  - fecha/hora del teléfono (`client_time`)
  - latitud/longitud
  - precisión GPS
  - distancia calculada al servicio
  - observación
  - servicio/asignación
- Los registros pendientes se sincronizan al volver la conexión mientras la app está abierta o al abrirla nuevamente.
- Los registros realizados offline llevan la leyenda `Registro realizado sin conexión.` en observaciones para auditoría.

## Condiciones
- El operario debe haber iniciado sesión y abierto la app al menos una vez con internet en ese teléfono.
- No es posible autenticar un usuario nuevo sin conexión.
- La ubicación del dispositivo debe estar activada y el permiso de geolocalización concedido.
- No requiere SQL ni cambios en Supabase.

## Archivos a publicar en GitHub
- `index.html`
- `styles.css`
- `js/app.js`
- `js/storage.js`
- `manifest.webmanifest`
- `sw.js`
- `icons/icon-192.png`
- `icons/icon-512.png`
