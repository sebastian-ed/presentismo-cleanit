-- Usar si tu usuario ya existe en Supabase Authentication pero todavía no podés ingresar.
-- 1) Ir a Supabase > Authentication > Users.
-- 2) Copiar el User UID de tu usuario.
-- 3) Reemplazar los valores de abajo y ejecutar.

insert into public.profiles (id, full_name, role, phone, notes, is_active)
values (
  'PEGAR_AUTH_USER_UID_ACA',
  'Supervisor Clean It',
  'supervisor',
  '+5491100000000',
  'Perfil inicial creado para acceso supervisor',
  true
)
on conflict (id) do update
set
  full_name = excluded.full_name,
  role = excluded.role,
  phone = excluded.phone,
  notes = excluded.notes,
  is_active = true,
  updated_at = now();
