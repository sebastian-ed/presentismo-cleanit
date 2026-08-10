# Análisis de presentismo y horas RRHH — 10/08/2026

## Cambios principales

### 1. Horas reales en exportaciones RRHH
El estado operativo exportado a Excel ahora calcula la duración real entre la entrada y la salida registrada.

Se agregan columnas de:
- Fecha/hora exacta de entrada.
- Fecha/hora exacta de salida.
- Duración trabajada.
- Minutos trabajados.
- Horas trabajadas en formato decimal, útil para fórmulas y liquidación.

El Excel de Estado operativo incorpora además la hoja **Horas por operario y día**, que acumula el tiempo de cada operario en cada fecha.

Cuando un operario tiene más de un fichaje en el mismo día, el cálculo neto evita duplicar minutos si existieran intervalos superpuestos.

Los trabajos extraordinarios autodeclarados se separan en:
- Horas confirmadas.
- Horas pendientes de validar.
- Horas rechazadas.

Las horas pendientes o rechazadas no se mezclan con las horas confirmadas para liquidación.

### 2. Fichaje por rango completo
La pestaña Fichaje ahora puede consultar el rango directamente en Supabase, en lugar de depender solamente de los últimos eventos cargados en pantalla.

El Excel de Fichaje incluye:
- Detalle.
- Resumen por operario.
- Horas por día.
- Duración exacta y horas decimales.

### 3. Nueva pestaña Análisis
Se agrega una pestaña **Análisis** al panel de supervisión/administración.

Permite seleccionar:
- Hoy.
- Ayer.
- Últimos 7 días.
- Mes actual.
- Mes anterior.
- Rango personalizado.
- Todo el historial.
- Servicio específico o todos los servicios.
- Orden de rankings ascendente o descendente.

Incluye indicadores de:
- Horas confirmadas.
- Horas pendientes de validar.
- Jornadas completas.
- Ausencias / sin entrada.
- Llegadas tarde.
- Fichajes fuera de radio.

Incluye gráficos tipo dashboard para:
- Horas trabajadas.
- Ausencias.
- Llegadas tarde.
- Fichajes fuera de radio.

Incluye rankings completos de operarios y una tabla general con:
- Horas confirmadas.
- Horas pendientes.
- Jornadas completas.
- Ausencias.
- Tardanzas y minutos acumulados.
- Fichajes fuera de radio.
- Salidas anticipadas.
- Salidas sin registrar.
- Porcentaje de asistencia.
- Porcentaje de puntualidad.

### 4. Exportación del análisis
Desde Análisis se puede descargar:
- CSV con el detalle operativo del período.
- Excel con hojas de Resumen operarios, Horas por operario y día, Detalle RRHH y Resumen por día.

## Archivos a reemplazar en GitHub
- `index.html`
- `styles.css`
- `js/app.js`
- `js/storage.js`

No requiere ejecutar SQL ni desplegar nuevamente la Edge Function.
