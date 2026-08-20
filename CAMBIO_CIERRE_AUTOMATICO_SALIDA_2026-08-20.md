# Cierre automático de salidas faltantes · 20/08/2026

## Regla
Cuando un turno con asignación tiene una entrada registrada y no tiene salida, el sistema espera hasta 45 minutos después del horario programado de finalización. Superado ese umbral, crea una salida automática.

## Cómputo de horas
La salida automática se imputa al **horario programado de salida**, no a la hora de procesamiento del sistema. Así RRHH no suma 45 minutos ficticios al tiempo trabajado.

Ejemplo: turno 08:00–14:00, entrada 08:03, sin salida. A partir de 14:45 el sistema cierra el turno. La hora efectiva de salida para RRHH queda 14:00. `created_at` y la observación dejan registrada la hora real en la que se ejecutó el cierre automático.

## Trazabilidad
La marcación queda como:
- Tipo: Salida (`checkout`)
- `recorded_via`: `system_auto`
- GPS: sin datos
- Registrado por: **Cierre automático del sistema · sin GPS**
- Observación: indica horario programado, hora de procesamiento y motivo del cierre.

En En vivo se muestra en color naranja como **Cierre automático**, existe un filtro **Cierres automáticos** y el mapa operativo lo trata como una particularidad/alerta horaria, no como ausencia.

## Ejecución
La migración crea `public.auto_close_overdue_shifts()` y programa Supabase Cron cada minuto mediante `pg_cron`. Además, la app llama a la misma función al abrir la vista de operario o administración como mecanismo de respaldo.

## Alcance
Solo se cierran automáticamente turnos con `assignment_id`. Esto incluye asignaciones fijas y coberturas/refuerzos cargados formalmente. Las coberturas autodeclaradas por el operario sin una asignación y sin horario programado no se cierran automáticamente.

La automatización se aplica a turnos con `shift_date >= 2026-08-20`, para no alterar históricos anteriores a su implementación.
