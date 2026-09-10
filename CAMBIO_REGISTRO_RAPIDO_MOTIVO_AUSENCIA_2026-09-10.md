# Registro rápido de motivo de ausencia – 10/09/2026

- Se agrega en **En vivo** una acción rápida similar a **Marcar franco** para registrar el motivo de una ausencia puntual.
- Motivos disponibles: Médico / certificado, Licencia, Motivo personal, Motivo familiar, Problema de traslado y Otro motivo.
- Si el sistema ya generó la ausencia automática, no se duplica la ausencia: se agrega el motivo al mismo registro.
- Si todavía no existía una ausencia, Supervisor/Admin puede registrarla directamente.
- El estado en vivo muestra, por ejemplo, **Ausente · Médico / certificado**.
- El motivo queda en observaciones y trazabilidad del registro.
- No se modifica la lógica de francos, novedades programadas, vacaciones, asignaciones especiales, fichajes, GPS, horas extra ni cierres automáticos.
- No requiere SQL nuevo; utiliza la tabla de eventos de asistencia ya existente.
