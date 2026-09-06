# eur-ars

Conversor EUR–ARS de uso privado.

Muestra el euro oficial (venta, Banco Nación) y el euro blue (compra,
Dolarito), calcula un tipo de cambio intermedio, y convierte entre pesos
argentinos y euros en las dos direcciones.

## Cómo se actualizan las cotizaciones

`dolarito.ar` y `bna.com.ar` son sitios web, no APIs, y no permiten leerlos
directamente desde el navegador (CORS). Por eso la actualización automática
se resuelve así:

1. Un workflow de GitHub Actions (`.github/workflows/actualizar-cotizaciones.yml`)
   corre cada 30 minutos.
2. Ejecuta `scripts/scrape.js`, que abre las dos páginas con un navegador
   headless (Playwright), lee el texto visible y extrae:
   - **Euro oficial**: fecha de la cotización y valor de venta, desde
     `https://www.bna.com.ar/Cotizador/MonedasHistorico`. Los fines de
     semana / feriados el banco no cotiza, así que la fecha queda en el
     último día hábil (la página lo indica).
   - **Euro blue**: valor de compra y antigüedad ("Hace X días/horas"),
     desde `https://www.dolarito.ar/cotizacion/euro-hoy`.
3. Escribe el resultado en `rates.json`, en la raíz del repo, y lo commitea.
4. `index.html` lee `rates.json` con `fetch('./rates.json')` (mismo origen,
   sin problema de CORS) y se reactualiza solo cada 30 minutos mientras está
   abierta, además de al volver a la pestaña.

Si el scraping falla en algún run (el sitio cambió de formato, estuvo caído,
etc.), el workflow **no pisa** el último valor bueno: guarda el error en
`rates.json` (`ultimoIntentoOk: false`, `ultimoError`) y el run de GitHub
Actions queda marcado como fallido (se puede ver en la pestaña *Actions* del
repo). La página muestra un aviso y, mientras tanto, los campos de oficial y
blue se pueden seguir editando a mano.

## Desarrollo / test local

```bash
npm install
npm test              # corre scripts/parse.test.js contra texto de muestra, sin red
npx playwright install --with-deps chromium
npm run scrape         # scrapea de verdad y actualiza rates.json
```

## Requisito en GitHub

Para que el workflow pueda commitear `rates.json`, en el repo hay que tener
habilitado: **Settings → Actions → General → Workflow permissions → "Read
and write permissions"** (ya quedó configurado así). Sin esto, el paso de
`git push` del workflow falla con un error de permisos (se ve enseguida en
el run, en la pestaña Actions).
