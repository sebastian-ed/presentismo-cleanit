# Presentismo GPS · Francos rotativos, marcación manual y borrado seguro

Actualización: 12/08/2026

## 1. Ejecutar primero la migración SQL

En Supabase > SQL Editor ejecutar:

`supabase/migrations/20260812_francos_manual_records.sql`

La migración agrega:
- estado `day_off` / Franco;
- trazabilidad `recorded_via` y `recorded_by` en marcaciones;
- RPC para marcar/quitar francos;
- RPC de borrado seguro;
- tabla de auditoría `attendance_event_deletions` que conserva una copia de cada registro borrado.

> Importante: ejecutar el SQL antes de publicar el frontend nuevo, porque el frontend ya utiliza las nuevas columnas y funciones.

## 2. Publicar GitHub Pages

Reemplazar/subir:
- `index.html`
- `styles.css`
- `js/app.js`
- `js/storage.js`
- `sw.js`

El Service Worker fue versionado como `20260812-francos1` para evitar que los celulares sigan usando una versión anterior en caché.

## 3. Francos rotativos

Desde **En vivo**, para un turno sin entrada/salida:
- `Marcar franco`: convierte ese turno puntual en Franco y elimina una ausencia/demora automática existente para ese mismo turno.
- `Quitar franco`: vuelve a habilitar el turno como programado. Si su horario ya venció y no existe entrada, volverá a ser tratado como ausencia.

El Franco:
- no cuenta como ausencia;
- no baja el porcentaje de asistencia;
- aparece en filtros, RRHH, Fichaje y Análisis;
- el operario ve que ese día está de franco y no necesita fichar.

## 4. Marcación manual excepcional

Desde **En vivo** el supervisor/admin puede usar:
- `Entrada manual`;
- `Salida manual`.

Se pide:
- fecha/hora real;
- motivo obligatorio.

La marcación queda sin GPS y se identifica expresamente como **Carga manual supervisor/admin · sin GPS**, junto con el usuario que la cargó.

## 5. Eliminación segura de registros

En **Registros** se puede:
- eliminar un registro individual;
- seleccionar varios;
- seleccionar todos los que coinciden con el período/filtro actual.

Antes de borrar se debe escribir exactamente:

`ELIMINAR REGISTROS`

La frase también se valida en Supabase. Antes del borrado se guarda una copia JSON en `attendance_event_deletions`, con el usuario y momento de eliminación.

### Nota importante
Eliminar una ausencia no equivale a convertirla en Franco. Si el turno sigue programado, ya venció y no tiene entrada, el sistema puede volver a inferir/generar la ausencia. Para un franco real, usar **Marcar franco**.

## 6. No requiere Edge Functions

Esta actualización no modifica `user-auth` ni requiere desplegar una Edge Function nueva.
