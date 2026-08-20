-- Clean It · Presentismo GPS
-- Cierre automático de turnos cuando el operario registró entrada pero no salida.
-- Regla: 45 minutos después del horario programado de salida.
-- La hora efectiva para RRHH se imputa al horario programado de salida; created_at conserva
-- la hora real en que el sistema ejecutó el cierre. Se aplica desde 2026-08-20 para no
-- modificar automáticamente históricos anteriores a la implementación.

begin;

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
      ) at time zone 'America/Argentina/Buenos_Aires' as scheduled_end_at
    from public.attendance_events e
    join public.assignments a on a.id = e.assignment_id
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
    select *
    from open_entries
    where now() >= greatest(scheduled_end_at, entry_at) + interval '45 minutes'
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
        || 'Horario programado de salida: '
        || to_char(d.scheduled_end_at at time zone 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY HH24:MI')
        || '. El sistema ejecutó el cierre a las '
        || to_char(now() at time zone 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY HH24:MI')
        || ' luego de superar 45 minutos sin marcación. Para el cómputo de horas, la salida se imputó al horario programado.',
      null,
      null,
      null,
      null,
      null,
      greatest(d.scheduled_end_at, d.entry_at),
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

-- Supabase Cron / pg_cron: intenta cerrar turnos vencidos cada minuto.
-- Esta parte es deliberadamente posterior al COMMIT para que la función exista aunque
-- hubiera que habilitar pg_cron por separado en algún proyecto.
create extension if not exists pg_cron;

do $$
declare
  v_job record;
begin
  for v_job in
    select jobid from cron.job where jobname = 'cleanit-auto-checkout-missing-exit'
  loop
    perform cron.unschedule(v_job.jobid);
  end loop;
end;
$$;

select cron.schedule(
  'cleanit-auto-checkout-missing-exit',
  '* * * * *',
  $cron$select public.auto_close_overdue_shifts();$cron$
);
