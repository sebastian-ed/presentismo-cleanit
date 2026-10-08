-- Clean It · Presentismo GPS
-- Reemplazos programados asociados a vacaciones/licencias/novedades.
-- Ejecutar una sola vez en Supabase SQL Editor.

begin;

alter table public.attendance_leaves
  add column if not exists replacement_operator_id uuid references public.profiles(id) on delete set null;

alter table public.assignments
  add column if not exists source_leave_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'assignments_source_leave_id_fkey'
      and conrelid = 'public.assignments'::regclass
  ) then
    alter table public.assignments
      add constraint assignments_source_leave_id_fkey
      foreign key (source_leave_id)
      references public.attendance_leaves(id)
      on delete set null;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'attendance_leaves_replacement_not_self'
      and conrelid = 'public.attendance_leaves'::regclass
  ) then
    alter table public.attendance_leaves
      add constraint attendance_leaves_replacement_not_self
      check (replacement_operator_id is null or replacement_operator_id <> operator_id);
  end if;
end $$;

create index if not exists idx_attendance_leaves_replacement
  on public.attendance_leaves(replacement_operator_id, start_date, end_date);

create index if not exists idx_assignments_source_leave
  on public.assignments(source_leave_id)
  where source_leave_id is not null;

commit;
