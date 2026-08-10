-- Clean It · usuarios con nombre de usuario + email real de recuperación
-- Ejecutar una sola vez antes de publicar la nueva versión.

alter table if exists public.profiles
  add column if not exists username text,
  add column if not exists email text;

-- Trae el email actual de Supabase Auth al perfil cuando falte.
update public.profiles p
set email = lower(u.email)
from auth.users u
where p.id = u.id
  and (p.email is null or btrim(p.email) = '');

-- Recupera automáticamente los usernames de los operarios históricos
-- que fueron creados como usuario@cleanit.ar.
update public.profiles
set username = lower(split_part(email, '@', 1))
where (username is null or btrim(username) = '')
  and lower(coalesce(email, '')) like '%@cleanit.ar';

-- Si ya había username en user_metadata, también lo toma.
update public.profiles p
set username = lower(u.raw_user_meta_data ->> 'username')
from auth.users u
where p.id = u.id
  and (p.username is null or btrim(p.username) = '')
  and coalesce(u.raw_user_meta_data ->> 'username', '') <> '';

create unique index if not exists idx_profiles_username_unique_lower
  on public.profiles (lower(username))
  where username is not null and btrim(username) <> '';

create unique index if not exists idx_profiles_email_unique_lower
  on public.profiles (lower(email))
  where email is not null and btrim(email) <> '';

create index if not exists idx_profiles_username_lookup
  on public.profiles (username)
  where is_active = true;

comment on column public.profiles.username is 'Nombre de usuario normalizado usado para ingresar a Presentismo GPS.';
comment on column public.profiles.email is 'Email real asociado a Supabase Auth y usado para recuperación de contraseña.';
