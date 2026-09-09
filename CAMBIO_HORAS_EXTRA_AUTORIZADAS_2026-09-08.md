# Horas extra autorizadas · 08/09/2026

Se agregó un flujo controlado para que el cierre automático no impida registrar una salida real cuando el operario está haciendo horas extra.

## Cómo funciona

- El cierre automático habitual sigue vigente.
- Un operario **no puede autorizarse horas extra a sí mismo**.
- En **En vivo**, supervisor/admin ve el botón **Autorizar hora extra** cuando el turno tiene entrada y todavía no tiene salida.
- El supervisor define hasta qué fecha/hora está autorizada la extensión y deja un motivo.
- El operario ve un aviso claro indicando que las horas extra deben estar aprobadas por supervisor.
- Si existe autorización, el cierre automático se posterga y recién actúa **45 minutos después del límite autorizado** si todavía no hubo salida.
- El operario puede registrar su salida con GPS normalmente mientras está trabajando horas extra.
- Si sale después del horario sin autorización cargada, la salida se conserva igual, pero En vivo lo marca como **horas extra sin autorización** para no perder el dato real.
- Las horas trabajadas continúan calculándose con la entrada y salida reales.

## Paso obligatorio en Supabase

Antes de usar la función, ejecutar una sola vez en el SQL Editor de Supabase:

`EJECUTAR_EN_SUPABASE_HORAS_EXTRA_2026-09-08.sql`

Ese script crea la tabla de autorizaciones, restringe la aprobación a supervisor/admin y actualiza la función existente de cierre automático. El cron ya configurado continúa usando el mismo nombre de función, por lo que no hace falta crear otro cron.
