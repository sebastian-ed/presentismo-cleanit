-- Bootstrap del primer supervisor.
-- Usar una sola vez si todavía no podés entrar al panel supervisor.
-- 1) Crear usuario en Supabase > Authentication > Users.
-- 2) Copiar el User UID.
-- 3) Reemplazar los valores de ejemplo y ejecutar.

insert into public.profiles (
  auth_user_id,
  email,
  full_name,
  role,
  phone,
  notes,
  is_active
)
values (
  'PEGAR_AUTH_USER_UID_AQUI',
  'supervisor@cleanit.com',
  'Supervisor Clean It',
  'supervisor',
  '+5491100000000',
  'Perfil supervisor inicial creado por bootstrap.',
  true
)
on conflict (email) do update set
  auth_user_id = excluded.auth_user_id,
  full_name = excluded.full_name,
  role = excluded.role,
  phone = excluded.phone,
  notes = excluded.notes,
  is_active = true,
  updated_at = now();
