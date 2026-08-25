# Exportación de gráficos y rankings · 25/08/2026

Se amplió la sección **Análisis** para permitir exportar el dashboard en formatos reutilizables para RRHH y gestión.

## Imágenes
- Selector global de formato: **PNG** (máxima calidad) o **JPG** (alta calidad).
- Descarga individual de los cuatro gráficos: horas confirmadas, ausencias, llegadas tarde y fuera de radio.
- Descarga individual de los tres rankings como imagen.
- Las imágenes se generan en canvas de alta resolución, con título, período, servicio filtrado, orden del ranking y pie de reporte.

## Excel
- Descarga individual de la tabla resumen por operario.
- Descarga individual de cada ranking.
- El Excel completo ahora incorpora además hojas de ranking de horas, ausencias, tardanzas y fuera de radio.

## Descarga completa
El botón **Descargar todo (ZIP)** genera un único paquete con:
- carpeta `graficos/` con los cuatro gráficos;
- carpeta `rankings/` con los tres rankings en imagen;
- carpeta `tablas/` con el Excel completo;
- archivo `LEEME.txt` con el período y filtros aplicados.

El ZIP respeta el formato de imagen elegido en pantalla.

No requiere cambios de base de datos ni migraciones SQL.
