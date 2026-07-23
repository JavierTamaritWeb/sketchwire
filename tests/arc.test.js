'use strict';
/* ============================================================
   arc.test.js — Tests de js/arc.js (geometría de arcos circulares)
   y de la validación del flag `arc` en Exporter.isValidElement.
   Los objetos devueltos por el vm se leen por propiedades numéricas
   (primitivas), sin comparar prototipos entre realms.
   ============================================================ */

const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers/load.js');

function freshArc() {
  return load('js/arc.js').ArcMath;
}

/** Punto de la cúbica p1–c1–c2–p2 en t. */
function cubicAt(x1, y1, c, x2, y2, t) {
  const mt = 1 - t;
  return {
    x: mt * mt * mt * x1 + 3 * mt * mt * t * c.cx + 3 * mt * t * t * c.cx2 + t * t * t * x2,
    y: mt * mt * mt * y1 + 3 * mt * mt * t * c.cy + 3 * mt * t * t * c.cy2 + t * t * t * y2,
  };
}

/** Circuncentro de tres puntos (no colineales). */
function circumcenter(a, b, c) {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  const a2 = a.x * a.x + a.y * a.y;
  const b2 = b.x * b.x + b.y * b.y;
  const c2 = c.x * c.x + c.y * c.y;
  return {
    x: (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d,
    y: (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d,
  };
}

/** Aserción: todos los puntos muestreados equidistan del centro (± tol·R). */
function assertOnCircle(x1, y1, c, x2, y2, center, R, tol) {
  for (let i = 0; i <= 20; i++) {
    const p = cubicAt(x1, y1, c, x2, y2, i / 20);
    const d = Math.hypot(p.x - center.x, p.y - center.y);
    assert.ok(Math.abs(d - R) <= tol * R,
      `t=${i / 20}: distancia ${d.toFixed(3)} vs radio ${R.toFixed(3)}`);
  }
}

test('arcCtrls: semicírculo (s = h) queda sobre la circunferencia de radio L/2', () => {
  const ArcMath = freshArc();
  const c = ArcMath.arcCtrls(0, 0, 100, 0, 50);
  assert.ok(c, 'controles esperados');
  // Ápice exacto por construcción: B(0.5) = punto medio + s·u, con u = (0,1)
  const apex = cubicAt(0, 0, c, 100, 0, 0.5);
  assert.ok(Math.abs(apex.x - 50) < 1e-9 && Math.abs(apex.y - 50) < 1e-9,
    `ápice en (50,50), fue (${apex.x},${apex.y})`);
  // Semicírculo: centro en el punto medio de la cuerda, error radial ≤ 2%
  assertOnCircle(0, 0, c, 100, 0, { x: 50, y: 0 }, 50, 0.02);
});

test('arcCtrls: arco menor (s < h) — R = (h²+s²)/(2s) y error radial ≤ 1%', () => {
  const ArcMath = freshArc();
  const c = ArcMath.arcCtrls(0, 0, 100, 0, 25);
  assert.ok(c);
  // R = (50² + 25²) / (2·25) = 62.5, centro en (50, −37.5)
  assertOnCircle(0, 0, c, 100, 0, { x: 50, y: -37.5 }, 62.5, 0.01);
});

test('arcCtrls: cuerda rotada y trasladada sigue siendo circular', () => {
  const ArcMath = freshArc();
  const [x1, y1, x2, y2, s] = [20, 30, 140, 110, 37];
  const c = ArcMath.arcCtrls(x1, y1, x2, y2, s);
  assert.ok(c);
  const apex = cubicAt(x1, y1, c, x2, y2, 0.5);
  const center = circumcenter({ x: x1, y: y1 }, apex, { x: x2, y: y2 });
  const R = Math.hypot(x1 - center.x, y1 - center.y);
  assertOnCircle(x1, y1, c, x2, y2, center, R, 0.01);
});

test('arcCtrls: el signo de s elige el lado', () => {
  const ArcMath = freshArc();
  const pos = ArcMath.arcCtrls(0, 0, 100, 0, 40);
  const neg = ArcMath.arcCtrls(0, 0, 100, 0, -40);
  // u = (0,1): s positiva comba hacia y>0, negativa hacia y<0
  assert.ok(cubicAt(0, 0, pos, 100, 0, 0.5).y > 0);
  assert.ok(cubicAt(0, 0, neg, 100, 0, 0.5).y < 0);
});

test('arcCtrls: |s| > h se recorta al semicírculo', () => {
  const ArcMath = freshArc();
  const c = ArcMath.arcCtrls(0, 0, 100, 0, 500);
  const apex = cubicAt(0, 0, c, 100, 0, 0.5);
  assert.ok(Math.abs(apex.y - 50) < 1e-9, `comba recortada a h=50, fue ${apex.y}`);
});

test('arcCtrls: degenerados devuelven null sin lanzar', () => {
  const ArcMath = freshArc();
  assert.equal(ArcMath.arcCtrls(10, 10, 10, 10, 30), null);   // cuerda 0
  assert.equal(ArcMath.arcCtrls(0, 0, 100, 0, 0), null);      // sagitta 0
  assert.equal(ArcMath.arcCtrls(0, 0, 100, 0, NaN), null);
  assert.equal(ArcMath.arcCtrls(0, 0, 100, 0, Infinity), null);
});

test('arcSagitta: round-trip con arcCtrls y soporte de cuadráticas', () => {
  const ArcMath = freshArc();
  const [x1, y1, x2, y2, s] = [20, 30, 140, 110, -33];
  const c = ArcMath.arcCtrls(x1, y1, x2, y2, s);
  const el = { x1, y1, x2, y2, cx: c.cx, cy: c.cy, cx2: c.cx2, cy2: c.cy2 };
  assert.ok(Math.abs(ArcMath.arcSagitta(el) - s) < 1e-6, 'sagitta recuperada');
  // Cuadrática: B(0.5) = (p1 + 2c + p2)/4 → control a 2s del punto medio
  const q = { x1: 0, y1: 0, x2: 100, y2: 0, cx: 50, cy: 60 };
  assert.ok(Math.abs(ArcMath.arcSagitta(q) - 30) < 1e-9);
  // Cuerda degenerada
  assert.equal(ArcMath.arcSagitta({ x1: 5, y1: 5, x2: 5, y2: 5, cx: 0, cy: 0 }), 0);
});

test('clampSagitta: conserva el signo y recorta a [min(6,h), h]', () => {
  const ArcMath = freshArc();
  assert.equal(ArcMath.clampSagitta(200, 100), 50);   // tope: semicírculo
  assert.equal(ArcMath.clampSagitta(-200, 100), -50);
  assert.equal(ArcMath.clampSagitta(2, 100), 6);      // mínimo visible
  assert.equal(ArcMath.clampSagitta(-2, 100), -6);
  assert.equal(ArcMath.clampSagitta(30, 100), 30);    // dentro del rango
  assert.equal(ArcMath.clampSagitta(0, 100), 6);      // s=0 → lado positivo
  assert.equal(ArcMath.clampSagitta(9, 8), 4);        // cuerda corta: h < 6
});

test('isValidElement: flag arc — solo `true` y solo en cúbicas', () => {
  const ctx = load('js/sketchy.js', 'js/renderer.js', 'js/exporter.js');
  const base = {
    type: 'curveArrow', x1: 0, y1: 0, x2: 100, y2: 0,
    cx: 0, cy: 66, cx2: 100, cy2: 66,
    color: '#111111', lineWidth: 2,
  };
  assert.equal(ctx.Exporter.isValidElement({ ...base, arc: true }), true);
  assert.equal(ctx.Exporter.isValidElement(base), true); // sin flag sigue ok
  assert.equal(ctx.Exporter.isValidElement({ ...base, arc: false }), false);
  assert.equal(ctx.Exporter.isValidElement({ ...base, arc: 'yes' }), false);
  const quad = { ...base, arc: true };
  delete quad.cx2;
  delete quad.cy2;
  assert.equal(ctx.Exporter.isValidElement(quad), false); // arc exige cúbica
  // heads:'none' (semicírculo sin puntas) entra en la whitelist
  assert.equal(ctx.Exporter.isValidElement({ ...base, arc: true, heads: 'none' }), true);
  assert.equal(ctx.Exporter.isValidElement({ ...base, heads: 'nope' }), false);
});

test('Exporter.svg: un semicírculo heads:"none" no lleva puntas de flecha', () => {
  const ctx = load('js/sketchy.js', 'js/renderer.js', 'js/exporter.js');
  const semi = {
    type: 'curveArrow', x1: 0, y1: 0, x2: 100, y2: 0,
    cx: 0, cy: 66.67, cx2: 100, cy2: 66.67,
    arc: true, heads: 'none',
    color: '#111111', lineWidth: 2, seed: 1,
  };
  ctx.Exporter.svg([semi]);
  const blobs = ctx.URL.blobs;
  const out = blobs[blobs.length - 1].content;
  assert.ok(out.includes('<path'), 'el trazo del arco se exporta como <path>');
  // Las puntas se exportan como pares de <line>; sin puntas no hay ninguna
  assert.ok(!out.includes('<line'), 'no debe haber <line> de punta de flecha');
  // Con heads por defecto sí aparecen las 2 <line> de la punta
  const withHead = { ...semi };
  delete withHead.heads;
  ctx.Exporter.svg([withHead]);
  const out2 = blobs[blobs.length - 1].content;
  assert.equal((out2.match(/<line /g) || []).length, 2);
});
