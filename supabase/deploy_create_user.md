# Alta de usuarios desde el panel supervisor

Esta versión reemplaza el alta manual por UUID.

## 1) Ejecutar migración SQL

En Supabase > SQL Editor, ejecutar:

```sql
-- supabase/migrations/20260602_add_profiles_email.sql
alter table if exists public.profiles
  add column if not exists email text;

create unique index if not exists idx_profiles_email_unique_lower
  on public.profiles (lower(email))
  where email is not null;

update public.profiles p
set email = u.email
from auth.users u
where p.id = u.id
  and p.email is null;
```

## 2) Desplegar la Edge Function

Desde la carpeta del proyecto:

```bash
supabase login
supabase link --project-ref TU_PROJECT_REF
supabase functions deploy create-user --no-verify-jwt
```

La función usa estos secrets nativos de Supabase:

- SUPABASE_URL
- SUPABASE_ANON_KEY
- SUPABASE_SERVICE_ROLE_KEY

No pongas `service_role` en `js/config.js`. Esa clave jamás va al front.

## 3) Subir archivos al hosting

Subir reemplazando los anteriores:

```text
index.html
styles.css
js/config.js
js/storage.js
js/app.js
```

Importante: en GitHub Pages se debe subir también la carpeta `js/`. Si solo subís `app.js`, `storage.js` y `config.js` en la raíz, el navegador va a seguir cargando otra cosa o directamente no va a tomar los cambios.

## 4) Resultado esperado

En la pestaña Usuarios, el formulario debe mostrar:

- Rol
- Nombre completo
- Email de acceso
- Contraseña inicial
- Teléfono
- Notas

Ya no debe aparecer el campo visible `UUID del usuario en Supabase Auth`.
