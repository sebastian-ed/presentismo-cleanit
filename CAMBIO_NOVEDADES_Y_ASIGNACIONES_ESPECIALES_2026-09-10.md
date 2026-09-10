# Novedades de presentismo y asignaciones especiales · 10/09/2026

## Novedades justificadas
- Nueva pestaña **Novedades** para registrar y programar certificado médico, licencia médica, otra licencia y vacaciones.
- Permite definir período desde/hasta, referencia y observaciones.
- Una novedad activa evita que se genere ausencia automática durante el período.
- En **En vivo** el turno queda identificado con la novedad correspondiente y no como ausencia.
- El operario ve que no debe fichar mientras la novedad esté vigente.
- Las cancelaciones no borran el registro.
- Se incorporó una tabla de auditoría que registra alta, modificación y cancelación, con usuario y fecha.

## Asignación especial por un día
- Nueva opción dentro de **Asignaciones** para programar un horario/servicio excepcional de una sola fecha.
- Ese día reemplaza toda la jornada fija habitual del operario, aunque el horario especial no se superponga con el normal.
- Al día siguiente vuelve automáticamente al cronograma habitual.
- Se puede editar o eliminar la asignación especial.
- No se clasifica como cobertura/refuerzo ni como hora extra: es una modificación puntual de la jornada planificada.

## Instalación
Ejecutar una sola vez `EJECUTAR_EN_SUPABASE_NOVEDADES_Y_ASIGNACIONES_ESPECIALES_2026-09-10.sql` y luego publicar los archivos actualizados de la app.
