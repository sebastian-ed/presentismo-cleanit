-- Clean It · Presentismo GPS
-- Alta de operario nuevo (usuario de login = nombre, contraseña = DNI).
-- Crea en una sola transacción: auth.users + auth.identities + public.profiles,
-- los tres con el mismo UUID, tal como espera storage.js (profiles.id = auth.users.id).
--
-- Cómo usar:
-- 1) Completá los 4 valores de la sección "DATOS DEL OPERARIO" de abajo.
-- 2) Pegá y ejecutá este bloque completo en Supabase > SQL Editor.
-- 3) Para cargar varios operarios, copiá el bloque "do $$ ... end $$;" completo
--    tantas veces como usuarios necesites, cada uno con sus propios datos.
--
-- El usuario de login queda como "<nombre_usuario>@cleanit.ar" (igual que arma
-- app.js cuando el operario tipea solo el nombre sin arroba). La contraseña
-- queda siendo el DNI tal cual lo escribas.

do $$
declare
  -- ── DATOS DEL OPERARIO ──────────────────────────────────────────────
  v_nombre_usuario text := 'arielacevedo';   -- sin espacios ni tildes, minúsculas
  v_dni             text := '30111222';      -- va a ser la contraseña, tal cual
  v_nombre_completo text := 'Ariel Acevedo';
  v_telefono        text := '';              -- opcional, ej: '+5491100000000'
  -- ─────────────────────────────────────────────────────────────────────
  v_email text := lower(v_nombre_usuario) || '@cleanit.ar';
  v_uid   uuid := gen_random_uuid();
begin
  if exists (select 1 from auth.users where lower(email) = v_email) then
    raise exception 'Ya existe un usuario de Auth con ese nombre de usuario: %', v_email;
  end if;

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at,
    confirmation_token, recovery_token,
    email_change, email_change_token_new, email_change_token_current,
    reauthentication_token, is_sso_user, is_anonymous
  ) values (
    '00000000-0000-0000-0000-000000000000',
    v_uid,
    'authenticated',
    'authenticated',
    v_email,
    crypt(v_dni, gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    jsonb_build_object('full_name', v_nombre_completo),
    now(), now(),
    '', '', '', '', '', '',
    false, false
  );

  insert into auth.identities (
    id, provider_id, user_id, identity_data, provider,
    last_sign_in_at, created_at, updated_at
  ) values (
    gen_random_uuid(),
    v_uid::text,
    v_uid,
    jsonb_build_object('sub', v_uid::text, 'email', v_email),
    'email',
    now(), now(), now()
  );

  insert into public.profiles (id, full_name, role, phone, is_active)
  values (v_uid, v_nombre_completo, 'operator', nullif(v_telefono, ''), true);

  raise notice 'Operario creado: % (login: %, password: %)', v_nombre_completo, v_email, v_dni;
end $$;
