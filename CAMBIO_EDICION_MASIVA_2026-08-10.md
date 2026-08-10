# Edición masiva de parámetros — 10/08/2026

Se agregó edición masiva sin eliminar la edición individual existente.

## Asignaciones
- Aplicar a todas las asignaciones activas o solo a una selección.
- Cambiar `Tolerancia demora` y/o `Ausente desde`.
- Un campo vacío conserva el valor actual.
- Validación: ausencia debe quedar después de la tolerancia de demora.
- Confirmación antes de modificar.

## Servicios
- Aplicar a todos los servicios activos o solo a una selección.
- Cambiar `Radio GPS aceptado en metros`.
- No modifica latitud ni longitud.
- Confirmación antes de modificar.

## Base de datos
No requiere migración SQL. Usa actualizaciones sobre las tablas existentes `assignments` y `sites` respetando las políticas RLS actuales.
