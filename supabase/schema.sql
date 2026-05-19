-- Clean It · Presentismo GPS con asignaciones semanales fijas
-- Ejecutar en Supabase SQL Editor.
-- Modelo práctico con acceso por PIN desde la app. Para seguridad corporativa estricta,
-- conviene reemplazar PIN por Supabase Auth + Edge Function de administración de usuarios.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  role text not null check (role in ('operator', 'supervisor')),
  phone text,
  pin text not null unique,
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sites (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text not null,
  zone text,
  supervisor_name text,
  service_type text default 'fixed',
  lat double precision not null,
  lng double precision not null,
  gps_radius_m integer not null default 120 check (gps_radius_m between 10 and 1000),
  whatsapp_name text,
  whatsapp_phone text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.assignments (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null references public.profiles(id) on delete restrict,
  site_id uuid not null references public.sites(id) on delete restrict,
  days_of_week integer[] not null check (array_length(days_of_week, 1) >= 1),
  scheduled_start time not null,
  scheduled_end time not null,
  grace_minutes integer not null default 10 check (grace_minutes between 0 and 120),
  absence_after_minutes integer not null default 30 check (absence_after_minutes between 1 and 240),
  valid_from date not null default current_date,
  valid_to date,
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint assignments_end_after_start check (scheduled_end > scheduled_start),
  constraint assignments_valid_range check (valid_to is null or valid_to >= valid_from),
  constraint assignments_days_valid check (days_of_week <@ array[1,2,3,4,5,6,7])
);

create table if not exists public.attendance_events (
  id uuid primary key default gen_random_uuid(),
  shift_id text not null,
  assignment_id uuid references public.assignments(id) on delete set null,
  shift_date date not null,
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
create index if not exists idx_profiles_pin on public.profiles(pin);
create index if not exists idx_sites_active on public.sites(is_active);
create index if not exists idx_assignments_operator on public.assignments(operator_id);
create index if not exists idx_assignments_site on public.assignments(site_id);
create index if not exists idx_assignments_active on public.assignments(is_active);
create index if not exists idx_attendance_shift_created on public.attendance_events(shift_id, created_at desc);
create index if not exists idx_attendance_date on public.attendance_events(shift_date);
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

drop trigger if exists trg_assignments_updated_at on public.assignments;
create trigger trg_assignments_updated_at
before update on public.assignments
for each row execute function public.set_updated_at();

-- RLS simple para MVP interno. La anon key puede operar la app.
-- Para hardening real: usar Supabase Auth, roles, Edge Functions y políticas por usuario.
alter table public.profiles enable row level security;
alter table public.sites enable row level security;
alter table public.assignments enable row level security;
alter table public.attendance_events enable row level security;

drop policy if exists "app_read_profiles" on public.profiles;
create policy "app_read_profiles" on public.profiles for select using (true);
drop policy if exists "app_write_profiles" on public.profiles;
create policy "app_write_profiles" on public.profiles for all using (true) with check (true);

drop policy if exists "app_read_sites" on public.sites;
create policy "app_read_sites" on public.sites for select using (true);
drop policy if exists "app_write_sites" on public.sites;
create policy "app_write_sites" on public.sites for all using (true) with check (true);

drop policy if exists "app_read_assignments" on public.assignments;
create policy "app_read_assignments" on public.assignments for select using (true);
drop policy if exists "app_write_assignments" on public.assignments;
create policy "app_write_assignments" on public.assignments for all using (true) with check (true);

drop policy if exists "app_read_attendance" on public.attendance_events;
create policy "app_read_attendance" on public.attendance_events for select using (true);
drop policy if exists "app_write_attendance" on public.attendance_events;
create policy "app_write_attendance" on public.attendance_events for insert with check (true);

-- Bootstrap opcional para poder entrar por primera vez.
insert into public.profiles (full_name, role, phone, pin, notes)
values ('Supervisor Clean It', 'supervisor', '+5491100000000', '9999', 'Usuario inicial')
on conflict (pin) do nothing;
