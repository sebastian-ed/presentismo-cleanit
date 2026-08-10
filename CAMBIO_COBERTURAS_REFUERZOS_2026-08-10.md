# Coberturas y refuerzos extraordinarios · 10/08/2026

## Objetivo
Permitir que una cobertura por ausencia o un refuerzo quede asociado al operario, al servicio real, al GPS y a las horas trabajadas, incluso cuando no existe una asignación fija para ese día.

## Flujo recomendado
1. Supervisor/administrador entra a **Asignaciones**.
2. En **Cobertura / refuerzo puntual** carga operario, servicio, tipo, fecha y horario.
3. Si el movimiento reemplaza la asignación habitual del operario en ese horario, activa **Reemplaza su asignación habitual**. Así no se genera una ausencia falsa en el servicio original.
4. El operario toca **Actualizar servicios** y ve la tarea extraordinaria, identificada como Cobertura o Refuerzo.
5. Registra entrada y salida normalmente con GPS.

## Fallback cuando no fue cargado previamente
El operario dispone de **Situación excepcional → ¿Te enviaron a cubrir o reforzar otro servicio?**.
Puede seleccionar el servicio y el tipo y registrar la entrada con GPS.

Ese fichaje queda marcado como:
- `entry_source = operator_extra`
- `validation_status = pending`

En **En vivo**, supervisor/admin puede **Validar** o **Rechazar** el registro.
Esto evita que un operario pueda convertir unilateralmente una marcación excepcional en una asignación autorizada.

## RRHH
Las exportaciones y la pestaña Fichaje incorporan:
- Tipo de trabajo: Regular / Cobertura / Refuerzo.
- Origen: Asignación / Declarado por operario.
- Estado de validación.
- Servicio real, entrada, salida y horas.

## Instalación
### 1. Supabase
Ejecutar en SQL Editor:
`supabase/migrations/20260810_extra_coverages_reinforcements.sql`

### 2. GitHub Pages
Reemplazar:
- `index.html`
- `styles.css`
- `js/app.js`
- `js/storage.js`

No hace falta desplegar nuevamente la Edge Function `user-auth`.
