# Encabezados y scrollbar globales · 10/08/2026

Se agregó una capa de navegación para todas las tablas del panel de gestión:

- Encabezado flotante: cuando el usuario baja y los títulos de columnas salen de la vista, se muestra una copia fija y sincronizada horizontalmente.
- Scrollbar horizontal flotante: cuando una tabla ancha continúa por debajo del viewport, aparece una barra en el borde inferior de la pantalla y controla esa tabla.
- Al llegar al final de la tabla, se vuelve a usar la barra nativa y la barra flotante desaparece.
- Funciona sobre cualquier contenedor `.responsive-table`: En vivo, Fichaje, Análisis, control contra Excel y Registros.
- No requiere SQL ni cambios en Supabase.
