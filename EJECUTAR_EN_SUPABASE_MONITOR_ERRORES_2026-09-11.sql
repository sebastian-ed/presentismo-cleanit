-- Clean It · Presentismo GPS
-- Monitor de errores/incidentes del operario.
-- Registra errores técnicos y bloqueos de uso mostrados al operario,
-- con operario, servicio, acción, detalle técnico y estado de revisión.

begin;

create table if not exists public.app_error_logs (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  operator_id uuid references public.profiles(id) on delete set null,
  operator_name_snapshot text not null,
  site_id uuid references public.sites(id) on delete set null,
  site_name_snapshot text,
  shift_id text,
  action text not null default 'unknown',
  category text not null default 'technical',
  severity text not null default 'error' check (severity in ('warning', 'error', 'critical')),
  message text not null,
  error_name text,
  error_code text,
  technical_details jsonb not null default '{}'::jsonb,
  user_agent text,
  app_url text,
  app_version text,
  status text not null default 'new' check (status in ('new', 'reviewed')),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null,
  review_note text,
  created_at timestamptz not null default now()
);

create index if not exists idx_app_error_logs_occurred_at
  on public.app_error_logs(occurred_at desc);
create index if not exists idx_app_error_logs_status_date
  on public.app_error_logs(status, occurred_at desc);
create index if not exists idx_app_error_logs_operator
  on public.app_error_logs(operator_id, occurred_at desc);
create index if not exists idx_app_error_logs_site
  on public.app_error_logs(site_id, occurred_at desc);

alter table public.app_error_logs enable row level security;

drop policy if exists "app_error_logs_insert_operator" on public.app_error_logs;
create policy "app_error_logs_insert_operator"
on public.app_error_logs
for insert
to authenticated
with check (
  operator_id = auth.uid()
  or public.is_supervisor()
);

drop policy if exists "app_error_logs_select_management" on public.app_error_logs;
create policy "app_error_logs_select_management"
on public.app_error_logs
for select
to authenticated
using (public.is_supervisor());

drop policy if exists "app_error_logs_update_management" on public.app_error_logs;
create policy "app_error_logs_update_management"
on public.app_error_logs
for update
to authenticated
using (public.is_supervisor())
with check (public.is_supervisor());

-- No se habilita borrado desde la aplicación: el objetivo es conservar trazabilidad.
revoke all on public.app_error_logs from anon;
grant insert, select, update on public.app_error_logs to authenticated;

commit;
