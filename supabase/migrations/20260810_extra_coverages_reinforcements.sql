-- Clean It · Presentismo GPS
-- Coberturas y refuerzos extraordinarios + fichaje excepcional declarado por operario.
-- Ejecutar una sola vez en Supabase SQL Editor.

begin;

alter table public.assignments
  add column if not exists assignment_type text not null default 'fixed',
  add column if not exists covered_operator_id uuid references public.profiles(id) on delete set null,
  add column if not exists created_by uuid references public.profiles(id) on delete set null,
  add column if not exists suppress_regular_assignments boolean not null default false;

alter table public.assignments
  drop constraint if exists assignments_assignment_type_check;

alter table public.assignments
  add constraint assignments_assignment_type_check
  check (assignment_type in ('fixed', 'coverage', 'reinforcement'));

alter table public.attendance_events
  add column if not exists work_type text not null default 'regular',
  add column if not exists entry_source text not null default 'assignment',
  add column if not exists validation_status text not null default 'confirmed';

alter table public.attendance_events
  drop constraint if exists attendance_events_work_type_check;
alter table public.attendance_events
  add constraint attendance_events_work_type_check
  check (work_type in ('regular', 'coverage', 'reinforcement'));

alter table public.attendance_events
  drop constraint if exists attendance_events_entry_source_check;
alter table public.attendance_events
  add constraint attendance_events_entry_source_check
  check (entry_source in ('assignment', 'operator_extra'));

alter table public.attendance_events
  drop constraint if exists attendance_events_validation_status_check;
alter table public.attendance_events
  add constraint attendance_events_validation_status_check
  check (validation_status in ('confirmed', 'pending', 'rejected'));

-- El supervisor/admin puede validar una marcación extraordinaria autodeclarada.
drop policy if exists "attendance_update_supervisor" on public.attendance_events;
create policy "attendance_update_supervisor"
on public.attendance_events
for update
to authenticated
using (public.is_supervisor())
with check (public.is_supervisor());

grant update on public.attendance_events to authenticated;

create index if not exists idx_assignments_type on public.assignments(assignment_type);
create index if not exists idx_attendance_entry_source on public.attendance_events(entry_source, validation_status);

commit;
