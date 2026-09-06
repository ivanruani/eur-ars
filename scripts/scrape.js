'use strict';
/**
 * Scraper que corre en GitHub Actions (no en el navegador del usuario, para
 * evitar el problema de CORS al leer HTML de sitios que no son una API).
 *
 * Lee:
 *  - https://www.bna.com.ar/Cotizador/MonedasHistorico  -> euro oficial (venta) + fecha
 *  - https://www.dolarito.ar/cotizacion/euro-hoy         -> euro blue (compra) + antigüedad
 *
 * Escribe rates.json en la raíz del repo, que la página estática lee con
 * fetch('./rates.json') (mismo origen, sin problema de CORS).
 *
 * Si algo falla, NO pisa rates.json (para no perder el último valor bueno):
 * en cambio actualiza rates.json con un bloque "error" y termina con código
 * de salida != 0 para que el run de GitHub Actions quede marcado como fallido.
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { parseBna, parseDolaritoBlue, parseDolaritoBlueBloque, interpretarAntiguedad } = require('./parse');

const BNA_URL = 'https://www.bna.com.ar/Cotizador/MonedasHistorico';
const DOLARITO_URL = 'https://www.dolarito.ar/cotizacion/euro-hoy';
const RATES_PATH = path.join(__dirname, '..', 'rates.json');
const NAV_TIMEOUT_MS = 30000;

function fechaArgentinaISO(date) {
  // Argentina es UTC-3 todo el año (sin horario de verano)
  const argTime = new Date(date.getTime() - 3 * 60 * 60 * 1000);
  return argTime.toISOString().slice(0, 10);
}

async function obtenerTextoVisible(browser, url) {
  const page = await browser.newPage({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  });
  try {
    await page.goto(url, { timeout: NAV_TIMEOUT_MS, waitUntil: 'networkidle' });
    // pequeño margen extra por si algún valor se hidrata unos ms después del networkidle
    await page.waitForTimeout(1500);
    return await page.evaluate(() => document.body.innerText);
  } finally {
    await page.close();
  }
}

/**
 * Dolarito - extracción estructural de la tarjeta "euro blue" (ver comentario
 * largo en parse.js/parseDolaritoBlueBloque para el porqué). Se comprobó
 * (6/9/2026) que document.body.innerText desalinea la etiqueta de cada
 * tarjeta con sus propios valores; en cambio, cada tarjeta de cotización es
 * un <div class="chakra-stack"> autocontenido, así que aislamos y devolvemos
 * SOLO el texto de esa tarjeta puntual (no toda la página), evitando por
 * completo el problema de orden.
 */
async function obtenerBloqueEuroBlueDolarito(browser, url) {
  const page = await browser.newPage({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  });
  try {
    await page.goto(url, { timeout: NAV_TIMEOUT_MS, waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    return await page.evaluate(() => {
      function esVisible(el) {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0;
      }
      const bloques = [...document.querySelectorAll('.chakra-stack')]
        .filter((el) => /\$[\d.,]+/.test(el.textContent) && el.textContent.length < 200 && esVisible(el))
        .map((el) => el.textContent.replace(/\s+/g, ' ').trim());
      // La tarjeta de "euro blue" es la única que menciona "blue" y no
      // "tarjeta" (para no confundirla si alguna vez comparten palabras).
      return bloques.find((t) => /blue/i.test(t) && !/tarjeta/i.test(t)) || null;
    });
  } finally {
    await page.close();
  }
}

function leerRatesExistente() {
  try {
    return JSON.parse(fs.readFileSync(RATES_PATH, 'utf8'));
  } catch (err) {
    return null;
  }
}

async function main() {
  const browser = await chromium.launch();
  const scrapedAt = new Date();
  const errores = [];
  let oficial = null;
  let blue = null;

  try {
    const textoBna = await obtenerTextoVisible(browser, BNA_URL);
    try {
      oficial = parseBna(textoBna);
    } catch (parseErr) {
      console.error('--- BNA: texto crudo (diagnóstico, primeros 3000 caracteres) ---');
      console.error(textoBna.slice(0, 3000));
      throw parseErr;
    }
  } catch (err) {
    errores.push(err.message);
  }

  try {
    // Método preferido: aislar el contenedor DOM propio de la tarjeta "euro
    // blue" (evita el desalineamiento entre el orden del texto plano de la
    // página y el orden visual de las tarjetas, ver parse.js).
    let blueParsed;
    const bloqueBlue = await obtenerBloqueEuroBlueDolarito(browser, DOLARITO_URL);
    if (bloqueBlue) {
      try {
        blueParsed = parseDolaritoBlueBloque(bloqueBlue);
      } catch (parseErr) {
        console.error('--- Dolarito: bloque de "euro blue" (diagnóstico) ---');
        console.error(bloqueBlue);
        throw parseErr;
      }
    } else {
      // Respaldo: si el sitio cambió de estructura y ya no hay un
      // contenedor .chakra-stock reconocible, volvemos al método anterior
      // basado en texto plano + regex (menos confiable, pero mejor que nada).
      const textoDolarito = await obtenerTextoVisible(browser, DOLARITO_URL);
      try {
        blueParsed = parseDolaritoBlue(textoDolarito);
      } catch (parseErr) {
        console.error('--- Dolarito: no se encontró bloque estructural; texto crudo (diagnóstico, primeros 3000 caracteres) ---');
        console.error(textoDolarito.slice(0, 3000));
        throw parseErr;
      }
    }
    const antiguedad = interpretarAntiguedad(blueParsed.antiguedadTexto);
    blue = { ...blueParsed, ...antiguedad };
  } catch (err) {
    errores.push(err.message);
  }

  await browser.close();

  const anterior = leerRatesExistente();

  if (errores.length > 0) {
    // No pisamos los valores buenos anteriores: solo anotamos el intento fallido.
    const salida = {
      ...(anterior || {}),
      ultimoIntento: scrapedAt.toISOString(),
      ultimoIntentoOk: false,
      ultimoError: errores.join(' | '),
    };
    fs.writeFileSync(RATES_PATH, JSON.stringify(salida, null, 2) + '\n');
    console.error('Scrape con errores:\n' + errores.join('\n'));
    process.exit(1);
  }

  const diasAtrasBlue = blue.diasAtras || 0;
  const fechaAproxBlue = fechaArgentinaISO(
    new Date(scrapedAt.getTime() - diasAtrasBlue * 24 * 60 * 60 * 1000)
  );

  const salida = {
    oficial: {
      venta: oficial.venta,
      compra: oficial.compra,
      fecha: oficial.fecha,
      fuente: 'Banco Nación',
      fuenteUrl: BNA_URL,
    },
    blue: {
      compra: blue.compra,
      venta: blue.venta,
      esDeHoy: blue.esDeHoy,
      antiguedadTexto: blue.antiguedadTexto,
      fechaAprox: fechaAproxBlue,
      fuente: 'Dolarito',
      fuenteUrl: DOLARITO_URL,
    },
    scrapedAt: scrapedAt.toISOString(),
    ultimoIntento: scrapedAt.toISOString(),
    ultimoIntentoOk: true,
    ultimoError: null,
  };

  fs.writeFileSync(RATES_PATH, JSON.stringify(salida, null, 2) + '\n');
  console.log('Scrape OK:', JSON.stringify(salida, null, 2));
}

main().catch((err) => {
  console.error('Error inesperado en el scraper:', err);
  process.exit(1);
});
