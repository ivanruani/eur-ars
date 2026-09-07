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
 * BNA - https://www.bna.com.ar/Personas (tabla "pizarra" del día, con
 * "Hora Actualización: HH:MM"), fuente PREFERIDA para el euro oficial
 * (confirmado en vivo el 7/9/2026: la hora de actualización avanza durante
 * el día, 09:53 -> 15:02, a diferencia de la tabla de cierre de mercado que
 * solo se actualiza una vez por día hábil).
 *
 * Esta página SOLO muestra, en document.body.innerText, la tabla de la
 * "pizarra" del día (Dolar U.S.A, Euro, Real) seguida de "Hora
 * Actualización: HH:MM". La tabla de cierre de mercado (la misma de
 * /Cotizador/MonedasHistorico, con 11 monedas) NO aparece en el texto
 * visible de esta página -queda oculta detrás del botón "Ver histórico"-,
 * así que el respaldo para esa tabla se busca en su propia URL aparte (ver
 * BNA_HISTORICO_URL en scrape.js), no en este mismo texto.
 *
 * Nos quedamos con el texto ANTES de "Hora Actualización" (por si en algún
 * momento la tabla histórica sí llegara a aparecer más abajo) y buscamos
 * ahí la fecha y la fila de "Euro".
 *
 * Formato esperado (texto plano, dentro del bloque de la pizarra):
 *   7/9/2026 Compra Venta
 *   Dolar U.S.A 1480,00 1530,00
 *   Euro 1700,00 1800,00
 *   Real * 28500,00 30700,00
 *   Hora Actualización: 09:53
 * Los valores usan coma decimal (formato es-AR), sin separador de miles
 * cuando el número entra en 4 cifras (parseNumeroES soporta ambos casos).
 */
function parseBnaPizarra(textoCrudo) {
  const texto = normalizar(textoCrudo);

  const idxHora = texto.search(/Hora\s+Actualizaci[oó]n/i);
  if (idxHora === -1) {
    throw new Error('BNA (pizarra): no se encontró la etiqueta "Hora Actualización"');
  }
  const bloque = texto.slice(0, idxHora);

  const matchFecha = bloque.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!matchFecha) {
    throw new Error('BNA (pizarra): no se encontró una fecha antes de "Hora Actualización"');
  }
  const [, d, m, y] = matchFecha;
  const dia = parseInt(d, 10);
  const mes = parseInt(m, 10);
  const anio = parseInt(y, 10);
  const fechaISO = `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;

  const matchEuro = bloque.match(/\bEuro\s+([\d.,]+)\s+([\d.,]+)/i);
  if (!matchEuro) {
    throw new Error('BNA (pizarra): no se encontró la fila de "Euro" con compra/venta');
  }
  const compra = parseNumeroES(matchEuro[1]);
  const venta = parseNumeroES(matchEuro[2]);

  if (!enRango(compra) || !enRango(venta)) {
    throw new Error(`BNA (pizarra): valores fuera de rango razonable (compra=${compra}, venta=${venta})`);
  }
  if (venta < compra) {
    throw new Error(`BNA (pizarra): venta (${venta}) menor que compra (${compra}), posible error de parseo`);
  }

  const matchHora = texto.slice(idxHora, idxHora + 60).match(/Hora\s+Actualizaci[oó]n:?\s*(\d{1,2}:\d{2})/i);
  const hora = matchHora ? matchHora[1] : null;

  return { fecha: fechaISO, compra, venta, hora };
}

/**
 * Dolarito - https://www.dolarito.ar/cotizacion/euro-hoy
 *
 * Según el ancho de pantalla con el que Playwright renderice la página,
 * dolarito.ar muestra el bloque de "euro blue" en el texto plano de dos
 * formas distintas (comprobado en la práctica: una corre en el navegador de
 * escritorio y otra en el layout angosto/mobile):
 *
 * Forma A (compacta, sin etiquetas):
 *   Hace 2 días
 *   $
 *   1.802,05
 *   $
 *   1.707,96
 *   $94,09 (5,51%)
 *   💶 EURO BLUE
 *   -> [antigüedad] $ [compra] $ [venta] [spread] [emoji] EURO BLUE
 *
 * Forma B (con etiquetas explícitas, "Vendé a:" / "Comprá a:"):
 *   Hace 2 días
 *   Spread: $94,09 (5,51%)
 *   Vendé a:
 *   1.707,96
 *   Comprá a:
 *   1.802,05
 *   ...
 *   💶 euro blue
 *   -> [antigüedad] ... Vendé a: [venta] ... Comprá a: [compra] ... euro blue
 *
 * Forma C (variante real observada en el runner de GitHub Actions: mismas
 * etiquetas que la forma B, pero en mayúsculas, con un "|" separando la
 * antigüedad del "Spread:", y el "$" en su propia línea):
 *   Hace 18 minutos
 *   |
 *   Spread: $94,09 (5,51%)
 *   VENDÉ A:
 *   $
 *   1.707,96
 *   COMPRÁ A:
 *   $
 *   1.802,05
 *   💶 EURO BLUE
 *
 * Probamos las tres formas en orden. Todas se anclan en "EURO BLUE"
 * (case-insensitive) para no confundirse con los bloques de "EURO OFICIAL" /
 * "EURO TARJETA". La forma B/C usa un separador acotado (nada de comodines
 * sin límite) entre la antigüedad y "Spread:" para tolerar el "|" u otro
 * separador sin poder saltar de un bloque a otro.
 */
function parseDolaritoBlue(textoCrudo) {
  const texto = normalizar(textoCrudo);

  // Forma A: todo pegado, sin gaps grandes entre "Hace X" y los valores.
  const regexCompacta = /Hace\s+([^$]{2,30}?)\s*\$\s*([\d.,]+)\s*\$\s*([\d.,]+)\s*\$[\d.,]+\s*\([\d.,]+%\)\s*(?:💶\s*)?EURO\s+BLUE/i;
  // Forma B/C: secuencia "Hace X [separador] Spread: $S (P%) Vendé/VENDÉ a:
  // V Comprá/COMPRÁ a: C". El separador entre la antigüedad y "Spread:" es
  // una clase acotada de caracteres que no son letra/dígito (space, "|",
  // etc.) para tolerar variantes de maquetado sin abrir la puerta a que el
  // regex se cuele de un bloque a otro.
  const regexEtiquetada = /Hace\s+([0-9a-zA-ZáéíóúÁÉÍÓÚñÑ ]{2,20}?)[^A-Za-zÁÉÍÓÚáéíóúÑñ0-9]{0,6}Spread:\s*\$[\d.,]+\s*\([\d.,]+%\)\s*Vend[eéÉ] a:?\s*\$?\s*([\d.,]+)\s*Compr[aáÁ] a:?\s*\$?\s*([\d.,]+)[^H]{0,40}?(?:💶\s*)?euro\s+blue/i;

  let antiguedadTexto, compra, venta;

  const matchCompacta = texto.match(regexCompacta);
  if (matchCompacta) {
    antiguedadTexto = matchCompacta[1].trim();
    compra = parseNumeroES(matchCompacta[2]);
    venta = parseNumeroES(matchCompacta[3]);
  } else {
    const matchEtiquetada = texto.match(regexEtiquetada);
    if (!matchEtiquetada) {
      throw new Error('Dolarito: no se encontró el bloque de "EURO BLUE" con ninguno de los patrones esperados');
    }
    antiguedadTexto = matchEtiquetada[1].trim();
    venta = parseNumeroES(matchEtiquetada[2]);
    compra = parseNumeroES(matchEtiquetada[3]);
  }

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
 * Dolarito - extracción estructural (método preferido).
 *
 * Se descubrió (6/9/2026) que en document.body.innerText el texto de la
 * etiqueta de cada tarjeta ("EURO OFICIAL" / "EURO BLUE" / "EURO TARJETA")
 * queda ubicado, en el orden lineal del texto, INMEDIATAMENTE DESPUÉS de los
 * valores de la tarjeta SIGUIENTE en vez de los propios — un desalineamiento
 * real entre el orden del texto plano y el orden visual con el que Dolarito
 * arma la grilla (probablemente por cómo React/Chakra UI intercala la
 * tarjeta promocional "Global66" y anima los cambios de valor). Esto hacía
 * que parseDolaritoBlue (basada en texto plano + regex) devolviera el valor
 * de OTRA tarjeta, no el de "euro blue".
 *
 * La forma confiable de evitar este problema es no usar innerText de toda la
 * página, sino aislar el contenedor DOM propio de la tarjeta "euro blue"
 * (cada tarjeta es un <div class="chakra-stack"> autocontenido con su propia
 * etiqueta y sus propios valores) y parsear solo el texto de ESE
 * contenedor. Esta función recibe ya ese texto aislado (ver
 * obtenerBloqueEuroBlueDolarito en scrape.js), típicamente algo como:
 *   "💶 euro blueHace 18 minutos$1.826,75$1.787,75$39 (2,18%)"
 * (sin espacios entre nodos de texto pegados, de ahí el uso de \s* en vez de
 * \s+ entre tokens).
 */
function parseDolaritoBlueBloque(bloqueTexto) {
  const texto = normalizar(bloqueTexto);

  if (!/euro\s+blue/i.test(texto)) {
    throw new Error('Dolarito: el bloque recibido no corresponde a la tarjeta de "euro blue": ' + texto);
  }

  const match = texto.match(/euro\s+blue.*?Hace\s+([^$]+?)\s*\$\s*([\d.,]+)\s*\$\s*([\d.,]+)/i);
  if (!match) {
    throw new Error('Dolarito: no se pudo extraer compra/venta del bloque de "euro blue": ' + texto);
  }

  const antiguedadTexto = match[1].trim();
  const compra = parseNumeroES(match[2]);
  const venta = parseNumeroES(match[3]);

  if (!enRango(compra) || !enRango(venta)) {
    throw new Error(`Dolarito: valores fuera de rango razonable (compra=${compra}, venta=${venta})`);
  }
  if (compra < venta) {
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

module.exports = { parseBna, parseBnaPizarra, parseDolaritoBlue, parseDolaritoBlueBloque, interpretarAntiguedad, parseNumeroES, normalizar };
