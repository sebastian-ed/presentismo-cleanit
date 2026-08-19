# Protección contra salida accidental — 19/08/2026

## Objetivo
Reducir las salidas registradas por error inmediatamente después de una entrada.

## Comportamiento
- Para turnos que provienen de una asignación, la salida queda bloqueada durante los primeros 10 minutos después de la entrada.
- La tarjeta del operario muestra la hora exacta en que se habilitará la salida.
- Al cumplirse el plazo, la pantalla se actualiza automáticamente y habilita la salida.
- La validación también existe dentro de la función de salida, por lo que no depende solamente del botón deshabilitado.
- Una vez habilitada, antes de pedir GPS aparece una confirmación explícita indicando que registrar la salida cierra el turno.
- Las salidas manuales cargadas por supervisor/administrador no quedan bloqueadas, para conservar una vía de excepción.
- Las coberturas/refuerzos autodeclarados por el operario no tienen el bloqueo temporal por no tener una asignación formal, pero sí reciben la confirmación final.

## Configuración
El plazo por defecto es de 10 minutos. En código se controla con `EXIT_PROTECTION_MINUTES` y puede sobreescribirse con `APP_CONFIG.EXIT_PROTECTION_MINUTES`.

## Instalación
Reemplazar los archivos del paquete de GitHub. No requiere SQL ni cambios en Supabase. El Service Worker incrementa su versión de caché para propagar el cambio a la PWA instalada.
