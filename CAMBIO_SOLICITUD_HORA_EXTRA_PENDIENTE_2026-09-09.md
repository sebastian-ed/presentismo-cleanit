# Solicitud de hora extra pendiente · 2026-09-09

Cambio acotado exclusivamente al flujo de horas extra.

- El operario puede solicitar una extensión de jornada mientras el turno sigue abierto.
- Debe indicar hasta qué hora necesita continuar y el motivo.
- La solicitud queda en estado **pendiente de aprobación**: no equivale a una autorización.
- Mientras está pendiente, el cierre automático se posterga hasta 45 minutos después del horario solicitado, para no impedir la salida real con GPS.
- Supervisor/Admin ve la solicitud en **En vivo** y puede aprobarla o rechazarla.
- La aprobación puede hacerse incluso después de que el operario haya registrado la salida, conservando la hora real trabajada.
- Si se rechaza, queda constancia del rechazo y no se altera la marcación real.
- El resto del sistema no fue modificado.

## Supabase
Ejecutar una vez `EJECUTAR_EN_SUPABASE_SOLICITUD_HORA_EXTRA_2026-09-09.sql` después de la migración previa de horas extra autorizadas.
