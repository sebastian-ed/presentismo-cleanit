# Cambio – filtros rápidos y anomalías visibles

## Qué se modificó

- En **Estado por servicio**, si un operario está trabajando pero su entrada fue **fuera de radio**, el estado "En servicio" deja de mostrarse como normal y se muestra en rojo.
- Si la entrada fue **tarde**, "En servicio" se muestra en amarillo/naranja.
- En **Estado operativo** se explicita `En servicio · fuera de radio` o `En servicio · entrada tarde`.
- Se agregó una barra de filtros rápidos con conteo: Todos, Con alerta, En horario, Llegada tarde, Fuera de radio, Ausentes, Pendientes y Alertas de salida.
- Al tocar un filtro, la tabla muestra únicamente las coberturas que cumplen esa condición. No realiza una nueva consulta a Supabase; filtra los datos ya cargados del día.

## Publicación

Para GitHub Pages basta con reemplazar:

- `index.html`
- `styles.css`
- `js/app.js`

No requiere SQL ni volver a desplegar la Edge Function.
