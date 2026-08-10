-- Permite turnos que cruzan medianoche (ej. 22:00 a 06:00).
-- La app interpreta scheduled_end <= scheduled_start como salida del día siguiente.

begin;

alter table public.assignments
  drop constraint if exists assignments_end_after_start;

alter table public.assignments
  drop constraint if exists assignments_duration_nonzero;

alter table public.assignments
  add constraint assignments_duration_nonzero
  check (scheduled_end <> scheduled_start);

commit;
