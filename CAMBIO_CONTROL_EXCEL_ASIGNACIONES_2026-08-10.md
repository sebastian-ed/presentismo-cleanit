# Control de asignaciones contra Excel — 10/08/2026

## Qué se agregó

En **Asignaciones** aparece un bloque nuevo: **Controlar asignaciones contra Excel**.

La app lee la hoja `Cobertura por día` del archivo de planificación y compara, para una fecha de referencia:

- servicio;
- día de la semana;
- operario;
- horario de entrada y salida.

Las coberturas/refuerzos extraordinarios no forman parte de la comparación: se controla únicamente la programación fija.

## Estados que puede mostrar

- Coincide.
- Sin cobertura · coincide.
- Operario distinto.
- Horario distinto.
- Operario y horario distintos.
- Falta en Presentismo.
- Sobra en Presentismo.
- Servicio no encontrado.
- Operario no encontrado.
- Horario/dato inválido.

Los nombres de operarios se comparan sin depender del orden. Por ejemplo `Franco Maria Evelyn` puede vincularse con `MARIA EVELYN FRANCO` si es el único operario compatible.

## Correcciones

Se puede:

- corregir un servicio+día;
- seleccionar varias diferencias y corregirlas juntas;
- corregir todas las diferencias resolubles.

Al sincronizar, el Excel se toma como fuente de verdad para el **servicio+día completo** seleccionado. Esto evita dejar asignaciones duplicadas o parciales.

El campo **Comparar / aplicar desde** define desde qué fecha entra en vigencia el cambio. Si una asignación ya tenía historia anterior, la app cierra esa versión el día previo y crea la nueva versión desde la fecha elegida, por lo que no reescribe el histórico anterior.

## Servicios faltantes

Si un servicio del Excel no existe en Presentismo y la hoja `Servicios` trae dirección y coordenadas válidas, aparece la acción **Crear servicio desde Excel**. Se crea con radio GPS inicial de 120 m.

Los operarios no se crean automáticamente porque necesitan una cuenta de acceso real. En ese caso aparece **Buscar / crear en Usuarios**.

## Turnos nocturnos

El Excel adjunto incluye horarios como `22:00–06:00 (+1 día)`. Para que Supabase permita guardarlos hay que ejecutar una vez:

`supabase/migrations/20260810_excel_assignment_sync_overnight.sql`

La app interpreta esos turnos como salida al día siguiente.
