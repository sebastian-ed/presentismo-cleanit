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
  event_type text not null check (event_type in ('present', 'checkout', 'late', 'absent', 'day_off')),
  observed_status text check (observed_status in ('present', 'late', 'absent', 'on_time_exit', 'early_exit', 'day_off')),
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
  recorded_via text check (recorded_via is null or recorded_via in ('operator', 'supervisor_manual', 'system_auto')),
  recorded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.attendance_event_deletions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null,
  event_snapshot jsonb not null,
  deleted_by uuid references public.profiles(id) on delete set null,
  deleted_at timestamptz not null default now()
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
create index if not exists idx_attendance_recorded_by on public.attendance_events(recorded_by);

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
alter table public.attendance_event_deletions enable row level security;

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

drop policy if exists "attendance_deletions_select_supervisor" on public.attendance_event_deletions;
create policy "attendance_deletions_select_supervisor"
on public.attendance_event_deletions
for select
to authenticated
using (public.is_supervisor());

revoke all on public.profiles from anon;
revoke all on public.sites from anon;
revoke all on public.assignments from anon;
revoke all on public.attendance_events from anon;
revoke all on public.attendance_event_deletions from anon;

grant usage on schema public to authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select, insert, update on public.sites to authenticated;
grant select, insert, update on public.assignments to authenticated;
grant select, insert, update on public.attendance_events to authenticated;
grant select on public.attendance_event_deletions to authenticated;

create or replace function public.mark_shift_day_off(
  p_shift_id text,
  p_assignment_id uuid,
  p_shift_date date,
  p_operator_id uuid,
  p_site_id uuid,
  p_work_type text default 'regular',
  p_notes text default null
)
returns public.attendance_events
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.attendance_events;
begin
  if not public.is_supervisor() then
    raise exception 'No tenés permisos para marcar francos.';
  end if;

  if exists (
    select 1 from public.attendance_events
    where shift_id = p_shift_id and event_type in ('present', 'checkout')
  ) then
    raise exception 'Este turno ya tiene una entrada o salida registrada. No puede marcarse como franco.';
  end if;

  -- Reemplaza una ausencia/demora automática o un franco previo por una sola marca de franco.
  delete from public.attendance_events
  where shift_id = p_shift_id
    and event_type in ('late', 'absent', 'day_off');

  insert into public.attendance_events (
    shift_id, assignment_id, shift_date, operator_id, site_id,
    event_type, observed_status, work_type, entry_source, validation_status,
    notes, lat, lng, gps_accuracy_m, distance_m, is_inside_site,
    client_time, recorded_via, recorded_by
  ) values (
    p_shift_id, p_assignment_id, p_shift_date, p_operator_id, p_site_id,
    'day_off', 'day_off', coalesce(nullif(p_work_type, ''), 'regular'), 'assignment', 'confirmed',
    nullif(btrim(p_notes), ''), null, null, null, null, null,
    now(), 'supervisor_manual', auth.uid()
  )
  returning * into v_event;

  return v_event;
end;
$$;

create or replace function public.clear_shift_day_off(p_shift_id text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if not public.is_supervisor() then
    raise exception 'No tenés permisos para quitar francos.';
  end if;

  delete from public.attendance_events
  where shift_id = p_shift_id and event_type = 'day_off';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.secure_delete_attendance_events(
  p_ids uuid[],
  p_confirmation text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if not public.is_supervisor() then
    raise exception 'No tenés permisos para eliminar registros.';
  end if;

  if coalesce(p_confirmation, '') <> 'ELIMINAR REGISTROS' then
    raise exception 'Frase de confirmación incorrecta.';
  end if;

  if p_ids is null or array_length(p_ids, 1) is null then
    return 0;
  end if;

  insert into public.attendance_event_deletions (event_id, event_snapshot, deleted_by)
  select ae.id, to_jsonb(ae), auth.uid()
  from public.attendance_events ae
  where ae.id = any(p_ids);

  delete from public.attendance_events
  where id = any(p_ids);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

grant execute on function public.mark_shift_day_off(text, uuid, date, uuid, uuid, text, text) to authenticated;
grant execute on function public.clear_shift_day_off(text) to authenticated;
grant execute on function public.secure_delete_attendance_events(uuid[], text) to authenticated;

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

-- -----------------------------------------------------------------------------
-- Cierre automático de salidas faltantes (implementado 2026-08-20)
-- En instalaciones nuevas, aplicar también migrations/20260820_auto_checkout_missing_exit.sql
-- para registrar el cron job de pg_cron.
create or replace function public.auto_close_overdue_shifts()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
begin
  with open_entries as (
    select distinct on (e.shift_id)
      e.shift_id, e.assignment_id, e.shift_date, e.operator_id, e.site_id,
      coalesce(nullif(e.work_type, ''), 'regular') as work_type,
      coalesce(nullif(e.entry_source, ''), 'assignment') as entry_source,
      coalesce(nullif(e.validation_status, ''), 'confirmed') as validation_status,
      coalesce(e.client_time, e.created_at) as entry_at,
      a.scheduled_start, a.scheduled_end,
      (e.shift_date::timestamp + a.scheduled_end
        + case when a.scheduled_end <= a.scheduled_start then interval '1 day' else interval '0 day' end)
        at time zone 'America/Argentina/Buenos_Aires' as scheduled_end_at
    from public.attendance_events e
    join public.assignments a on a.id = e.assignment_id
    where e.event_type = 'present'
      and e.assignment_id is not null
      and e.shift_date >= date '2026-08-20'
      and not exists (
        select 1 from public.attendance_events x
        where x.shift_id = e.shift_id and x.event_type = 'checkout'
      )
    order by e.shift_id, coalesce(e.client_time, e.created_at) desc
  ), due as (
    select * from open_entries
    where now() >= greatest(scheduled_end_at, entry_at) + interval '45 minutes'
  ), inserted as (
    insert into public.attendance_events (
      shift_id, assignment_id, shift_date, operator_id, site_id,
      event_type, observed_status, work_type, entry_source, validation_status,
      notes, lat, lng, gps_accuracy_m, distance_m, is_inside_site,
      client_time, recorded_via, recorded_by
    )
    select
      d.shift_id, d.assignment_id, d.shift_date, d.operator_id, d.site_id,
      'checkout', 'on_time_exit', d.work_type, d.entry_source, d.validation_status,
      'Cierre automático del sistema: el operario no registró la salida. Horario programado de salida: '
        || to_char(d.scheduled_end_at at time zone 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY HH24:MI')
        || '. El sistema ejecutó el cierre a las '
        || to_char(now() at time zone 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY HH24:MI')
        || ' luego de superar 45 minutos sin marcación. Para el cómputo de horas, la salida se imputó al horario programado.',
      null, null, null, null, null,
      greatest(d.scheduled_end_at, d.entry_at), 'system_auto', null
    from due d
    where not exists (
      select 1 from public.attendance_events x
      where x.shift_id = d.shift_id and x.event_type = 'checkout'
    )
    returning id
  )
  select count(*) into v_count from inserted;
  return v_count;
end;
$$;

revoke all on function public.auto_close_overdue_shifts() from public;
grant execute on function public.auto_close_overdue_shifts() to authenticated;

-- -----------------------------------------------------------------------------
-- Horas extra autorizadas (2026-09-08)
-- Para bases ya desplegadas, ejecutar migrations/20260908_overtime_authorizations.sql.
-- Clean It · Presentismo GPS
-- Horas extra autorizadas por supervisor/admin.
-- Objetivo: permitir que el operario continúe trabajando y fiche su salida real
-- sin que el cierre automático corte el turno, pero solo cuando exista una
-- autorización explícita cargada por un perfil de gestión.

begin;

create table if not exists public.overtime_authorizations (
  id uuid primary key default gen_random_uuid(),
  shift_id text not null unique,
  assignment_id uuid references public.assignments(id) on delete set null,
  shift_date date not null,
  operator_id uuid not null references public.profiles(id) on delete restrict,
  site_id uuid not null references public.sites(id) on delete restrict,
  authorized_until timestamptz not null,
  notes text,
  approved_by uuid not null references public.profiles(id) on delete restrict,
  approved_by_name text,
  approved_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_overtime_shift_date on public.overtime_authorizations(shift_date);
create index if not exists idx_overtime_operator on public.overtime_authorizations(operator_id, shift_date desc);
create index if not exists idx_overtime_active on public.overtime_authorizations(shift_id) where revoked_at is null;

alter table public.overtime_authorizations enable row level security;

drop policy if exists "overtime_select_relevant" on public.overtime_authorizations;
create policy "overtime_select_relevant"
on public.overtime_authorizations
for select
to authenticated
using (public.is_supervisor() or operator_id = auth.uid());

drop policy if exists "overtime_write_supervisor" on public.overtime_authorizations;
create policy "overtime_write_supervisor"
on public.overtime_authorizations
for all
to authenticated
using (public.is_supervisor())
with check (public.is_supervisor());

revoke all on public.overtime_authorizations from anon;
grant select, insert, update on public.overtime_authorizations to authenticated;

drop trigger if exists trg_overtime_authorizations_updated_at on public.overtime_authorizations;
create trigger trg_overtime_authorizations_updated_at
before update on public.overtime_authorizations
for each row execute function public.set_updated_at();

create or replace function public.set_overtime_authorization(
  p_shift_id text,
  p_authorized_until timestamptz,
  p_notes text default null
)
returns public.overtime_authorizations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry record;
  v_scheduled_end_at timestamptz;
  v_approver_name text;
  v_row public.overtime_authorizations;
begin
  if not public.is_supervisor() then
    raise exception 'Solo un supervisor o administrador puede autorizar horas extra.';
  end if;

  select distinct on (e.shift_id)
    e.shift_id, e.assignment_id, e.shift_date, e.operator_id, e.site_id,
    a.scheduled_start, a.scheduled_end
  into v_entry
  from public.attendance_events e
  join public.assignments a on a.id = e.assignment_id
  where e.shift_id = p_shift_id
    and e.event_type = 'present'
    and e.assignment_id is not null
  order by e.shift_id, coalesce(e.client_time, e.created_at) desc;

  if not found then
    raise exception 'El turno debe tener una entrada registrada antes de autorizar horas extra.';
  end if;

  if exists (
    select 1 from public.attendance_events x
    where x.shift_id = p_shift_id and x.event_type = 'checkout'
  ) then
    raise exception 'El turno ya tiene una salida registrada y no puede extenderse.';
  end if;

  v_scheduled_end_at := (
    v_entry.shift_date::timestamp
    + v_entry.scheduled_end
    + case when v_entry.scheduled_end <= v_entry.scheduled_start then interval '1 day' else interval '0 day' end
  ) at time zone 'America/Argentina/Buenos_Aires';

  if p_authorized_until is null or p_authorized_until <= v_scheduled_end_at then
    raise exception 'La hora autorizada debe ser posterior al horario programado de salida.';
  end if;

  if p_authorized_until <= now() then
    raise exception 'La autorización debe finalizar en una hora futura.';
  end if;

  if p_authorized_until > v_scheduled_end_at + interval '12 hours' then
    raise exception 'La extensión supera 12 horas. Revisá la hora ingresada.';
  end if;

  select coalesce(full_name, 'Supervisor/Administrador')
  into v_approver_name
  from public.profiles
  where id = auth.uid();

  insert into public.overtime_authorizations (
    shift_id, assignment_id, shift_date, operator_id, site_id,
    authorized_until, notes, approved_by, approved_by_name,
    approved_at, revoked_at, revoked_by
  ) values (
    v_entry.shift_id, v_entry.assignment_id, v_entry.shift_date, v_entry.operator_id, v_entry.site_id,
    p_authorized_until, nullif(btrim(coalesce(p_notes, '')), ''), auth.uid(), v_approver_name,
    now(), null, null
  )
  on conflict (shift_id) do update set
    assignment_id = excluded.assignment_id,
    shift_date = excluded.shift_date,
    operator_id = excluded.operator_id,
    site_id = excluded.site_id,
    authorized_until = excluded.authorized_until,
    notes = excluded.notes,
    approved_by = excluded.approved_by,
    approved_by_name = excluded.approved_by_name,
    approved_at = now(),
    revoked_at = null,
    revoked_by = null,
    updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.revoke_overtime_authorization(p_shift_id text)
returns public.overtime_authorizations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.overtime_authorizations;
begin
  if not public.is_supervisor() then
    raise exception 'Solo un supervisor o administrador puede quitar una autorización de horas extra.';
  end if;

  update public.overtime_authorizations
  set revoked_at = now(), revoked_by = auth.uid(), updated_at = now()
  where shift_id = p_shift_id
    and revoked_at is null
  returning * into v_row;

  if v_row.shift_id is null then
    raise exception 'No hay una autorización activa de horas extra para este turno.';
  end if;

  return v_row;
end;
$$;

revoke all on function public.set_overtime_authorization(text, timestamptz, text) from public;
grant execute on function public.set_overtime_authorization(text, timestamptz, text) to authenticated;
revoke all on function public.revoke_overtime_authorization(text) from public;
grant execute on function public.revoke_overtime_authorization(text) to authenticated;

-- Reemplaza la lógica del cierre automático: si hay horas extra autorizadas,
-- el turno recién puede cerrarse automáticamente 45 minutos después del límite aprobado.
create or replace function public.auto_close_overdue_shifts()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
begin
  with open_entries as (
    select distinct on (e.shift_id)
      e.shift_id,
      e.assignment_id,
      e.shift_date,
      e.operator_id,
      e.site_id,
      coalesce(nullif(e.work_type, ''), 'regular') as work_type,
      coalesce(nullif(e.entry_source, ''), 'assignment') as entry_source,
      coalesce(nullif(e.validation_status, ''), 'confirmed') as validation_status,
      coalesce(e.client_time, e.created_at) as entry_at,
      a.scheduled_start,
      a.scheduled_end,
      (
        e.shift_date::timestamp
        + a.scheduled_end
        + case when a.scheduled_end <= a.scheduled_start then interval '1 day' else interval '0 day' end
      ) at time zone 'America/Argentina/Buenos_Aires' as scheduled_end_at,
      case when oa.revoked_at is null then oa.authorized_until else null end as overtime_until,
      case when oa.revoked_at is null then oa.approved_by_name else null end as overtime_approver
    from public.attendance_events e
    join public.assignments a on a.id = e.assignment_id
    left join public.overtime_authorizations oa on oa.shift_id = e.shift_id
    where e.event_type = 'present'
      and e.assignment_id is not null
      and e.shift_date >= date '2026-08-20'
      and not exists (
        select 1
        from public.attendance_events x
        where x.shift_id = e.shift_id
          and x.event_type = 'checkout'
      )
    order by e.shift_id, coalesce(e.client_time, e.created_at) desc
  ), due as (
    select *, greatest(scheduled_end_at, entry_at, coalesce(overtime_until, scheduled_end_at)) as effective_end_at
    from open_entries
    where now() >= greatest(scheduled_end_at, entry_at, coalesce(overtime_until, scheduled_end_at)) + interval '45 minutes'
  ), inserted as (
    insert into public.attendance_events (
      shift_id,
      assignment_id,
      shift_date,
      operator_id,
      site_id,
      event_type,
      observed_status,
      work_type,
      entry_source,
      validation_status,
      notes,
      lat,
      lng,
      gps_accuracy_m,
      distance_m,
      is_inside_site,
      client_time,
      recorded_via,
      recorded_by
    )
    select
      d.shift_id,
      d.assignment_id,
      d.shift_date,
      d.operator_id,
      d.site_id,
      'checkout',
      'on_time_exit',
      d.work_type,
      d.entry_source,
      d.validation_status,
      'Cierre automático del sistema: el operario no registró la salida. '
        || case when d.overtime_until is not null then
          'Había horas extra autorizadas hasta '
          || to_char(d.overtime_until at time zone 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY HH24:MI')
          || coalesce(' por ' || d.overtime_approver, '') || '. '
        else
          'Horario programado de salida: '
          || to_char(d.scheduled_end_at at time zone 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY HH24:MI') || '. '
        end
        || 'El sistema ejecutó el cierre a las '
        || to_char(now() at time zone 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY HH24:MI')
        || ' luego de superar 45 minutos sin marcación. Para el cómputo de horas, la salida se imputó al último horario autorizado.',
      null,
      null,
      null,
      null,
      null,
      d.effective_end_at,
      'system_auto',
      null
    from due d
    where not exists (
      select 1
      from public.attendance_events x
      where x.shift_id = d.shift_id
        and x.event_type = 'checkout'
    )
    returning id
  )
  select count(*) into v_count from inserted;

  return v_count;
end;
$$;

revoke all on function public.auto_close_overdue_shifts() from public;
grant execute on function public.auto_close_overdue_shifts() to authenticated;

commit;
