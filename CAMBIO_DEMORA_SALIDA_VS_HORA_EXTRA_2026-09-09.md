# Demora de salida vs. horas extra — 2026-09-09

Se ajustó únicamente la clasificación visual y operativa de los minutos posteriores al horario programado de salida.

## Regla nueva
- Pasarse algunos minutos del horario de salida **no se considera hora extra** si el operario no inició una solicitud de hora extra y no existe una autorización cargada.
- Mientras el turno siga abierto, En vivo muestra **“Salida demorada · +X min”**.
- Si el operario luego ficha la salida, se informa **“Salida +X min respecto del horario programado”**.
- Esa demora normal **no entra en el filtro Horas extra** y **no genera una alerta por falta de autorización**.
- El cierre automático habitual sigue vigente. Si se alcanza su límite sin fichar, el caso vuelve a tratarse como falta de salida/cierre automático.

## Horas extra
- El circuito de horas extra queda reservado a los casos donde exista una solicitud del operario o una autorización del supervisor/admin.
- Una solicitud pendiente continúa generando la alerta correspondiente para que sea revisada.
- Se mantienen sin cambios la aprobación/rechazo, el motivo, la hora solicitada, el GPS y el cierre automático extendido para solicitudes/autorizaciones.

## Pantalla del operario
Se aclaró que la solicitud de hora extra corresponde a extensiones excepcionales (cobertura por ausencia, necesidad especial del cliente, etc.). Terminar algunos minutos más tarde no requiere solicitarla.

No requiere una migración SQL adicional respecto de la versión anterior.
