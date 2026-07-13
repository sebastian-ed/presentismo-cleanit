-- Clean It · Presentismo GPS
-- Habilita turnos nocturnos cuya salida ocurre al día siguiente.
-- Ejemplo válido: entrada 22:00 / salida 06:00.
-- Ejecutar una sola vez en Supabase > SQL Editor.

begin;

alter table public.assignments
  drop constraint if exists assignments_end_after_start;

alter table public.assignments
  drop constraint if exists assignments_start_end_different;

-- Respaldo para bases creadas con otro nombre de constraint.
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
      and t.relname = 'assignments'
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%scheduled_start%'
      and pg_get_constraintdef(c.oid) ilike '%scheduled_end%'
  loop
    execute format('alter table public.assignments drop constraint if exists %I', r.conname);
  end loop;
end $$;

-- Se admiten horarios que cruzan medianoche. Solo se evita una duración ambigua de 0/24 horas.
alter table public.assignments
  add constraint assignments_start_end_different
  check (scheduled_end <> scheduled_start);

commit;
