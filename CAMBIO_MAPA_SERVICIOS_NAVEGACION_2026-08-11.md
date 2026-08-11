# Mapa de servicios y navegación contextual — 11/08/2026

## Cambios
- En **Servicios**, cada tarjeta incorpora **Ver mapa** para visualizar el punto GPS del servicio, su radio aceptado y los demás servicios como referencia.
- La carga de coordenadas se unificó en un único campo con formato `latitud, longitud`, compatible con el texto copiado desde Google Maps (ej. `-34.5849798751733, -58.43825497202207`).
- Al tocar **Editar** en Asignaciones, Servicios o Usuarios, la pantalla se desplaza automáticamente hasta el formulario activo.
- Las búsquedas contextuales ahora desplazan automáticamente la vista al bloque/primer resultado después de una breve pausa al escribir. Enter mantiene el mismo comportamiento inmediato.

## Despliegue
Reemplazar en GitHub:
- `index.html`
- `styles.css`
- `js/app.js`

`js/storage.js` puede reemplazarse también si se publica el paquete completo, aunque no tuvo cambios funcionales en esta actualización.

No requiere SQL ni cambios en Supabase.
