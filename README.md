# Clean It · Presentismo GPS

App web mobile-first para control de presentismo con GPS, horarios fijos por servicio y panel vivo de supervisión.

## Qué cambió en esta versión

La app ya no obliga a cargar turno por turno. Ahora trabaja con **asignaciones semanales fijas**:

- Un servicio puede tener cobertura lunes, miércoles y viernes de 08:00 a 12:00.
- Un operario puede tener uno o varios servicios asignados.
- Un servicio puede tener más de un operario en el mismo día y horario.
- Las asignaciones tienen vigencia desde / hasta para reemplazos, bajas o cambios temporales.
- El supervisor puede crear, editar o eliminar servicios, usuarios y asignaciones desde la app.

## Qué incluye

- Vista operario: marcación con checkbox, GPS de alta precisión, observación opcional, demora y ausencia informada.
- Vista supervisor: estado en vivo por fecha operativa.
- Cobertura semanal por servicio, con formato tipo planificador: días, operarios, horarios y “Sin cobertura”.
- CRUD de servicios/consorcios con zona, supervisor, WhatsApp, dirección, latitud, longitud y radio GPS.
- CRUD de asignaciones semanales fijas.
- CRUD de usuarios: operarios y supervisores con PIN de acceso.
- Botón WhatsApp por servicio/consorcio con mensaje automático según estado.
- Historial de marcaciones y exportación CSV.
- Modo local con `localStorage` sin configurar Supabase.
- SQL listo para Supabase.

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
- Operarios: PIN `1001`, `1002`, `1003`, `1004`, `1005`

## Cómo conectar con Supabase

1. Crear un proyecto en Supabase.
2. Ir a SQL Editor y ejecutar `supabase/schema.sql`.
3. Completar `js/config.js`:

```js
window.APP_CONFIG = {
  SUPABASE_URL: "https://TU-PROYECTO.supabase.co",
  SUPABASE_ANON_KEY: "TU_ANON_KEY",
  TIMEZONE: "America/Argentina/Buenos_Aires",
  COMPANY_NAME: "Clean It"
};
```

Cuando esos valores estén completos, la app cambia automáticamente de modo local a Supabase.

El SQL crea un supervisor inicial:

```text
PIN supervisor: 9999
```

Después, desde la propia app, podés crear operarios, servicios y asignaciones.

## Modelo operativo

### Servicios

Representan consorcios o clientes. Cada servicio tiene:

- Nombre.
- Dirección.
- Zona o barrio.
- Supervisor.
- Tipo de cobertura.
- Latitud y longitud.
- Radio GPS permitido.
- Contacto de WhatsApp.

### Asignaciones

Representan la cobertura fija. Cada asignación tiene:

- Operario.
- Servicio.
- Días de la semana.
- Hora de ingreso y salida.
- Tolerancia de demora.
- Minutos desde los cuales se considera ausente.
- Vigencia desde / hasta.

La app genera automáticamente los turnos del día según esas asignaciones.

## Recomendación operativa crítica

Para que el control sea defendible frente a un cliente o consorcio:

- Cargar la ubicación exacta del punto de ingreso al edificio.
- Usar radios razonables: 80 a 150 metros suele ser práctico en CABA; más puede servir para plantas grandes.
- No usar radios enormes porque destruyen el valor probatorio del sistema.
- Informar formalmente a los operarios que la marcación registra hora, ubicación GPS, precisión y distancia al servicio.

## Nota de seguridad

Esta versión usa acceso por PIN para simplificar la operación y permitir crear usuarios desde la app sin entrar a Supabase. Para una implementación corporativa más estricta, conviene migrar el acceso a Supabase Auth y crear usuarios con una Edge Function protegida por service role.
