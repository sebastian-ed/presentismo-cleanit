-- Clean It · Presentismo GPS
-- Migración para el esquema que ya tenés creado.
-- Compatible con profiles.id = auth.users.id.
-- Ejecutar una sola vez en Supabase SQL Editor antes de subir esta versión.

create extension if not exists pgcrypto;

drop view if exists public.attendance_report;

alter table public.profiles
  add column if not exists notes text;

alter table public.sites
  add column if not exists zone text,
  add column if not exists supervisor_name text,
  add column if not exists service_type text default 'fixed';

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

alter table public.attendance_events
  drop constraint if exists attendance_events_shift_id_fkey;

alter table public.attendance_events
  add column if not exists assignment_id uuid references public.assignments(id) on delete set null,
  add column if not exists shift_date date;

alter table public.attendance_events
  alter column shift_id type text using shift_id::text;

update public.attendance_events ae
set shift_date = s.shift_date
from public.shifts s
where ae.shift_date is null
  and ae.shift_id = s.id::text;

update public.attendance_events
set shift_date = current_date
where shift_date is null;

alter table public.attendance_events
  alter column shift_date set not null;

-- Compatibilidad con registro de salida.
do $$
declare
  r record;
begin
  for r in
    select c.conname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'attendance_events'
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%event_type%'
  loop
    execute format('alter table public.attendance_events drop constraint if exists %I', r.conname);
  end loop;

  for r in
    select c.conname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'attendance_events'
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%observed_status%'
  loop
    execute format('alter table public.attendance_events drop constraint if exists %I', r.conname);
  end loop;
end $$;

alter table public.attendance_events
  add constraint attendance_events_event_type_check
  check (event_type in ('present', 'checkout', 'late', 'absent'));

alter table public.attendance_events
  add constraint attendance_events_observed_status_check
  check (observed_status in ('present', 'late', 'absent', 'on_time_exit', 'early_exit'));

create index if not exists idx_profiles_role on public.profiles(role);
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
  select coalesce(public.current_profile_role() = 'supervisor', false)
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
drop policy if exists "shifts_select_own_or_supervisor" on public.shifts;
drop policy if exists "shifts_write_supervisor" on public.shifts;
drop policy if exists "assignments_select_relevant" on public.assignments;
drop policy if exists "assignments_write_supervisor" on public.assignments;
drop policy if exists "attendance_select_own_or_supervisor" on public.attendance_events;
drop policy if exists "attendance_insert_own_or_supervisor" on public.attendance_events;
drop policy if exists "attendance_select_relevant" on public.attendance_events;
drop policy if exists "attendance_insert_relevant" on public.attendance_events;

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

revoke all on public.profiles from anon;
revoke all on public.sites from anon;
revoke all on public.assignments from anon;
revoke all on public.attendance_events from anon;

grant usage on schema public to authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select, insert, update on public.sites to authenticated;
grant select, insert, update on public.assignments to authenticated;
grant select, insert on public.attendance_events to authenticated;

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
