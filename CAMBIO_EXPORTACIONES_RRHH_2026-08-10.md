# Exportaciones RRHH · 10/08/2026

## Qué se agregó

### En vivo → Estado operativo
Se agregó un bloque de exportación independiente del filtro visual de la tabla. Permite descargar el estado operativo en:
- CSV
- Excel (.xlsx)

Períodos disponibles:
- Día mostrado
- Ayer
- Últimos 7 días
- Mes de la fecha mostrada
- Mes anterior
- Rango personalizado
- Todo el historial

El Excel incluye tres hojas:
1. **Estado operativo**: detalle por cobertura, operario y servicio.
2. **Resumen por operario**: coberturas, ingresos correctos, tardanzas, fichajes fuera de radio, ausencias/sin entrada y alertas de salida.
3. **Resumen por día**: consolidado diario para RRHH/Operaciones.

El detalle incluye GPS de entrada/salida, distancia al servicio, precisión, minutos de demora, minutos de salida anticipada, estado operativo, alertas y origen del estado.

### Importante sobre ausencias históricas
Si existe una cobertura programada pero no hay entrada registrada, el reporte puede mostrar **"Sin entrada / ausencia inferida"**. No se mezcla silenciosamente con una ausencia registrada: la columna **Origen del estado** distingue:
- `Ausencia registrada`
- `Inferido por programación`
- `Marcación`

Esto permite que RRHH revise el caso antes de imputar una ausencia definitiva.

### Registros → Historial de marcaciones
Se mantiene la exportación CSV existente y se agrega Excel.

Ahora la tabla y las descargas permiten elegir:
- Hoy
- Ayer
- Últimos 7 días
- Mes actual
- Mes anterior
- Rango personalizado
- Todo el historial

El CSV mantiene la estructura anterior de columnas para no romper usos existentes. El Excel usa encabezados legibles y agrega la dirección del servicio.

## Archivos que cambian en GitHub
- `index.html`
- `styles.css`
- `js/app.js`
- `js/storage.js`

## Supabase
No requiere ejecutar SQL ni modificar tablas.

`js/storage.js` ahora consulta el historial por rango y pagina los resultados de `attendance_events`, evitando depender del límite de los últimos 1500 registros para las exportaciones completas.
