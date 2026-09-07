'use strict';
const assert = require('assert');
const { parseBna, parseBnaPizarra, parseDolaritoBlue, parseDolaritoBlueBloque, interpretarAntiguedad } = require('./parse');

// ---- Fixture real capturado directamente del DOM de dolarito.ar (6/9/2026):
// el contenedor .chakra-stack propio de la tarjeta "euro blue", aislado del
// resto de la página (ver parseDolaritoBlueBloque en parse.js). Se comprobó
// que document.body.innerText desalinea la etiqueta de cada tarjeta con sus
// propios valores, por eso ahora se prefiere este método estructural. ----
const DOLARITO_BLOQUE_BLUE = '💶 euro blueHace 18 minutos$1.826,75$1.787,75$39 (2,18%)';
const DOLARITO_BLOQUE_OFICIAL_CON_BADGE = '🏦 euro oficial-0,01%Hace 2 días$1.802,05$1.707,96$94,09 (5,51%)';

// ---- Fixture real capturado hoy domingo 6/9/2026 (BNA muestra el viernes 4/9) ----
const BNA_FIXTURE = `
Cotizaciones de divisas en el Mercado Libre de Cambios "Valor Hoy" al último cierre Operaciones

Fecha: 4/9/2026
Monedas	Compra	Venta
Dolar U.S.A	1499.0000	1508.0000
Libra Esterlina	2024.6993	2041.3796
Euro	1739.1398	1753.3516
Franco Suizos (*)	184986.0654	186347.3780
YENES (*)	959.6131	967.0411
Dolares Canadienses (*)	108263.6192	109072.9709
Coronas Danesas (*)	23249.6709	23539.5393
Coronas Noruegas (*)	16069.2575	16313.6425
Coronas Suecas (*)	15610.3447	15856.2232
Yuan (*)	21878.57583	22972.5046
Dolar Australiano	1077.9309	1087.4188

(*) cotización cada 100 unidades.
`;

// ---- Fixture real capturado de https://www.bna.com.ar/Personas (7/9/2026):
// trae la "pizarra" del día (Dolar U.S.A, Euro, Real) seguida de "Hora
// Actualización", y más abajo la tabla de cierre de mercado del último día
// hábil (el mismo formato que BNA_FIXTURE, de /Cotizador/MonedasHistorico).
// parseBnaPizarra debe quedarse solo con la primera. ----
const BNA_PERSONAS_FIXTURE = `
Cotización de Divisas

7/9/2026 Compra Venta
Dolar U.S.A 1480,00 1530,00
Euro 1700,00 1800,00
Real * 28500,00 30700,00
Ver histórico

Hora Actualización: 09:53

(*) cotización cada 100 unidades.

Fecha: 4/9/2026
Monedas	Compra	Venta
Dolar U.S.A	1499.0000	1508.0000
Libra Esterlina	2024.6993	2041.3796
Euro	1739.1398	1753.3516
Franco Suizos (*)	184986.0654	186347.3780

(*) cotización cada 100 unidades.

El tipo de cambio de cierre de divisa es suministrado al público a fines informativos.
`;

// ---- Fixture: la misma página, pero sin la pizarra del día (por ejemplo si
// BNA le cambia el layout), para probar el respaldo automático a la tabla de
// cierre de mercado. ----
const BNA_PERSONAS_SIN_PIZARRA_FIXTURE = BNA_FIXTURE;

// ---- Fixture real capturado hoy de dolarito.ar/cotizacion/euro-hoy (texto visible) ----
const DOLARITO_FIXTURE = `
DOLARITO
Cotización del euro HOY
Cotización del euro hoy Domingo 6 De Septiembre
...
Hace minutos

$

1.860,30

$

1.814,37

$45,93 (2,53%)

🏦 EURO OFICIAL

-0,01%

Hace 2 días

$

1.802,05

$

1.707,96

$94,09 (5,51%)

💶 EURO BLUE

Hace minutos

$

1.826,75

$

1.787,75

$39 (2,18%)

💳 EURO TARJETA

-0,01%

Hace 2 días

$

2.342,66

Próxima actualización en 5 minutos
`;

// ---- Fixture real capturado hoy (bloque "etiquetado", forma B, con
// "Vendé a:" / "Comprá a:" explícitos — aparece con otros anchos de pantalla) ----
const DOLARITO_FIXTURE_ETIQUETADA = `
Hace minutos

Spread: $45,93 (2,53%)

Vendé a:

1.814,37

Comprá a:

1.860,30

COMPRÁ YA

-0,01%

🏦 euro oficial

Hace 2 días

Spread: $94,09 (5,51%)

Vendé a:

1.707,96

Comprá a:

1.802,05

Compartir cotización

💶 euro blue

Hace minutos

Spread: $39 (2,18%)

Vendé a:

1.787,75

Comprá a:

1.826,75

💳 euro tarjeta
`;

// ---- Fixture real capturado desde un run de GitHub Actions (forma C: la que
// realmente renderiza Playwright headless en el runner de CI — etiquetas en
// MAYÚSCULAS y un "|" separando "Hace X" de "Spread:", que rompía el regex
// de la forma B) ----
const DOLARITO_FIXTURE_CI = `
DOLARITO

Iniciar Sesión

Cotizaciones
Indices
Mercado
Bandas
Conversor
Brecha
Remotito
El mundo
Cotización histórica
Utilidades
Cotización del euro HOY
Cotización del euro hoy Domingo 6 De Septiembre
Euro Oficial, Euro Blue y Euro Tarjeta

COMPARTIR:

WhatsApp
X (Twitter)
Telegram
LinkedIn
Facebook
Copiar enlace
💵
Dólar
💶
Euro
🏦
Bancos
📈
Plazos fijos
Real
⚡️
Cripto
📊
Bandas
Criptos
🌍
El mundo
ENVÍOS INSTANTÁNEOS

Hace 18 minutos

|

Spread: $45,93 (2,53%)

VENDÉ A:

$

1.814,37

COMPRÁ A:

$

1.860,30

COMPRÁ YA

-0,01%

🏦 EURO OFICIAL

Hace 2 días

|

Spread: $94,09 (5,51%)

VENDÉ A:

$

1.707,96

COMPRÁ A:

$

1.802,05

💶 EURO BLUE

Hace 18 minutos

|

Spread: $39 (2,18%)

VENDÉ A:

$

1.787,75

COMPRÁ A:

$

1.826,75

-0,01%

💳 EURO TARJETA

Hace 2 días

VALOR DE REFERENCIA

$

2.342,66

Próxima actualización en 5 minutos
`;

// ---- tests ----
const bna = parseBna(BNA_FIXTURE);
assert.strictEqual(bna.fecha, '2026-09-04');
assert.strictEqual(bna.venta, 1753.3516);
assert.strictEqual(bna.compra, 1739.1398);
console.log('OK parseBna ->', bna);

const bnaPizarra = parseBnaPizarra(BNA_PERSONAS_FIXTURE);
assert.strictEqual(bnaPizarra.fecha, '2026-09-07');
assert.strictEqual(bnaPizarra.compra, 1700);
assert.strictEqual(bnaPizarra.venta, 1800);
assert.strictEqual(bnaPizarra.hora, '09:53');
console.log('OK parseBnaPizarra ->', bnaPizarra);

// Respaldo: usando parseBna (el método anterior) sobre una página que solo
// trae la tabla de cierre de mercado, sigue funcionando igual que antes.
const bnaRespaldo = parseBna(BNA_PERSONAS_SIN_PIZARRA_FIXTURE);
assert.strictEqual(bnaRespaldo.fecha, '2026-09-04');
assert.strictEqual(bnaRespaldo.compra, 1739.1398);
console.log('OK parseBna sigue funcionando como respaldo ->', bnaRespaldo);

// parseBnaPizarra debe rechazar un texto sin "Hora Actualización" (para que
// el scraper sepa que tiene que caer al respaldo).
try {
  parseBnaPizarra(BNA_PERSONAS_SIN_PIZARRA_FIXTURE);
  throw new Error('debería haber lanzado');
} catch (e) {
  assert.ok(/Hora Actualizaci/i.test(e.message));
  console.log('OK parseBnaPizarra lanza error si no hay "Hora Actualización" (dispara el respaldo)');
}

const blue = parseDolaritoBlue(DOLARITO_FIXTURE);
assert.strictEqual(blue.compra, 1802.05);
assert.strictEqual(blue.venta, 1707.96);
assert.strictEqual(blue.antiguedadTexto, '2 días');
console.log('OK parseDolaritoBlue ->', blue);

const blueEtiquetada = parseDolaritoBlue(DOLARITO_FIXTURE_ETIQUETADA);
assert.strictEqual(blueEtiquetada.compra, 1802.05);
assert.strictEqual(blueEtiquetada.venta, 1707.96);
assert.strictEqual(blueEtiquetada.antiguedadTexto, '2 días');
console.log('OK parseDolaritoBlue (forma etiquetada) ->', blueEtiquetada);

const blueCi = parseDolaritoBlue(DOLARITO_FIXTURE_CI);
assert.strictEqual(blueCi.compra, 1802.05);
assert.strictEqual(blueCi.venta, 1707.96);
assert.strictEqual(blueCi.antiguedadTexto, '2 días');
console.log('OK parseDolaritoBlue (forma real de CI) ->', blueCi);

const blueBloque = parseDolaritoBlueBloque(DOLARITO_BLOQUE_BLUE);
assert.strictEqual(blueBloque.compra, 1826.75);
assert.strictEqual(blueBloque.venta, 1787.75);
assert.strictEqual(blueBloque.antiguedadTexto, '18 minutos');
console.log('OK parseDolaritoBlueBloque (tarjeta aislada del DOM) ->', blueBloque);

// El mismo parser aplicado por error a la tarjeta de "euro oficial" debe
// rechazar el bloque (no contiene "euro blue").
try {
  parseDolaritoBlueBloque(DOLARITO_BLOQUE_OFICIAL_CON_BADGE);
  throw new Error('debería haber lanzado');
} catch (e) {
  assert.ok(/no corresponde a la tarjeta/.test(e.message));
  console.log('OK parseDolaritoBlueBloque rechaza un bloque que no es "euro blue"');
}

const antiguedad = interpretarAntiguedad(blue.antiguedadTexto);
assert.strictEqual(antiguedad.esDeHoy, false);
assert.strictEqual(antiguedad.diasAtras, 2);
console.log('OK interpretarAntiguedad ->', antiguedad);

assert.deepStrictEqual(interpretarAntiguedad('minutos'), { esDeHoy: true, diasAtras: 0 });
assert.deepStrictEqual(interpretarAntiguedad('3 horas'), { esDeHoy: true, diasAtras: 0 });
assert.deepStrictEqual(interpretarAntiguedad('1 día'), { esDeHoy: false, diasAtras: 1 });
console.log('OK interpretarAntiguedad casos varios');

// ---- caso de error: bloque no encontrado ----
try {
  parseDolaritoBlue('nada que ver aca');
  throw new Error('debería haber lanzado');
} catch (e) {
  assert.ok(/no se encontró/.test(e.message));
  console.log('OK parseDolaritoBlue lanza error si no matchea');
}

try {
  parseBna('nada que ver aca');
  throw new Error('debería haber lanzado');
} catch (e) {
  assert.ok(/no se encontró/.test(e.message));
  console.log('OK parseBna lanza error si no matchea');
}

console.log('\nTODOS LOS TESTS PASARON');
