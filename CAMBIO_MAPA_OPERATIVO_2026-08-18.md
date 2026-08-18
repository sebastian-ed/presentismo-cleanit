# Mapa operativo · 18/08/2026

Se agregó una pestaña **Mapa operativo** visible dentro del panel de gestión (administradores y supervisores).

- Muestra todos los servicios activos geolocalizados.
- Estado agregado por servicio con colores: verde correcto, naranja demora/alerta horaria, violeta fuera de radio, rojo ausencia/crítico, celeste pendiente y gris franco/sin cobertura.
- Si un servicio tiene varios operarios, toma como color el estado de mayor prioridad operativa y el popup detalla a cada operario.
- Selector de fecha para consultar hoy o días anteriores.
- En la fecha de hoy se actualiza automáticamente cada 60 segundos mientras la pestaña está abierta.
- Filtros rápidos por estado y buscador contextual por servicio, operario o estado.
- Los servicios sin coordenadas se informan debajo del mapa.

No requiere cambios SQL ni Edge Functions.
