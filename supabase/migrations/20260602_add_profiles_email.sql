-- Necesario para mostrar y guardar el mail operativo del usuario creado desde el panel.
alter table if exists public.profiles
  add column if not exists email text;

create unique index if not exists idx_profiles_email_unique_lower
  on public.profiles (lower(email))
  where email is not null;

-- Completa emails de perfiles existentes a partir de auth.users cuando sea posible.
update public.profiles p
set email = u.email
from auth.users u
where p.id = u.id
  and p.email is null;
