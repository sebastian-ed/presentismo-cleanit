-- Clean It · Presentismo GPS
-- Permite asignar múltiples servicios activos a un mismo operario
-- dentro de la modalidad de jornada flexible.

begin;

drop index if exists public.idx_flexible_attendance_modes_one_open_per_operator;

drop index if exists public.idx_flexible_attendance_modes_one_open_per_operator_site;
create unique index idx_flexible_attendance_modes_one_open_per_operator_site
  on public.flexible_attendance_modes(operator_id, site_id)
  where valid_to is null;

commit;
