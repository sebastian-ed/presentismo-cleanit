# Corrección: salida de turnos nocturnos

## Problema detectado
Los turnos que cruzan medianoche (por ejemplo 22:00–06:00) conservan como fecha de turno el día en que comenzaron. Al pasar las 00:00, la vista del operario reconstruía únicamente las asignaciones del día nuevo, por lo que dejaba de mostrar el turno abierto del día anterior. La entrada seguía existiendo en Registros, pero el operario veía el turno actual como si no hubiera fichado y no podía registrar la salida desde su tarjeta. Después, el cierre automático sí encontraba esa entrada abierta y generaba la salida automática al superar el límite configurado.

## Corrección aplicada
- La vista del operario busca también turnos nocturnos iniciados el día anterior que tengan entrada y todavía no tengan salida.
- Esos turnos siguen visibles después de medianoche con la leyenda **Turno nocturno iniciado ayer**.
- La salida GPS se registra contra el mismo `shift_id` y la misma fecha de turno de la entrada original.
- El turno del día actual se mantiene independiente.
- No se modificaron tolerancias, cierre automático, horas extra, GPS, asignaciones, alertas ni otros flujos.

No requiere cambios de base de datos ni ejecutar SQL adicional.
