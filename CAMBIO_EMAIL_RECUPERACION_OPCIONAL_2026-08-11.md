# Email de recuperación opcional · 11/08/2026

## Qué cambia
- El email de recuperación deja de ser obligatorio al crear Operarios, Supervisores o Administradores.
- Si se deja vacío, la cuenta usa internamente un email técnico `usuario@cleanit.ar`; el usuario continúa ingresando normalmente con su nombre de usuario y contraseña.
- En `¿Olvidaste tu contraseña?`, una persona que todavía no tenga email real puede informar uno en ese momento.
- Por seguridad, ese email queda `pendiente de aprobación`; no se permite que una persona no autenticada cambie por sí sola el email de una cuenta.
- En `Usuarios`, supervisor/admin verá la solicitud y podrá usar `Aprobar email y enviar enlace` o `Rechazar email`.
- Una vez aprobado, Supabase asocia ese correo a la cuenta y envía el enlace de recuperación.
- Si la cuenta ya tenía email real, el flujo de recuperación sigue siendo inmediato como hasta ahora.

## Publicación
1. Ejecutar `supabase/migrations/20260811_optional_recovery_email.sql` en Supabase SQL Editor.
2. Volver a desplegar `supabase/functions/user-auth`:
   `supabase functions deploy user-auth --no-verify-jwt`
3. Reemplazar en GitHub: `index.html`, `styles.css`, `js/app.js`, `js/storage.js`.

No hace falta modificar las asignaciones, servicios ni datos históricos.
