'use strict';
const assert = require('assert');
const { parseBna, parseDolaritoBlue, interpretarAntiguedad } = require('./parse');

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

// ---- tests ----
const bna = parseBna(BNA_FIXTURE);
assert.strictEqual(bna.fecha, '2026-09-04');
assert.strictEqual(bna.venta, 1753.3516);
assert.strictEqual(bna.compra, 1739.1398);
console.log('OK parseBna ->', bna);

const blue = parseDolaritoBlue(DOLARITO_FIXTURE);
assert.strictEqual(blue.compra, 1802.05);
assert.strictEqual(blue.venta, 1707.96);
assert.strictEqual(blue.antiguedadTexto, '2 días');
console.log('OK parseDolaritoBlue ->', blue);

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
