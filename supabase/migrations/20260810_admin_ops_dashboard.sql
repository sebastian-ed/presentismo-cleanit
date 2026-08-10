-- Clean It · Presentismo GPS
-- Habilita el rol "admin" con los mismos permisos operativos de lectura/escritura
-- que hoy usa el rol "supervisor". No modifica datos existentes.

begin;

-- Ampliar el constraint de roles sin afectar perfiles existentes.
alter table public.profiles
  drop constraint if exists profiles_role_check;

alter table public.profiles
  add constraint profiles_role_check
  check (role in ('operator', 'supervisor', 'admin'));

-- Las políticas RLS existentes llaman a public.is_supervisor().
-- Se conserva el nombre para no romper dependencias, pero ahora también acepta admin.
create or replace function public.is_supervisor()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_profile_role() in ('supervisor', 'admin'), false)
$$;

commit;
