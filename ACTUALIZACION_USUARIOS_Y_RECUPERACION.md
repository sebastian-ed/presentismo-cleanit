# Clean It · Alta de supervisores + recuperación de contraseña

Esta versión elimina la necesidad de copiar manualmente el UUID de Supabase Auth para crear supervisores.

## Qué cambia

- El administrador puede crear desde **Usuarios** un Operario, Supervisor o Administrador con:
  - nombre completo
  - nombre de usuario
  - email real de recuperación
  - contraseña inicial
  - teléfono y notas
- El supervisor puede crear y administrar operarios, pero no puede elevar privilegios ni crear otros supervisores/administradores.
- El login acepta **nombre de usuario o email**.
- Se agrega **¿Olvidaste tu contraseña?**.
- Supabase envía un email con el enlace de recuperación.
- Al volver desde el email, la propia app muestra **Crear nueva contraseña** y guarda el cambio en Supabase Auth.
- Los usuarios existentes siguen funcionando. Los operarios históricos creados como `usuario@cleanit.ar` recuperan automáticamente su username, pero para usar recuperación por email hay que editarles un **email real** una vez.

---

## ORDEN DE IMPLEMENTACIÓN

### 1. Ejecutar la migración SQL

En Supabase: **SQL Editor → New query**.

Ejecutar completo:

`supabase/migrations/20260810_usernames_password_recovery.sql`

No borra usuarios ni marcaciones. Agrega `username` y `email` a `profiles`, completa datos históricos y crea índices únicos.

### 2. Desplegar la Edge Function

Desde una terminal, parado en la carpeta del proyecto:

```powershell
supabase login
supabase link --project-ref ubdtdangxjjaptkhyqlq
supabase functions deploy user-auth --no-verify-jwt
```

La función usa `SUPABASE_SERVICE_ROLE_KEY` solamente en Supabase. **Nunca** copies esa clave al frontend ni a `js/config.js`.

### 3. Configurar el retorno del email de recuperación

En Supabase:

**Authentication → URL Configuration**

Configurar:

- Site URL: `https://sebastian-ed.github.io/presentismo-cleanit/`
- Redirect URLs: agregar `https://sebastian-ed.github.io/presentismo-cleanit/`

Si esta URL no está autorizada, el enlace del email puede volver a otra página o a localhost.

### 4. Configurar SMTP para producción

En Supabase:

**Authentication → Emails → SMTP Settings**

Para producción conviene usar SMTP propio (Google Workspace/Gmail con contraseña de aplicación, Resend, SendGrid, AWS SES, etc.). El servicio de correo incorporado de Supabase es de prueba y tiene un límite muy bajo.

Sin SMTP propio el código de recuperación funciona, pero la entrega de emails no es suficientemente confiable para una app operativa.

### 5. Subir el frontend a GitHub

Reemplazar en el repositorio:

- `index.html`
- `styles.css`
- `js/app.js`
- `js/storage.js`

`js/config.js` no necesita cambios.

---

## Usuarios que ya existen

### Operarios actuales

Van a poder seguir entrando con el usuario y la contraseña actual.

Para que puedan usar **¿Olvidaste tu contraseña?**:

1. Entrar como administrador.
2. Ir a **Usuarios**.
3. Editar el operario.
4. Cargar un email real.
5. Guardar.

Al guardar, la app actualiza el mismo usuario de Supabase Auth. No cambia el UUID y no pierde asignaciones ni historial.

### Supervisores actuales

Si ya tienen un email real pueden seguir ingresando con ese email. El administrador puede editarlos y asignarles también un nombre de usuario.

---

## Prueba recomendada

1. Crear un supervisor de prueba desde la app.
2. Cerrar sesión.
3. Ingresar con el nombre de usuario y la contraseña creada.
4. Cerrar sesión.
5. Presionar **¿Olvidaste tu contraseña?**.
6. Ingresar el usuario.
7. Abrir el email recibido.
8. Crear una contraseña nueva.
9. Confirmar que vuelve al login.
10. Ingresar con la nueva contraseña.

No hagas la primera prueba con el único usuario administrador.
