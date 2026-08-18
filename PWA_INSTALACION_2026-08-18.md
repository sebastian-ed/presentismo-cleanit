# PWA instalable — 18/08/2026

Esta versión deja Presentismo GPS preparado como PWA instalable en Chrome/Edge y mantiene el modo offline existente.

## Archivos a publicar

Reemplazar/agregar en la raíz de GitHub Pages:

- `index.html`
- `styles.css`
- `js/app.js`
- `js/storage.js`
- `js/config.js`
- `manifest.webmanifest`
- `sw.js`
- `icons/icon-192.png`
- `icons/icon-512.png`

## Comportamiento

- El manifest tiene identidad (`id`), `start_url` y `scope` explícitos para `/presentismo-cleanit/`.
- El Service Worker se registra con actualización de caché deshabilitada para evitar versiones viejas.
- La app muestra `Instalar app` mientras se usa en el navegador.
- Cuando Chrome dispara `beforeinstallprompt`, el botón abre el instalador nativo.
- Una vez instalada, se abre en modo `standalone`, sin la barra normal de Chrome.

## Nota sobre Chrome

Chrome aplica heurísticas de interacción antes de ofrecer el instalador. Normalmente requiere al menos una interacción y alrededor de 30 segundos de uso. Si se presiona `Instalar app` antes de que Chrome habilite el prompt, la aplicación informa que se espere y se vuelva a intentar.
