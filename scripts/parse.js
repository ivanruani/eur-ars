'use strict';

/**
 * Funciones puras de parseo de texto. Reciben el texto plano de cada página
 * (document.body.innerText) y devuelven los valores que necesitamos.
 * Separadas de Playwright para poder testearlas con texto de muestra sin red.
 */

// Rango de sanidad para pesos por euro: si algo parseado cae fuera de este
// rango, lo tratamos como un error de parseo en vez de confiar en el número.
const MIN_RAZONABLE = 200;
const MAX_RAZONABLE = 20000;

function normalizar(texto) {
  return String(texto).replace(/\s+/g, ' ').trim();
}

// "1.802,05" (formato es-AR) -> 1802.05
function parseNumeroES(str) {
  if (str == null) return NaN;
  return parseFloat(String(str).replace(/\./g, '').replace(',', '.'));
}

function enRango(n) {
  return typeof n === 'number' && !isNaN(n) && n >= MIN_RAZONABLE && n <= MAX_RAZONABLE;
}

/**
 * BNA - https://www.bna.com.ar/Cotizador/MonedasHistorico
 * Formato esperado (texto plano):
 *   Fecha: 4/9/2026
 *   Monedas	Compra	Venta
 *   ...
 *   Euro	1739.1398	1753.3516
 *   ...
 * Los fines de semana / feriados la fecha queda en el último día hábil.
 */
function parseBna(textoCrudo) {
  const texto = normalizar(textoCrudo);

  const matchFecha = texto.match(/Fecha:\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!matchFecha) {
    throw new Error('BNA: no se encontró la etiqueta "Fecha:"');
  }
  const [, d, m, y] = matchFecha;
  const dia = parseInt(d, 10);
  const mes = parseInt(m, 10);
  const anio = parseInt(y, 10);
  const fechaISO = `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;

  // La fila "Euro" tiene dos números decimales con punto (no formato es-AR)
  const matchEuro = texto.match(/\bEuro\s+([\d]+(?:\.\d+)?)\s+([\d]+(?:\.\d+)?)/);
  if (!matchEuro) {
    throw new Error('BNA: no se encontró la fila de "Euro" con compra/venta');
  }
  const compra = parseFloat(matchEuro[1]);
  const venta = parseFloat(matchEuro[2]);

  if (!enRango(compra) || !enRango(venta)) {
    throw new Error(`BNA: valores fuera de rango razonable (compra=${compra}, venta=${venta})`);
  }
  if (venta < compra) {
    // En BNA la venta (el banco te vende) siempre es >= a la compra (el banco te compra)
    throw new Error(`BNA: venta (${venta}) menor que compra (${compra}), posible error de parseo`);
  }

  return { fecha: fechaISO, compra, venta };
}

/**
 * Dolarito - https://www.dolarito.ar/cotizacion/euro-hoy
 * El bloque de "euro blue" en el texto plano tiene esta forma (visible/compacta):
 *   Hace 2 días
 *   $
 *   1.802,05
 *   $
 *   1.707,96
 *   $94,09 (5,51%)
 *   💶 EURO BLUE
 * Es decir: [antigüedad] $ [compra] $ [venta] [spread] [emoji] EURO BLUE
 * Buscamos ese patrón anclado en "EURO BLUE" (case-insensitive) para no
 * confundirlo con los bloques de "EURO OFICIAL" / "EURO TARJETA".
 */
function parseDolaritoBlue(textoCrudo) {
  const texto = normalizar(textoCrudo);

  const regexBloque = /Hace\s+([^$]{2,30}?)\s*\$\s*([\d.,]+)\s*\$\s*([\d.,]+)\s*\$[\d.,]+\s*\([\d.,]+%\)\s*(?:💶\s*)?EURO\s+BLUE/i;
  const match = texto.match(regexBloque);
  if (!match) {
    throw new Error('Dolarito: no se encontró el bloque de "EURO BLUE" con el patrón esperado');
  }

  const antiguedadTexto = match[1].trim();
  const compra = parseNumeroES(match[2]);
  const venta = parseNumeroES(match[3]);

  if (!enRango(compra) || !enRango(venta)) {
    throw new Error(`Dolarito: valores fuera de rango razonable (compra=${compra}, venta=${venta})`);
  }
  if (compra < venta) {
    // Dolarito muestra "Comprá a" (lo que pagás) >= "Vendé a" (lo que te dan)
    throw new Error(`Dolarito: compra (${compra}) menor que venta (${venta}), posible error de parseo`);
  }

  return { antiguedadTexto, compra, venta };
}

/**
 * Convierte un texto de antigüedad tipo "2 días", "minutos", "3 horas",
 * "1 día", "unos segundos" en:
 *  - esDeHoy: boolean
 *  - diasAtras: número aproximado de días (0 si es de hoy)
 */
function interpretarAntiguedad(antiguedadTexto) {
  const t = antiguedadTexto.toLowerCase();
  const matchDias = t.match(/(\d+)\s*d[ií]a/);
  if (matchDias) {
    return { esDeHoy: false, diasAtras: parseInt(matchDias[1], 10) };
  }
  if (/\bd[ií]a\b/.test(t)) {
    // "un día" sin número
    return { esDeHoy: false, diasAtras: 1 };
  }
  // minutos, horas, segundos -> lo consideramos "de hoy"
  return { esDeHoy: true, diasAtras: 0 };
}

module.exports = { parseBna, parseDolaritoBlue, interpretarAntiguedad, parseNumeroES, normalizar };
