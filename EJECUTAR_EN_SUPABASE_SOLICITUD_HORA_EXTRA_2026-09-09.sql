-- Clean It · Presentismo GPS
-- Solicitud de horas extra por operario + aprobación posterior supervisor/admin.
-- Complementa la migración 20260908_overtime_authorizations.sql.
-- Una solicitud PENDIENTE posterga técnicamente el cierre automático hasta
-- 45 minutos después del horario solicitado, pero NO constituye aprobación.

begin;

create table if not exists public.overtime_requests (
  id uuid primary key default gen_random_uuid(),
  shift_id text not null unique,
  assignment_id uuid references public.assignments(id) on delete set null,
  shift_date date not null,
  operator_id uuid not null references public.profiles(id) on delete restrict,
  site_id uuid not null references public.sites(id) on delete restrict,
  requested_until timestamptz not null,
  reason text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  requested_at timestamptz not null default now(),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_by_name text,
  reviewed_at timestamptz,
  review_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_overtime_requests_shift_date on public.overtime_requests(shift_date);
create index if not exists idx_overtime_requests_operator on public.overtime_requests(operator_id, shift_date desc);
create index if not exists idx_overtime_requests_pending on public.overtime_requests(shift_id) where status = 'pending';

alter table public.overtime_requests enable row level security;

drop policy if exists "overtime_requests_select_relevant" on public.overtime_requests;
create policy "overtime_requests_select_relevant"
on public.overtime_requests
for select
to authenticated
using (public.is_supervisor() or operator_id = auth.uid());

drop policy if exists "overtime_requests_write_supervisor" on public.overtime_requests;
create policy "overtime_requests_write_supervisor"
on public.overtime_requests
for all
to authenticated
using (public.is_supervisor())
with check (public.is_supervisor());

revoke all on public.overtime_requests from anon;
grant select on public.overtime_requests to authenticated;
grant insert, update on public.overtime_requests to authenticated;

drop trigger if exists trg_overtime_requests_updated_at on public.overtime_requests;
create trigger trg_overtime_requests_updated_at
before update on public.overtime_requests
for each row execute function public.set_updated_at();

create or replace function public.request_overtime_extension(
  p_shift_id text,
  p_requested_until timestamptz,
  p_reason text
)
returns public.overtime_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry record;
  v_scheduled_end_at timestamptz;
  v_row public.overtime_requests;
begin
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
    raise exception 'Primero debés registrar la entrada antes de solicitar una hora extra.';
  end if;

  if v_entry.operator_id <> auth.uid() then
    raise exception 'Solo el operario de este turno puede enviar esta solicitud.';
  end if;

  if exists (
    select 1 from public.attendance_events x
    where x.shift_id = p_shift_id and x.event_type = 'checkout'
  ) then
    raise exception 'El turno ya tiene una salida registrada.';
  end if;

  if exists (
    select 1 from public.overtime_authorizations oa
    where oa.shift_id = p_shift_id and oa.revoked_at is null
  ) then
    raise exception 'Este turno ya tiene horas extra autorizadas.';
  end if;

  v_scheduled_end_at := (
    v_entry.shift_date::timestamp
    + v_entry.scheduled_end
    + case when v_entry.scheduled_end <= v_entry.scheduled_start then interval '1 day' else interval '0 day' end
  ) at time zone 'America/Argentina/Buenos_Aires';

  if p_requested_until is null or p_requested_until <= v_scheduled_end_at then
    raise exception 'La hora solicitada debe ser posterior al horario programado de salida.';
  end if;

  if p_requested_until <= now() then
    raise exception 'La hora solicitada debe estar en el futuro.';
  end if;

  if p_requested_until > v_scheduled_end_at + interval '12 hours' then
    raise exception 'La extensión solicitada supera 12 horas. Revisá la hora ingresada.';
  end if;

  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'Indicá el motivo de la hora extra.';
  end if;

  insert into public.overtime_requests (
    shift_id, assignment_id, shift_date, operator_id, site_id,
    requested_until, reason, status, requested_at,
    reviewed_by, reviewed_by_name, reviewed_at, review_notes
  ) values (
    v_entry.shift_id, v_entry.assignment_id, v_entry.shift_date, v_entry.operator_id, v_entry.site_id,
    p_requested_until, btrim(p_reason), 'pending', now(),
    null, null, null, null
  )
  on conflict (shift_id) do update set
    assignment_id = excluded.assignment_id,
    shift_date = excluded.shift_date,
    operator_id = excluded.operator_id,
    site_id = excluded.site_id,
    requested_until = excluded.requested_until,
    reason = excluded.reason,
    status = 'pending',
    requested_at = now(),
    reviewed_by = null,
    reviewed_by_name = null,
    reviewed_at = null,
    review_notes = null,
    updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.approve_overtime_request(
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
  v_request public.overtime_requests;
  v_assignment record;
  v_scheduled_end_at timestamptz;
  v_approver_name text;
  v_auth public.overtime_authorizations;
begin
  if not public.is_supervisor() then
    raise exception 'Solo un supervisor o administrador puede aprobar horas extra.';
  end if;

  select * into v_request
  from public.overtime_requests
  where shift_id = p_shift_id and status = 'pending'
  for update;

  if v_request.shift_id is null then
    raise exception 'No hay una solicitud pendiente de hora extra para este turno.';
  end if;

  select scheduled_start, scheduled_end into v_assignment
  from public.assignments
  where id = v_request.assignment_id;

  if not found then
    raise exception 'No se encontró la asignación original del turno.';
  end if;

  v_scheduled_end_at := (
    v_request.shift_date::timestamp
    + v_assignment.scheduled_end
    + case when v_assignment.scheduled_end <= v_assignment.scheduled_start then interval '1 day' else interval '0 day' end
  ) at time zone 'America/Argentina/Buenos_Aires';

  if p_authorized_until is null or p_authorized_until <= v_scheduled_end_at then
    raise exception 'La hora autorizada debe ser posterior al horario programado de salida.';
  end if;

  if p_authorized_until > v_scheduled_end_at + interval '12 hours' then
    raise exception 'La extensión autorizada supera 12 horas. Revisá la hora ingresada.';
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
    v_request.shift_id, v_request.assignment_id, v_request.shift_date, v_request.operator_id, v_request.site_id,
    p_authorized_until,
    coalesce(nullif(btrim(coalesce(p_notes, '')), ''), v_request.reason),
    auth.uid(), v_approver_name,
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
  returning * into v_auth;

  update public.overtime_requests
  set status = 'approved',
      reviewed_by = auth.uid(),
      reviewed_by_name = v_approver_name,
      reviewed_at = now(),
      review_notes = nullif(btrim(coalesce(p_notes, '')), ''),
      updated_at = now()
  where shift_id = p_shift_id;

  return v_auth;
end;
$$;

create or replace function public.reject_overtime_request(
  p_shift_id text,
  p_notes text default null
)
returns public.overtime_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reviewer_name text;
  v_row public.overtime_requests;
begin
  if not public.is_supervisor() then
    raise exception 'Solo un supervisor o administrador puede rechazar horas extra.';
  end if;

  select coalesce(full_name, 'Supervisor/Administrador')
  into v_reviewer_name
  from public.profiles
  where id = auth.uid();

  update public.overtime_requests
  set status = 'rejected',
      reviewed_by = auth.uid(),
      reviewed_by_name = v_reviewer_name,
      reviewed_at = now(),
      review_notes = nullif(btrim(coalesce(p_notes, '')), ''),
      updated_at = now()
  where shift_id = p_shift_id
    and status = 'pending'
  returning * into v_row;

  if v_row.shift_id is null then
    raise exception 'No hay una solicitud pendiente de hora extra para este turno.';
  end if;

  return v_row;
end;
$$;

revoke all on function public.request_overtime_extension(text, timestamptz, text) from public;
grant execute on function public.request_overtime_extension(text, timestamptz, text) to authenticated;
revoke all on function public.approve_overtime_request(text, timestamptz, text) from public;
grant execute on function public.approve_overtime_request(text, timestamptz, text) to authenticated;
revoke all on function public.reject_overtime_request(text, text) from public;
grant execute on function public.reject_overtime_request(text, text) to authenticated;

-- Cierre automático actualizado:
-- 1) autorización aprobada -> usa authorized_until;
-- 2) solicitud pendiente -> usa requested_until, sin considerarla aprobada;
-- 3) sin ninguna de las anteriores -> usa horario programado.
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
      case when oa.revoked_at is null then oa.approved_by_name else null end as overtime_approver,
      case when oq.status = 'pending' then oq.requested_until else null end as requested_overtime_until,
      case when oq.status = 'pending' then oq.reason else null end as requested_overtime_reason
    from public.attendance_events e
    join public.assignments a on a.id = e.assignment_id
    left join public.overtime_authorizations oa on oa.shift_id = e.shift_id
    left join public.overtime_requests oq on oq.shift_id = e.shift_id
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
    select *,
      greatest(
        scheduled_end_at,
        entry_at,
        coalesce(overtime_until, scheduled_end_at),
        coalesce(requested_overtime_until, scheduled_end_at)
      ) as effective_end_at
    from open_entries
    where now() >= greatest(
      scheduled_end_at,
      entry_at,
      coalesce(overtime_until, scheduled_end_at),
      coalesce(requested_overtime_until, scheduled_end_at)
    ) + interval '45 minutes'
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
        || case
          when d.overtime_until is not null then
            'Había horas extra autorizadas hasta '
            || to_char(d.overtime_until at time zone 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY HH24:MI')
            || coalesce(' por ' || d.overtime_approver, '') || '. '
          when d.requested_overtime_until is not null then
            'Había una solicitud de hora extra pendiente de aprobación hasta '
            || to_char(d.requested_overtime_until at time zone 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY HH24:MI')
            || '. '
          else
            'Horario programado de salida: '
            || to_char(d.scheduled_end_at at time zone 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY HH24:MI') || '. '
        end
        || 'El sistema ejecutó el cierre a las '
        || to_char(now() at time zone 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY HH24:MI')
        || ' luego de superar 45 minutos sin marcación. Para el cómputo de horas, la salida se imputó al límite operativo vigente.',
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
