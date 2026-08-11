-- Clean It · Presentismo GPS
-- Instalación limpia compatible con tu esquema de Auth actual.
-- Regla central: public.profiles.id = auth.users.id.

create extension if not exists pgcrypto;

drop view if exists public.attendance_report;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text,
  email text,
  pending_recovery_email text,
  recovery_requested_at timestamptz,
  full_name text not null,
  role text not null check (role in ('operator', 'supervisor', 'admin')),
  phone text,
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
  assignment_type text not null default 'fixed' check (assignment_type in ('fixed', 'coverage', 'reinforcement')),
  covered_operator_id uuid references public.profiles(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  suppress_regular_assignments boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint assignments_duration_nonzero check (scheduled_end <> scheduled_start),
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
  event_type text not null check (event_type in ('present', 'checkout', 'late', 'absent')),
  observed_status text check (observed_status in ('present', 'late', 'absent', 'on_time_exit', 'early_exit')),
  work_type text not null default 'regular' check (work_type in ('regular', 'coverage', 'reinforcement')),
  entry_source text not null default 'assignment' check (entry_source in ('assignment', 'operator_extra')),
  validation_status text not null default 'confirmed' check (validation_status in ('confirmed', 'pending', 'rejected')),
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
create unique index if not exists idx_profiles_username_unique_lower on public.profiles(lower(username)) where username is not null and btrim(username) <> '';
create unique index if not exists idx_profiles_email_unique_lower on public.profiles(lower(email)) where email is not null and btrim(email) <> '';
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

create or replace function public.current_profile_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select p.role
  from public.profiles p
  where p.id = auth.uid()
    and p.is_active = true
  limit 1
$$;

create or replace function public.is_supervisor()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_profile_role() in ('supervisor', 'admin'), false)
$$;

alter table public.profiles enable row level security;
alter table public.sites enable row level security;
alter table public.assignments enable row level security;
alter table public.attendance_events enable row level security;

drop policy if exists "profiles_select_own_or_supervisor" on public.profiles;
drop policy if exists "profiles_insert_supervisor" on public.profiles;
drop policy if exists "profiles_update_supervisor" on public.profiles;
drop policy if exists "profiles_select_auth" on public.profiles;
drop policy if exists "profiles_link_own_auth" on public.profiles;
drop policy if exists "sites_select_authenticated" on public.sites;
drop policy if exists "sites_select_auth" on public.sites;
drop policy if exists "sites_write_supervisor" on public.sites;
drop policy if exists "assignments_select_relevant" on public.assignments;
drop policy if exists "assignments_write_supervisor" on public.assignments;
drop policy if exists "attendance_select_own_or_supervisor" on public.attendance_events;
drop policy if exists "attendance_insert_own_or_supervisor" on public.attendance_events;
drop policy if exists "attendance_select_relevant" on public.attendance_events;
drop policy if exists "attendance_insert_relevant" on public.attendance_events;
drop policy if exists "attendance_update_supervisor" on public.attendance_events;

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
using (true);

create policy "sites_write_supervisor"
on public.sites
for all
to authenticated
using (public.is_supervisor())
with check (public.is_supervisor());

create policy "assignments_select_relevant"
on public.assignments
for select
to authenticated
using (public.is_supervisor() or operator_id = auth.uid());

create policy "assignments_write_supervisor"
on public.assignments
for all
to authenticated
using (public.is_supervisor())
with check (public.is_supervisor());

create policy "attendance_select_relevant"
on public.attendance_events
for select
to authenticated
using (public.is_supervisor() or operator_id = auth.uid());

create policy "attendance_insert_relevant"
on public.attendance_events
for insert
to authenticated
with check (public.is_supervisor() or operator_id = auth.uid());

create policy "attendance_update_supervisor"
on public.attendance_events
for update
to authenticated
using (public.is_supervisor())
with check (public.is_supervisor());

revoke all on public.profiles from anon;
revoke all on public.sites from anon;
revoke all on public.assignments from anon;
revoke all on public.attendance_events from anon;

grant usage on schema public to authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select, insert, update on public.sites to authenticated;
grant select, insert, update on public.assignments to authenticated;
grant select, insert, update on public.attendance_events to authenticated;

create or replace view public.attendance_report
with (security_invoker = true)
as
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
  ae.shift_id,
  ae.shift_date,
  a.scheduled_start,
  a.scheduled_end,
  a.days_of_week,
  p.full_name as operator_name,
  p.phone as operator_phone,
  si.name as site_name,
  si.address as site_address,
  si.zone as site_zone,
  si.supervisor_name,
  si.whatsapp_name,
  si.whatsapp_phone
from public.attendance_events ae
left join public.assignments a on a.id = ae.assignment_id
left join public.profiles p on p.id = ae.operator_id
left join public.sites si on si.id = ae.site_id;

grant select on public.attendance_report to authenticated;
