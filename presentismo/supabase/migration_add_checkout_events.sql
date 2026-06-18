-- Clean It · Presentismo GPS
-- Agrega registro de salida sin perder las entradas/marcaciones existentes.
-- Ejecutar una sola vez si ya tenés instalada una versión anterior.

begin;

drop view if exists public.attendance_report;

-- El esquema anterior validaba event_type solo como present/late/absent.
-- Se elimina cualquier check constraint viejo sobre event_type u observed_status
-- y se crean las reglas nuevas compatibles con entrada y salida.
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

create index if not exists idx_attendance_shift_event_created
on public.attendance_events(shift_id, event_type, created_at desc);

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

commit;
