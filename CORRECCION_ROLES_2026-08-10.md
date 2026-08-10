# Corrección de selector de roles

Se corrigió el permiso que dejaba a los usuarios con rol `supervisor` limitados a crear únicamente `operator`.

Comportamiento nuevo:

- `supervisor`: puede crear y gestionar `operator` y `supervisor`. No puede crear ni convertir usuarios en `admin`.
- `admin`: puede crear y gestionar los tres roles.
- `operator`: no accede a gestión de usuarios.

También el encabezado muestra **Vista administrador** o **Vista supervisor** según el rol real detectado en `public.profiles`.

## Publicación

1. Reemplazar en GitHub: `index.html` y `js/app.js` (o todos los archivos del ZIP de reemplazo).
2. Volver a desplegar la Edge Function `user-auth`:

```powershell
supabase functions deploy user-auth --no-verify-jwt
```

No hace falta ejecutar un SQL nuevo para esta corrección.
