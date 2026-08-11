# Email solo para recuperación de contraseña — 11/08/2026

## Cambio
- Se eliminó el campo **Email de recuperación** del alta y edición de usuarios en el panel de Administración/Supervisión.
- Las tarjetas de usuarios ya no muestran un email de recuperación permanente.
- El alta de operarios y supervisores se realiza con rol, nombre, usuario, contraseña, teléfono y notas.
- La recuperación por email sigue disponible exclusivamente desde **¿Olvidaste tu contraseña?** en el login.
- Si una persona sin email real inicia una solicitud de recuperación desde el login, la solicitud pendiente puede seguir apareciendo al administrador/supervisor para validarla. No se puede cargar ni cambiar preventivamente el email desde el formulario de Usuarios.

## Backend
La función `user-auth` incluida en este proyecto permite crear cuentas sin un email real y genera internamente el email técnico basado en el nombre de usuario. Si en Supabase todavía está desplegada una versión anterior que exige email, hay que volver a desplegar `supabase/functions/user-auth`.
