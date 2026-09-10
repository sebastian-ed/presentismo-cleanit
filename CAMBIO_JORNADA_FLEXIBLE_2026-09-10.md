# Jornada flexible excepcional · 10/09/2026

- Se puede activar por operario desde **Usuarios**.
- Al activarla se asigna únicamente un **servicio**, sin horario fijo.
- La modalidad tiene vigencia histórica (`valid_from` / `valid_to`) para no alterar reportes anteriores.
- Mientras está activa, las asignaciones horarias habituales de ese operario no generan tardanza ni ausencia automática.
- El operario registra la **hora real** y el **GPS real** de cada entrada y salida.
- Puede fraccionar la jornada en varios tramos: entrada → salida → nueva entrada → nueva salida.
- Los fichajes flexibles no usan el cierre automático de 45 minutos porque no existe una hora de salida programada.
- En **En vivo** se identifican como `Jornada flexible` y pueden filtrarse.
- Los reportes históricos reconocen estos tramos como jornada flexible y no los mezclan con coberturas/refuerzos.

No se modifican las reglas del resto de los operarios.
