# Monitor de errores del operario · 2026-09-11

Se agrega un módulo independiente **Errores** para Supervisor/Admin.

## Qué registra
- Errores técnicos durante entrada/salida, GPS, jornada flexible, coberturas/refuerzos y solicitudes de hora extra.
- Bloqueos de uso relevantes (por ejemplo intentar salir sin entrada, no confirmar el checkbox o intentar abrir un segundo tramo flexible).
- Errores JavaScript no controlados y promesas rechazadas mientras la sesión sea de un operario.
- Si no hay internet, el incidente queda en cola local y se sincroniza cuando vuelve la conexión.

Cada incidencia conserva: fecha/hora, operario, servicio, turno, acción, categoría, mensaje mostrado, detalle técnico, estado de conexión, dispositivo/navegador, URL y versión de la app.

## Vista Supervisor/Admin
- Nueva pestaña **Errores** separada del historial de marcaciones.
- Badge con cantidad de errores nuevos del día.
- Consulta por fecha y estado (nuevos/revisados/todos).
- Detalle técnico desplegable.
- Acción **Marcar revisado** con observación opcional, conservando quién y cuándo lo revisó.

## Base de datos
Ejecutar una sola vez `EJECUTAR_EN_SUPABASE_MONITOR_ERRORES_2026-09-11.sql`.
