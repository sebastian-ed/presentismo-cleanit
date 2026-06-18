-- Clean It · Presentismo GPS
-- Migración desde la versión anterior con turnos por fecha hacia asignaciones semanales fijas.
-- Ejecutar en Supabase SQL Editor si ya habías conectado la primera versión de la app.

create extension if not exists pgcrypto;

drop view if exists public.attendance_report;

-- La versión nueva trabaja con PIN operativo y no depende de auth.users.
do $$
declare
  r record;
begin
  if to_regclass('public.profiles') is not null then
    for r in
      select c.conname
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_namespace n on n.oid = t.relnamespace
      where n.nspname = 'public'
        and t.relname = 'profiles'
        and c.contype = 'f'
        and c.confrelid = 'auth.users'::regclass
    loop
      execute format('alter table public.profiles drop constraint %I', r.conname);
    end loop;
  end if;
end $$;

alter table if exists public.profiles alter column id set default gen_random_uuid();
alter table if exists public.profiles add column if not exists pin text;
alter table if exists public.profiles add column if not exists notes text;
create unique index if not exists idx_profiles_pin_unique on public.profiles(pin) where pin is not null;

-- Agrega datos de servicio necesarios para la vista tipo planificador.
alter table if exists public.sites add column if not exists zone text;
alter table if exists public.sites add column if not exists supervisor_name text;
alter table if exists public.sites add column if not exists service_type text default 'fixed';

-- Nueva tabla de asignaciones fijas.
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

-- Si existían turnos puntuales, los migra como asignaciones limitadas a esa fecha.
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
  is_active
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
  'Migrado desde turno puntual anterior',
  coalesce(s.is_active, true)
from public.shifts s
where to_regclass('public.shifts') is not null
  and not exists (
    select 1
    from public.assignments a
    where a.operator_id = s.operator_id
      and a.site_id = s.site_id
      and a.valid_from = s.shift_date
      and a.valid_to = s.shift_date
      and a.scheduled_start = s.scheduled_start
      and a.scheduled_end = s.scheduled_end
  );

-- Ajusta attendance_events para aceptar shift_id materializado: assignment_id__fecha.
do $$
declare
  r record;
  shift_col_type text;
begin
  if to_regclass('public.attendance_events') is not null then
    for r in
      select c.conname
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_namespace n on n.oid = t.relnamespace
      where n.nspname = 'public'
        and t.relname = 'attendance_events'
        and c.contype = 'f'
        and exists (
          select 1
          from unnest(c.conkey) k
          join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k
          where a.attname = 'shift_id'
        )
    loop
      execute format('alter table public.attendance_events drop constraint %I', r.conname);
    end loop;

    select data_type into shift_col_type
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'attendance_events'
      and column_name = 'shift_id';

    if shift_col_type is not null and shift_col_type <> 'text' then
      execute 'alter table public.attendance_events alter column shift_id type text using shift_id::text';
    end if;
  end if;
end $$;

alter table if exists public.attendance_events add column if not exists assignment_id uuid references public.assignments(id) on delete set null;
alter table if exists public.attendance_events add column if not exists shift_date date;

update public.attendance_events ae
set shift_date = s.shift_date
from public.shifts s
where to_regclass('public.shifts') is not null
  and ae.shift_date is null
  and ae.shift_id = s.id::text;

update public.attendance_events
set shift_date = created_at::date
where shift_date is null;

alter table if exists public.attendance_events alter column shift_date set not null;

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

-- RLS apto para MVP interno con publishable/anon key.
alter table public.profiles enable row level security;
alter table public.sites enable row level security;
alter table public.assignments enable row level security;
alter table public.attendance_events enable row level security;

-- Quita políticas anteriores basadas en Supabase Auth, porque esta versión opera por PIN.
drop policy if exists "profiles_select_own_or_supervisor" on public.profiles;
drop policy if exists "profiles_insert_supervisor" on public.profiles;
drop policy if exists "profiles_update_supervisor" on public.profiles;
drop policy if exists "sites_select_authenticated" on public.sites;
drop policy if exists "sites_write_supervisor" on public.sites;
drop policy if exists "shifts_select_own_or_supervisor" on public.shifts;
drop policy if exists "shifts_write_supervisor" on public.shifts;
drop policy if exists "attendance_select_own_or_supervisor" on public.attendance_events;
drop policy if exists "attendance_insert_own_or_supervisor" on public.attendance_events;

drop policy if exists "app_read_profiles" on public.profiles;
drop policy if exists "app_write_profiles" on public.profiles;
drop policy if exists "app_read_sites" on public.sites;
drop policy if exists "app_write_sites" on public.sites;
drop policy if exists "app_read_assignments" on public.assignments;
drop policy if exists "app_write_assignments" on public.assignments;
drop policy if exists "app_read_attendance" on public.attendance_events;
drop policy if exists "app_write_attendance" on public.attendance_events;

create policy "app_read_profiles" on public.profiles for select using (true);
create policy "app_write_profiles" on public.profiles for all using (true) with check (true);
create policy "app_read_sites" on public.sites for select using (true);
create policy "app_write_sites" on public.sites for all using (true) with check (true);
create policy "app_read_assignments" on public.assignments for select using (true);
create policy "app_write_assignments" on public.assignments for all using (true) with check (true);
create policy "app_read_attendance" on public.attendance_events for select using (true);
create policy "app_write_attendance" on public.attendance_events for insert with check (true);

grant usage on schema public to anon, authenticated;
grant select, insert, update on public.profiles to anon, authenticated;
grant select, insert, update on public.sites to anon, authenticated;
grant select, insert, update on public.assignments to anon, authenticated;
grant select, insert on public.attendance_events to anon, authenticated;

-- PIN inicial de supervisor. Si ya existe un supervisor sin PIN, se lo asigna.
with first_supervisor as (
  select id
  from public.profiles
  where role = 'supervisor'
    and is_active = true
    and pin is null
  order by created_at nulls last
  limit 1
)
update public.profiles
set pin = '9999', notes = coalesce(notes, '') || case when coalesce(notes, '') = '' then '' else ' | ' end || 'PIN inicial agregado por migración. Cambiar desde la app.'
where id in (select id from first_supervisor)
  and not exists (select 1 from public.profiles where pin = '9999');

insert into public.profiles (full_name, role, phone, pin, notes)
select 'Supervisor Clean It', 'supervisor', '+5491100000000', '9999', 'Usuario inicial creado por migración. Cambiar PIN desde la app.'
where not exists (select 1 from public.profiles where pin = '9999')
  and not exists (select 1 from public.profiles where role = 'supervisor' and is_active = true);

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
