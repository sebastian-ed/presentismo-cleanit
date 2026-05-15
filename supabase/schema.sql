-- Clean It · Presentismo GPS
-- Ejecutar en Supabase SQL Editor.
-- Después crear usuarios en Authentication y agregar su perfil en public.profiles.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role text not null check (role in ('operator', 'supervisor')),
  phone text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sites (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text not null,
  lat double precision not null,
  lng double precision not null,
  gps_radius_m integer not null default 120 check (gps_radius_m between 10 and 1000),
  whatsapp_name text,
  whatsapp_phone text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.shifts (
  id uuid primary key default gen_random_uuid(),
  shift_date date not null,
  operator_id uuid not null references public.profiles(id) on delete restrict,
  site_id uuid not null references public.sites(id) on delete restrict,
  scheduled_start time not null,
  scheduled_end time not null,
  grace_minutes integer not null default 10 check (grace_minutes between 0 and 120),
  absence_after_minutes integer not null default 30 check (absence_after_minutes between 1 and 240),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shifts_end_after_start check (scheduled_end > scheduled_start)
);

create table if not exists public.attendance_events (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references public.shifts(id) on delete cascade,
  operator_id uuid not null references public.profiles(id) on delete restrict,
  site_id uuid not null references public.sites(id) on delete restrict,
  event_type text not null check (event_type in ('present', 'late', 'absent')),
  observed_status text check (observed_status in ('present', 'late', 'absent')),
  notes text,
  lat double precision,
  lng double precision,
  gps_accuracy_m double precision,
  distance_m double precision,
  is_inside_site boolean,
  client_time timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_profiles_role on public.profiles(role);
create index if not exists idx_sites_active on public.sites(is_active);
create index if not exists idx_shifts_date on public.shifts(shift_date);
create index if not exists idx_shifts_operator_date on public.shifts(operator_id, shift_date);
create index if not exists idx_attendance_shift_created on public.attendance_events(shift_id, created_at desc);
create index if not exists idx_attendance_operator_created on public.attendance_events(operator_id, created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists trg_sites_updated_at on public.sites;
create trigger trg_sites_updated_at
before update on public.sites
for each row execute function public.set_updated_at();

drop trigger if exists trg_shifts_updated_at on public.shifts;
create trigger trg_shifts_updated_at
before update on public.shifts
for each row execute function public.set_updated_at();

create or replace function public.is_supervisor()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'supervisor'
      and p.is_active = true
  );
$$;

alter table public.profiles enable row level security;
alter table public.sites enable row level security;
alter table public.shifts enable row level security;
alter table public.attendance_events enable row level security;

-- Limpieza de políticas para poder re-ejecutar el script sin conflictos.
drop policy if exists "profiles_select_own_or_supervisor" on public.profiles;
drop policy if exists "profiles_insert_supervisor" on public.profiles;
drop policy if exists "profiles_update_supervisor" on public.profiles;
drop policy if exists "sites_select_authenticated" on public.sites;
drop policy if exists "sites_write_supervisor" on public.sites;
drop policy if exists "shifts_select_own_or_supervisor" on public.shifts;
drop policy if exists "shifts_write_supervisor" on public.shifts;
drop policy if exists "attendance_select_own_or_supervisor" on public.attendance_events;
drop policy if exists "attendance_insert_own_or_supervisor" on public.attendance_events;

create policy "profiles_select_own_or_supervisor"
on public.profiles
for select
to authenticated
using (id = auth.uid() or public.is_supervisor());

create policy "profiles_insert_supervisor"
on public.profiles
for insert
to authenticated
with check (public.is_supervisor());

create policy "profiles_update_supervisor"
on public.profiles
for update
to authenticated
using (public.is_supervisor())
with check (public.is_supervisor());

create policy "sites_select_authenticated"
on public.sites
for select
to authenticated
using (is_active = true or public.is_supervisor());

create policy "sites_write_supervisor"
on public.sites
for all
to authenticated
using (public.is_supervisor())
with check (public.is_supervisor());

create policy "shifts_select_own_or_supervisor"
on public.shifts
for select
to authenticated
using (operator_id = auth.uid() or public.is_supervisor());

create policy "shifts_write_supervisor"
on public.shifts
for all
to authenticated
using (public.is_supervisor())
with check (public.is_supervisor());

create policy "attendance_select_own_or_supervisor"
on public.attendance_events
for select
to authenticated
using (operator_id = auth.uid() or public.is_supervisor());

create policy "attendance_insert_own_or_supervisor"
on public.attendance_events
for insert
to authenticated
with check (operator_id = auth.uid() or public.is_supervisor());

-- Vista útil para reportes externos o dashboards futuros.
create or replace view public.attendance_report as
select
  ae.id,
  ae.created_at,
  ae.client_time,
  ae.event_type,
  ae.observed_status,
  ae.notes,
  ae.lat,
  ae.lng,
  ae.gps_accuracy_m,
  ae.distance_m,
  ae.is_inside_site,
  s.shift_date,
  s.scheduled_start,
  s.scheduled_end,
  p.full_name as operator_name,
  p.phone as operator_phone,
  si.name as site_name,
  si.address as site_address,
  si.whatsapp_name,
  si.whatsapp_phone
from public.attendance_events ae
join public.shifts s on s.id = ae.shift_id
join public.profiles p on p.id = ae.operator_id
join public.sites si on si.id = ae.site_id;
