# Clean It · Presentismo GPS

App web mobile-first para control de presentismo con GPS, horario y panel vivo de supervisión.

## Qué incluye

- Vista operario: marcación con checkbox, botón de presencia, GPS de alta precisión, observación opcional, reporte de demora y reporte de ausencia.
- Vista supervisor: estado en vivo por turno: presente, demorado, ausente, pendiente o fuera de radio.
- Botón WhatsApp por servicio/consorcio con mensaje automático según estado.
- CRUD de servicios/consorcios con contacto de WhatsApp, dirección, latitud, longitud y radio GPS.
- CRUD de turnos.
- CRUD local de operarios para pruebas.
- Historial de marcaciones y exportación CSV.
- Modo local con `localStorage` sin configurar Supabase.
- SQL listo para crear estructura en Supabase.

## Cómo probar localmente

No abras el archivo directamente con doble click si querés probar GPS. Los navegadores suelen exigir HTTPS o `localhost` para geolocalización.

Desde la carpeta del proyecto:

```bash
python -m http.server 8080
```

Después abrir:

```text
http://localhost:8080
```

### Accesos demo

- Supervisor: PIN `9999`
- Operario 1: PIN `1001`
- Operario 2: PIN `1002`

## Cómo conectar con Supabase

1. Crear un proyecto en Supabase.
2. Ir a SQL Editor y ejecutar `supabase/schema.sql`.
3. Crear usuarios desde Authentication.
4. Insertar perfiles en `profiles` usando el `id` del usuario creado.
5. Completar `js/config.js`:

```js
window.APP_CONFIG = {
  SUPABASE_URL: "https://TU-PROYECTO.supabase.co",
  SUPABASE_ANON_KEY: "TU_ANON_KEY",
  TIMEZONE: "America/Argentina/Buenos_Aires",
  COMPANY_NAME: "Clean It"
};
```

Cuando esos valores estén completos, la app cambia automáticamente de modo local a modo Supabase.

## Ejemplo para crear perfil supervisor

Luego de crear el usuario en Supabase Authentication, copiá su UUID y ejecutá:

```sql
insert into public.profiles (id, full_name, role, phone)
values ('UUID_DEL_USUARIO', 'Supervisor Clean It', 'supervisor', '+5491100000000');
```

## Ejemplo para crear perfil operario

```sql
insert into public.profiles (id, full_name, role, phone)
values ('UUID_DEL_USUARIO', 'Nombre Operario', 'operator', '+5491111111111');
```

## Recomendación operativa crítica

Para que el control sea defendible frente a un cliente o un consorcio:

- Cargar la ubicación exacta del punto de ingreso al edificio o servicio.
- Usar un radio razonable: 80 a 150 metros suele ser práctico en CABA, pero depende del edificio y señal GPS.
- No usar radios enormes porque destruyen el valor probatorio del sistema.
- Avisar formalmente a los operarios que la marcación registra ubicación, hora y precisión GPS.
- No vender esto internamente como “vigilancia”; es control objetivo de presentismo para servicios asignados.

## Limitaciones del MVP

- El modo local no es seguro para producción. Es solo para prueba visual y funcional.
- En producción se debe usar Supabase Auth, HTTPS y políticas RLS.
- El GPS depende del teléfono, permisos del navegador, señal y entorno. La app guarda la precisión reportada por el dispositivo para auditar cada registro.
- WhatsApp abre el mensaje listo para enviar; no envía automáticamente. Eso evita depender de integraciones pagas o APIs oficiales en esta etapa.
