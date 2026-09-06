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
const { parseBna, parseDolaritoBlue, interpretarAntiguedad } = require('./parse');

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
    oficial = parseBna(textoBna);
  } catch (err) {
    errores.push(err.message);
  }

  try {
    const textoDolarito = await obtenerTextoVisible(browser, DOLARITO_URL);
    const blueParsed = parseDolaritoBlue(textoDolarito);
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
