-- Clean It · Presentismo GPS
-- Modalidad excepcional de jornada flexible / sin horario fijo.
-- Permite asignar solamente un servicio a determinados operarios y registrar
-- entradas/salidas reales, incluso en varios tramos durante el mismo día.
-- No genera tardanza, ausencia automática ni cierre automático por horario.

begin;

create table if not exists public.flexible_attendance_modes (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null references public.profiles(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete restrict,
  valid_from date not null default current_date,
  valid_to date,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint flexible_attendance_modes_valid_range check (valid_to is null or valid_to >= valid_from)
);

create index if not exists idx_flexible_attendance_modes_operator_dates
  on public.flexible_attendance_modes(operator_id, valid_from, valid_to);

create unique index if not exists idx_flexible_attendance_modes_one_open_per_operator
  on public.flexible_attendance_modes(operator_id)
  where valid_to is null;

drop trigger if exists trg_flexible_attendance_modes_updated_at on public.flexible_attendance_modes;
create trigger trg_flexible_attendance_modes_updated_at
before update on public.flexible_attendance_modes
for each row execute function public.set_updated_at();

alter table public.flexible_attendance_modes enable row level security;

drop policy if exists "flexible_attendance_modes_select_relevant" on public.flexible_attendance_modes;
create policy "flexible_attendance_modes_select_relevant"
on public.flexible_attendance_modes
for select
to authenticated
using (public.is_supervisor() or operator_id = auth.uid());

drop policy if exists "flexible_attendance_modes_write_supervisor" on public.flexible_attendance_modes;
create policy "flexible_attendance_modes_write_supervisor"
on public.flexible_attendance_modes
for all
to authenticated
using (public.is_supervisor())
with check (public.is_supervisor());

revoke all on public.flexible_attendance_modes from anon;
grant select, insert, update, delete on public.flexible_attendance_modes to authenticated;

commit;
