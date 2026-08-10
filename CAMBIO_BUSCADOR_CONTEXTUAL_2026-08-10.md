# Buscador contextual por sección — 10/08/2026

Se agregó un buscador persistente debajo de las pestañas del panel de gestión. El buscador cambia de contexto según la sección actual y filtra en tiempo real la información ya cargada.

## Secciones cubiertas
- En vivo: operario, servicio, dirección, zona y estados operativos.
- Análisis: operario, servicio y datos del detalle RRHH del período.
- Fichaje: operario, servicio, fecha, tipo de trabajo y estado.
- Cobertura: servicio, dirección, zona, supervisor u operario asignado.
- Asignaciones: operario, servicio, cobertura/refuerzo, operario cubierto, notas y horario.
- Servicios: nombre, dirección, zona, supervisor, tipo y contacto.
- Usuarios: nombre, usuario, email, teléfono, rol y notas.
- Registros: operario, servicio, tipo de marcación, estado, fecha y observaciones.

## Comportamiento
- La búsqueda filtra mientras se escribe.
- Se ignoran mayúsculas/minúsculas y tildes.
- Cada pestaña conserva su propia búsqueda al navegar entre secciones.
- El indicador muestra coincidencias sobre el universo actual de la sección.
- Al presionar Enter, la pantalla se desplaza hasta el bloque de resultados.
- En Cobertura, el buscador existente y el nuevo buscador contextual quedan sincronizados.

No requiere migraciones SQL ni cambios en Supabase.
