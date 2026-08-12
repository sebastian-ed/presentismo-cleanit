-- Clean It · Presentismo GPS
-- Francos rotativos + fichaje manual supervisor/admin + borrado seguro de marcaciones.

begin;

alter table public.attendance_events
  add column if not exists recorded_via text,
  add column if not exists recorded_by uuid references public.profiles(id) on delete set null;

alter table public.attendance_events
  drop constraint if exists attendance_events_event_type_check;
alter table public.attendance_events
  add constraint attendance_events_event_type_check
  check (event_type in ('present', 'checkout', 'late', 'absent', 'day_off'));

alter table public.attendance_events
  drop constraint if exists attendance_events_observed_status_check;
alter table public.attendance_events
  add constraint attendance_events_observed_status_check
  check (observed_status is null or observed_status in ('present', 'late', 'absent', 'on_time_exit', 'early_exit', 'day_off'));

alter table public.attendance_events
  drop constraint if exists attendance_events_recorded_via_check;
alter table public.attendance_events
  add constraint attendance_events_recorded_via_check
  check (recorded_via is null or recorded_via in ('operator', 'supervisor_manual', 'system_auto'));

create index if not exists idx_attendance_recorded_by on public.attendance_events(recorded_by);

create table if not exists public.attendance_event_deletions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null,
  event_snapshot jsonb not null,
  deleted_by uuid references public.profiles(id) on delete set null,
  deleted_at timestamptz not null default now()
);

alter table public.attendance_event_deletions enable row level security;

drop policy if exists "attendance_deletions_select_supervisor" on public.attendance_event_deletions;
create policy "attendance_deletions_select_supervisor"
on public.attendance_event_deletions
for select
to authenticated
using (public.is_supervisor());

revoke all on public.attendance_event_deletions from anon;
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

commit;
