-- Clean It · Presentismo GPS
-- Email de recuperación opcional + solicitud segura cuando la persona pierde la contraseña.
-- Ejecutar una sola vez antes de desplegar la nueva versión de user-auth.

alter table if exists public.profiles
  add column if not exists pending_recovery_email text,
  add column if not exists recovery_requested_at timestamptz;

create index if not exists idx_profiles_pending_recovery_requested_at
  on public.profiles (recovery_requested_at)
  where pending_recovery_email is not null;

comment on column public.profiles.email is
  'Email usado por Supabase Auth. Puede ser interno @cleanit.ar hasta que la persona configure un email real de recuperación.';
comment on column public.profiles.pending_recovery_email is
  'Email informado por la persona desde Olvidaste tu contraseña, pendiente de aprobación por gestión.';
comment on column public.profiles.recovery_requested_at is
  'Fecha y hora de la última solicitud para asociar un email de recuperación.';
