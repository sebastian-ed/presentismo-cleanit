-- Clean It · Presentismo GPS
-- Migración desde versión con PIN/local hacia Supabase Auth normal.
-- Ejecutar si ya tenés tablas creadas por versiones anteriores de esta app.

create extension if not exists pgcrypto;

drop view if exists public.attendance_report;

alter table if exists public.profiles add column if not exists auth_user_id uuid references auth.users(id) on delete set null;
alter table if exists public.profiles add column if not exists email text;
alter table if exists public.profiles add column if not exists notes text;
alter table if exists public.sites add column if not exists zone text;
alter table if exists public.sites add column if not exists supervisor_name text;
alter table if exists public.sites add column if not exists service_type text default 'fixed';

create unique index if not exists idx_profiles_auth_user_unique on public.profiles(auth_user_id) where auth_user_id is not null;
create unique index if not exists idx_profiles_email_unique_lower on public.profiles(lower(email)) where email is not null;

-- Nueva tabla de asignaciones fijas si todavía no existe.
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
  constraint assignments_start_end_different check (scheduled_end <> scheduled_start),
  constraint assignments_valid_range check (valid_to is null or valid_to >= valid_from),
  constraint assignments_days_valid check (days_of_week <@ array[1,2,3,4,5,6,7])
);

-- Si existían turnos puntuales, los migra como asignaciones limitadas al día del turno.
do $$
begin
  if to_regclass('public.shifts') is not null then
    insert into public.assignments (
      operator_id,
      site_id,
      days_of_week,
      scheduled_start,
      scheduled_end,
      grace_minutes,
      absence_after_minutes,
      valid_from,
      valid_to,
      notes,
      is_active,
      created_at,
      updated_at
    )
    select
      s.operator_id,
      s.site_id,
      array[case when extract(dow from s.shift_date)::int = 0 then 7 else extract(dow from s.shift_date)::int end],
      s.scheduled_start,
      s.scheduled_end,
      coalesce(s.grace_minutes, 10),
      coalesce(s.absence_after_minutes, 30),
      s.shift_date,
      s.shift_date,
      coalesce(s.notes, 'Migrado desde turno puntual'),
      coalesce(s.is_active, true),
      coalesce(s.created_at, now()),
      now()
    from public.shifts s
    where coalesce(s.is_active, true) = true
      and not exists (
        select 1 from public.assignments a
        where a.operator_id = s.operator_id
          and a.site_id = s.site_id
          and a.valid_from = s.shift_date
          and a.valid_to = s.shift_date
          and a.scheduled_start = s.scheduled_start
      );
  end if;
end $$;

alter table public.profiles enable row level security;
alter table public.sites enable row level security;
alter table public.assignments enable row level security;
alter table public.attendance_events enable row level security;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.current_profile_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.id
  from public.profiles p
  where p.auth_user_id = auth.uid()
    and p.is_active = true
  limit 1
$$;

create or replace function public.current_profile_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select p.role
  from public.profiles p
  where p.auth_user_id = auth.uid()
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

drop policy if exists "app_read_profiles" on public.profiles;
drop policy if exists "app_write_profiles" on public.profiles;
drop policy if exists "app_read_sites" on public.sites;
drop policy if exists "app_write_sites" on public.sites;
drop policy if exists "app_read_assignments" on public.assignments;
drop policy if exists "app_write_assignments" on public.assignments;
drop policy if exists "app_read_attendance" on public.attendance_events;
drop policy if exists "app_write_attendance" on public.attendance_events;
drop policy if exists "profiles_select_auth" on public.profiles;
drop policy if exists "profiles_insert_supervisor" on public.profiles;
drop policy if exists "profiles_update_supervisor" on public.profiles;
drop policy if exists "profiles_link_own_auth" on public.profiles;
drop policy if exists "sites_select_auth" on public.sites;
drop policy if exists "sites_write_supervisor" on public.sites;
drop policy if exists "assignments_select_relevant" on public.assignments;
drop policy if exists "assignments_write_supervisor" on public.assignments;
drop policy if exists "attendance_select_relevant" on public.attendance_events;
drop policy if exists "attendance_insert_relevant" on public.attendance_events;

create policy "profiles_select_auth"
on public.profiles
for select
to authenticated
using (
  public.is_supervisor()
  or auth_user_id = auth.uid()
  or lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
);

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

create policy "profiles_link_own_auth"
on public.profiles
for update
to authenticated
using (
  auth_user_id is null
  and lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
)
with check (
  auth_user_id = auth.uid()
  and lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
);

create policy "sites_select_auth" on public.sites for select to authenticated using (true);
create policy "sites_write_supervisor" on public.sites for all to authenticated using (public.is_supervisor()) with check (public.is_supervisor());

create policy "assignments_select_relevant"
on public.assignments
for select
to authenticated
using (public.is_supervisor() or operator_id = public.current_profile_id());

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
using (public.is_supervisor() or operator_id = public.current_profile_id());

create policy "attendance_insert_relevant"
on public.attendance_events
for insert
to authenticated
with check (public.is_supervisor() or operator_id = public.current_profile_id());

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
  p.email as operator_email,
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
