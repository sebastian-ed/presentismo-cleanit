# Filtro de operarios en Análisis · 06/10/2026

Se agregó un selector de operarios incluidos en la pestaña **Análisis**.

- Todos los operarios aparecen incluidos por defecto.
- Supervisor/Admin puede desmarcar cualquier operario para quitarlo del análisis.
- Los operarios excluidos dejan de participar en KPIs, gráficos, rankings, tabla resumen y exportaciones CSV/Excel/ZIP.
- La exclusión no elimina usuarios ni registros históricos.
- Se agregó búsqueda rápida dentro del selector.
- Se agregó acción **Incluir todos** para restaurar el análisis completo.
- Se agregó acción **Excluir inactivos** para quitar de una vez a perfiles ya desactivados.
- La selección queda guardada en el navegador para no tener que repetirla en cada análisis.

No requiere cambios SQL ni migraciones de Supabase.
