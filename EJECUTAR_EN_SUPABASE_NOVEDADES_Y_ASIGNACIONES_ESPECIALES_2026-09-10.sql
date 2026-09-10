-- Clean It Presentismo · 2026-09-10
-- Novedades justificadas (certificados/licencias/vacaciones) + asignaciones especiales de un día.

begin;

-- 1) Permitir asignaciones especiales que reemplazan la jornada habitual solo en una fecha.
alter table public.assignments
  drop constraint if exists assignments_assignment_type_check;

alter table public.assignments
  add constraint assignments_assignment_type_check
  check (assignment_type in ('fixed', 'coverage', 'reinforcement', 'special'));

-- 2) Novedades de presentismo programables.
create table if not exists public.attendance_leaves (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null references public.profiles(id) on delete restrict,
  leave_type text not null check (leave_type in ('medical_certificate', 'medical_leave', 'other_leave', 'vacation')),
  start_date date not null,
  end_date date not null,
  reference text,
  notes text,
  status text not null default 'active' check (status in ('active', 'cancelled')),
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint attendance_leaves_valid_range check (end_date >= start_date)
);

create index if not exists idx_attendance_leaves_operator_dates
  on public.attendance_leaves(operator_id, start_date, end_date);
create index if not exists idx_attendance_leaves_status
  on public.attendance_leaves(status);

create or replace function public.touch_attendance_leave_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_attendance_leaves_updated_at on public.attendance_leaves;
create trigger trg_attendance_leaves_updated_at
before update on public.attendance_leaves
for each row execute function public.touch_attendance_leave_updated_at();

-- 3) Auditoría: guarda altas, modificaciones y cancelaciones sin depender del front-end.
create table if not exists public.attendance_leave_audit (
  id uuid primary key default gen_random_uuid(),
  leave_id uuid,
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  old_data jsonb,
  new_data jsonb,
  changed_by uuid references public.profiles(id) on delete set null,
  changed_at timestamptz not null default now()
);

create index if not exists idx_attendance_leave_audit_changed_at
  on public.attendance_leave_audit(changed_at desc);
create index if not exists idx_attendance_leave_audit_leave
  on public.attendance_leave_audit(leave_id);

create or replace function public.audit_attendance_leave_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
begin
  v_actor := coalesce(
    case when tg_op <> 'DELETE' then new.updated_by end,
    case when tg_op <> 'DELETE' then new.created_by end,
    case when tg_op <> 'INSERT' then old.updated_by end,
    case when tg_op <> 'INSERT' then old.created_by end,
    auth.uid()
  );

  if tg_op = 'INSERT' then
    insert into public.attendance_leave_audit(leave_id, action, old_data, new_data, changed_by)
    values (new.id, 'INSERT', null, to_jsonb(new), v_actor);
    return new;
  elsif tg_op = 'UPDATE' then
    insert into public.attendance_leave_audit(leave_id, action, old_data, new_data, changed_by)
    values (new.id, 'UPDATE', to_jsonb(old), to_jsonb(new), v_actor);
    return new;
  else
    insert into public.attendance_leave_audit(leave_id, action, old_data, new_data, changed_by)
    values (old.id, 'DELETE', to_jsonb(old), null, v_actor);
    return old;
  end if;
end;
$$;

drop trigger if exists trg_attendance_leaves_audit on public.attendance_leaves;
create trigger trg_attendance_leaves_audit
after insert or update or delete on public.attendance_leaves
for each row execute function public.audit_attendance_leave_change();

-- 4) RLS. Operarios leen únicamente sus novedades; Supervisor/Admin gestionan todas.
alter table public.attendance_leaves enable row level security;
alter table public.attendance_leave_audit enable row level security;

drop policy if exists "attendance_leaves_select_relevant" on public.attendance_leaves;
create policy "attendance_leaves_select_relevant"
on public.attendance_leaves
for select
to authenticated
using (public.is_supervisor() or operator_id = auth.uid());

drop policy if exists "attendance_leaves_write_supervisor" on public.attendance_leaves;
create policy "attendance_leaves_write_supervisor"
on public.attendance_leaves
for all
to authenticated
using (public.is_supervisor())
with check (public.is_supervisor());

drop policy if exists "attendance_leave_audit_select_supervisor" on public.attendance_leave_audit;
create policy "attendance_leave_audit_select_supervisor"
on public.attendance_leave_audit
for select
to authenticated
using (public.is_supervisor());

-- El trigger escribe la auditoría como SECURITY DEFINER; no se habilita escritura directa desde la app.
grant select, insert, update on public.attendance_leaves to authenticated;
grant select on public.attendance_leave_audit to authenticated;

commit;
