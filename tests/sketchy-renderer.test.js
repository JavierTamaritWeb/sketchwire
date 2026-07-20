'use strict';
/* ============================================================
   sketchy-renderer.test.js — Tests de js/sketchy.js y js/renderer.js
   contra el stub de CanvasRenderingContext2D (ctx-stub.js).

   Nota: Sketchy usa Math.random() (jitter ±roughness/2 por coordenada),
   así que se comprueban secuencias de llamadas y rangos, nunca
   coordenadas exactas (salvo moveTo inicial, que no lleva jitter).
   ============================================================ */
const test = require('node:test');
const assert = require('node:assert/strict');
const { load, createCtxStub } = require('./helpers/load.js');

// Contexto compartido de solo-lectura (Sketchy/Renderer no mutan estado propio).
const vmCtx = load('js/sketchy.js', 'js/renderer.js');
const { Sketchy, Renderer } = vmCtx;

/* ────────────────────────────────────────────────────────────
   Sketchy
   ──────────────────────────────────────────────────────────── */

test('Sketchy.line: beginPath + moveTo + lineTo(s) + stroke, puntos cerca de la recta', () => {
  const ctx = createCtxStub();
  const roughness = 1.5;
  Sketchy.line(ctx, 0, 0, 100, 0, roughness);

  const names = ctx.methodNames();
  // len=100 → segments = max(2, floor(100/20)) = 5
  assert.deepEqual(names, [
    'beginPath', 'moveTo', 'lineTo', 'lineTo', 'lineTo', 'lineTo', 'lineTo', 'stroke',
  ]);

  // El punto inicial es exacto (sin jitter)
  assert.deepEqual(ctx.callsTo('moveTo')[0].args, [0, 0]);

  // Cada lineTo debe quedar a ±roughness/2 de su punto teórico sobre la recta
  const tol = roughness / 2 + 1e-9;
  const lineTos = ctx.callsTo('lineTo');
  lineTos.forEach((c, idx) => {
    const t = (idx + 1) / lineTos.length;
    const [px, py] = c.args;
    assert.ok(Math.abs(px - 100 * t) <= tol, `x del segmento ${idx}: ${px} vs ${100 * t}`);
    assert.ok(Math.abs(py - 0) <= tol, `y del segmento ${idx}: ${py}`);
  });
  // Comportamiento actual: el punto FINAL también lleva jitter, así que la
  // línea puede no terminar exactamente en (x2, y2) — solo a ±roughness/2.
});

test('Sketchy.line corta: mínimo 2 segmentos', () => {
  const ctx = createCtxStub();
  Sketchy.line(ctx, 0, 0, 10, 10, 1);
  // len ≈ 14.14 → floor(14.14/20)=0 → max(2, 0) = 2 segmentos
  assert.equal(ctx.callsTo('lineTo').length, 2);
  assert.equal(ctx.callsTo('beginPath').length, 1);
  assert.equal(ctx.callsTo('stroke').length, 1);
});

test('Sketchy.rect: dibuja exactamente 4 líneas (4 beginPath + 4 stroke)', () => {
  const ctx = createCtxStub();
  Sketchy.rect(ctx, 10, 20, 100, 50, 1.5);

  assert.equal(ctx.callsTo('beginPath').length, 4);
  assert.equal(ctx.callsTo('stroke').length, 4);

  // Los 4 moveTo son las esquinas exactas, en orden: top, right, bottom, left
  const starts = ctx.callsTo('moveTo').map(c => c.args);
  assert.deepEqual(starts, [
    [10, 20],        // top: (x,y) → (x+w,y)
    [110, 20],       // right: (x+w,y) → (x+w,y+h)
    [110, 70],       // bottom: (x+w,y+h) → (x,y+h)
    [10, 70],        // left: (x,y+h) → (x,y)
  ]);
});

test('Sketchy.ellipse: 37 puntos (1 moveTo + 36 lineTo) a radio correcto ± roughness', () => {
  const ctx = createCtxStub();
  const cx = 100, cy = 80, r = 50, roughness = 1.5;
  Sketchy.ellipse(ctx, cx, cy, r, r, roughness);

  const moveTos = ctx.callsTo('moveTo');
  const lineTos = ctx.callsTo('lineTo');
  assert.equal(moveTos.length, 1);
  assert.equal(lineTos.length, 36); // 37 puntos en total (i = 0..36 inclusive)
  assert.equal(ctx.callsTo('beginPath').length, 1);
  assert.equal(ctx.callsTo('closePath').length, 1);
  assert.equal(ctx.callsTo('stroke').length, 1);

  // Todos los puntos a distancia r del centro, con tolerancia por el jitter
  // (±roughness/2 en cada eje → desviación radial máxima < roughness)
  const pts = [...moveTos, ...lineTos].map(c => c.args);
  for (const [px, py] of pts) {
    const d = Math.hypot(px - cx, py - cy);
    assert.ok(Math.abs(d - r) <= roughness, `distancia ${d} fuera de ${r} ± ${roughness}`);
  }
});

test('Sketchy.arrow: línea principal + 2 líneas de cabeza', () => {
  const ctx = createCtxStub();
  Sketchy.arrow(ctx, 0, 0, 100, 0, 1.5);

  // 3 llamadas a line() → 3 beginPath + 3 stroke
  assert.equal(ctx.callsTo('beginPath').length, 3);
  assert.equal(ctx.callsTo('stroke').length, 3);

  // moveTo exactos: principal desde (0,0); las 2 de cabeza desde la punta (100,0)
  const starts = ctx.callsTo('moveTo').map(c => c.args);
  assert.equal(starts.length, 3);
  assert.deepEqual(starts[0], [0, 0]);
  assert.deepEqual(starts[1], [100, 0]);
  assert.deepEqual(starts[2], [100, 0]);

  // Las líneas de cabeza terminan a headLen=14 de la punta (± jitter)
  // (el último lineTo de cada línea de cabeza es su extremo)
  const names = ctx.methodNames();
  const strokeIdx = names.reduce((acc, n, i) => (n === 'stroke' ? [...acc, i] : acc), []);
  for (const si of [strokeIdx[1], strokeIdx[2]]) {
    const lastLineTo = ctx.calls[si - 1];
    assert.equal(lastLineTo.name, 'lineTo');
    const [hx, hy] = lastLineTo.args;
    const d = Math.hypot(hx - 100, hy - 0);
    assert.ok(Math.abs(d - 14) <= 1.5 + 1e-9, `cabeza a distancia ${d}, esperado ~14`);
  }
});

/* ────────────────────────────────────────────────────────────
   Renderer.renderElement
   ──────────────────────────────────────────────────────────── */

function baseEl(extra) {
  return Object.assign({ color: '#1a1a2e', lineWidth: 2 }, extra);
}

/** Renderiza y devuelve el ctx; asegura save/restore como primera/última llamada. */
function render(el) {
  const ctx = createCtxStub();
  assert.doesNotThrow(() => Renderer.renderElement(ctx, el), `tipo ${el.type} no debe lanzar`);
  const names = ctx.methodNames();
  assert.equal(names[0], 'save', `${el.type}: primera llamada save`);
  assert.equal(names[names.length - 1], 'restore', `${el.type}: última llamada restore`);
  return ctx;
}

test('renderElement pencil: polyline exacta por los puntos', () => {
  const pts = [{ x: 1, y: 2 }, { x: 3, y: 4 }, { x: 5, y: 6 }];
  const ctx = render(baseEl({ type: 'pencil', points: pts }));
  assert.deepEqual(ctx.callsTo('moveTo')[0].args, [1, 2]);
  assert.deepEqual(ctx.callsTo('lineTo').map(c => c.args), [[3, 4], [5, 6]]);
  assert.equal(ctx.callsTo('stroke').length, 1);
  // El color/grosor del elemento se aplican
  assert.deepEqual(ctx.callsTo('set strokeStyle')[0].args, ['#1a1a2e']);
  assert.deepEqual(ctx.callsTo('set lineWidth')[0].args, [2]);
});

test('renderElement pencil con 1 solo punto: no dibuja nada', () => {
  const ctx = render(baseEl({ type: 'pencil', points: [{ x: 1, y: 2 }] }));
  assert.equal(ctx.callsTo('beginPath').length, 0);
  assert.equal(ctx.callsTo('stroke').length, 0);
  assert.equal(ctx.callsTo('moveTo').length, 0);
});

test('renderElement line: delega en Sketchy.line (1 stroke)', () => {
  const ctx = render(baseEl({ type: 'line', x1: 0, y1: 0, x2: 80, y2: 60 }));
  assert.equal(ctx.callsTo('beginPath').length, 1);
  assert.equal(ctx.callsTo('stroke').length, 1);
  assert.deepEqual(ctx.callsTo('moveTo')[0].args, [0, 0]);
});

test('renderElement arrow: 3 strokes (línea + cabeza)', () => {
  const ctx = render(baseEl({ type: 'arrow', x1: 0, y1: 0, x2: 100, y2: 50 }));
  assert.equal(ctx.callsTo('stroke').length, 3);
});

test('renderElement rect sin fill: 4 strokes, sin fillRect', () => {
  const ctx = render(baseEl({ type: 'rect', x: 10, y: 10, w: 100, h: 50, fill: false }));
  assert.equal(ctx.callsTo('stroke').length, 4);
  assert.equal(ctx.callsTo('fillRect').length, 0);
});

test('renderElement rect con fill: fillRect previo con color + alpha "20"', () => {
  const ctx = render(baseEl({ type: 'rect', x: 10, y: 10, w: 100, h: 50, fill: true }));
  assert.deepEqual(ctx.callsTo('fillRect')[0].args, [10, 10, 100, 50]);
  assert.deepEqual(ctx.callsTo('set fillStyle')[0].args, ['#1a1a2e20']);
  assert.equal(ctx.callsTo('stroke').length, 4);
});

test('renderElement roundedRect: 4 arcTo (esquinas) + stroke; con fill usa ctx.roundRect', () => {
  const noFill = render(baseEl({ type: 'roundedRect', x: 0, y: 0, w: 200, h: 100, fill: false }));
  assert.equal(noFill.callsTo('arcTo').length, 4);
  assert.equal(noFill.callsTo('stroke').length, 1);
  assert.equal(noFill.callsTo('roundRect').length, 0);

  const withFill = render(baseEl({ type: 'roundedRect', x: 0, y: 0, w: 200, h: 100, fill: true }));
  assert.deepEqual(withFill.callsTo('roundRect')[0].args, [0, 0, 200, 100, 12]);
  assert.equal(withFill.callsTo('fill').length, 1);
  assert.equal(withFill.callsTo('stroke').length, 1);
});

test('renderElement circle: 37 puntos alrededor del centro; con fill usa ctx.ellipse', () => {
  const el = baseEl({ type: 'circle', x: 50, y: 50, w: 100, h: 100, fill: false });
  const ctx = render(el);
  assert.equal(ctx.callsTo('lineTo').length, 36);
  assert.equal(ctx.callsTo('closePath').length, 1);
  assert.equal(ctx.callsTo('stroke').length, 1);
  // Centro (100,100), radio 50 (roughness por defecto 1.5)
  for (const c of ctx.callsTo('lineTo')) {
    const d = Math.hypot(c.args[0] - 100, c.args[1] - 100);
    assert.ok(Math.abs(d - 50) <= 1.5, `punto a distancia ${d}, esperado 50 ± 1.5`);
  }

  const filled = render(baseEl({ type: 'circle', x: 50, y: 50, w: 100, h: 100, fill: true }));
  assert.deepEqual(filled.callsTo('ellipse')[0].args, [100, 100, 50, 50, 0, 0, Math.PI * 2]);
  assert.equal(filled.callsTo('fill').length, 1);
});

test('renderElement text multilínea: un fillText por línea, interlineado fontSize+4', () => {
  const el = baseEl({ type: 'text', x: 10, y: 20, fontSize: 16, value: 'hola\nmundo\n!' });
  const ctx = render(el);
  const calls = ctx.callsTo('fillText').map(c => c.args);
  assert.deepEqual(calls, [
    ['hola', 10, 20],
    ['mundo', 10, 40],  // 20 + 1*(16+4)
    ['!', 10, 60],      // 20 + 2*(16+4)
  ]);
  assert.equal(ctx.callsTo('set font')[0].args[0].startsWith('16px '), true);
});

test('renderElement eraser: destination-out y lineWidth x4', () => {
  const pts = [{ x: 0, y: 0 }, { x: 10, y: 10 }];
  const ctx = render(baseEl({ type: 'eraser', points: pts, lineWidth: 3 }));
  assert.deepEqual(ctx.callsTo('set globalCompositeOperation')[0].args, ['destination-out']);
  // lineWidth: primero el del elemento (3), luego el del borrador (12)
  assert.deepEqual(ctx.callsTo('set lineWidth').map(c => c.args[0]), [3, 12]);
  assert.deepEqual(ctx.callsTo('set strokeStyle').map(c => c.args[0])[1], 'rgba(0,0,0,1)');
  assert.equal(ctx.callsTo('stroke').length, 1);

  // Con 1 solo punto no dibuja ni toca globalCompositeOperation
  const single = render(baseEl({ type: 'eraser', points: [{ x: 0, y: 0 }], lineWidth: 3 }));
  assert.equal(single.callsTo('stroke').length, 0);
  assert.equal(single.callsTo('set globalCompositeOperation').length, 0);
});

test('renderElement button: roundedRect + fill + etiqueta "Button" centrada', () => {
  const ctx = render(baseEl({ type: 'button', x: 10, y: 10, w: 120, h: 40 }));
  assert.equal(ctx.callsTo('arcTo').length, 4);
  assert.ok(ctx.callsTo('fill').length >= 1);
  assert.ok(ctx.callsTo('stroke').length >= 1);
  assert.deepEqual(ctx.callsTo('fillText')[0].args, ['Button', 70, 30]);
  assert.deepEqual(ctx.callsTo('set textAlign')[0].args, ['center']);
});

test('renderElement input: roundedRect + placeholder "Type here..."', () => {
  const ctx = render(baseEl({ type: 'input', x: 0, y: 0, w: 220, h: 36 }));
  assert.ok(ctx.callsTo('stroke').length >= 1);
  assert.deepEqual(ctx.callsTo('fillText')[0].args, ['Type here...', 10, 18]);
  // El borde del input se atenúa con alpha hex '80'
  assert.deepEqual(ctx.callsTo('set strokeStyle')[1].args, ['#1a1a2e80']);
});

test('renderElement imagePlaceholder: marco + cruz punteada + icono montaña', () => {
  const ctx = render(baseEl({ type: 'imagePlaceholder', x: 0, y: 0, w: 200, h: 150 }));
  // marco (4 strokes) + 2 diagonales + montaña = 7 strokes
  assert.equal(ctx.callsTo('stroke').length, 7);
  // ([...arr]: los arrays de guiones se crean en el realm del vm; se copian
  // al realm local para que deepEqual estricto no falle por el prototipo)
  const dashes = ctx.callsTo('setLineDash').map(c => [...c.args[0]]);
  assert.deepEqual(dashes, [[6, 4], []]);
  assert.equal(ctx.callsTo('closePath').length, 1); // montaña
});

test('renderElement nav: logo + links + hamburguesa', () => {
  const w = 600, h = 50;
  const ctx = render(baseEl({ type: 'nav', x: 0, y: 0, w, h }));
  const texts = ctx.callsTo('fillText').map(c => c.args[0]);
  assert.deepEqual(texts, ['Logo', 'Home', 'About', 'Contact']);
  // Hamburguesa: 3 líneas cortas al final
  assert.ok(ctx.callsTo('stroke').length >= 3);

  // BUG documentado (comportamiento actual): los links reservan 30px cada uno
  // (startX = x + w - 30*links.length - 40) pero se pintan con paso de 70px,
  // así que 'Contact' cae en x + w + 10 — FUERA del borde derecho del navbar
  // y pisando la zona de la hamburguesa (x + w - 30).
  const contact = ctx.callsTo('fillText').find(c => c.args[0] === 'Contact');
  assert.equal(contact.args[1], w + 10); // 0 + 600 - 130 + 2*70 = 610 > 600
});

test('renderElement card: imagen + título + líneas de descripción', () => {
  const ctx = render(baseEl({ type: 'card', x: 0, y: 0, w: 220, h: 280 }));
  // Área de imagen
  assert.equal(ctx.callsTo('fillRect').length, 1);
  const titles = ctx.callsTo('fillText').map(c => c.args[0]);
  assert.deepEqual(titles, ['Card Title']);
  // roundedRect (1) + separador (1) + 2 líneas descripción = 4 strokes
  assert.equal(ctx.callsTo('stroke').length, 4);
});

test('renderElement con tipo desconocido: solo save/restore, no lanza', () => {
  const ctx = render(baseEl({ type: 'nope' }));
  assert.equal(ctx.callsTo('stroke').length, 0);
  assert.equal(ctx.callsTo('fillText').length, 0);
});

/* ────────────────────────────────────────────────────────────
   Renderer.drawGrid / drawSelection
   ──────────────────────────────────────────────────────────── */

test('drawGrid: no lanza, save/restore y una pasada menor + mayor de líneas', () => {
  const ctx = createCtxStub();
  assert.doesNotThrow(() => Renderer.drawGrid(ctx, 100, 60));
  const names = ctx.methodNames();
  assert.equal(names[0], 'save');
  assert.equal(names[names.length - 1], 'restore');
  // step=20: menor → 5 verticales (x=0..80) + 3 horizontales (y=0..40);
  // step*5=100: mayor → 1 vertical (x=0) + 1 horizontal (y=0). Total 10.
  assert.equal(ctx.callsTo('stroke').length, 10);
  assert.equal(ctx.callsTo('beginPath').length, 10);
  // Dos estilos: rejilla menor y mayor
  assert.deepEqual(ctx.callsTo('set strokeStyle').map(c => c.args[0]), ['#e0e4ea', '#cdd3de']);
});

test('drawSelection: strokeRect punteado ampliado 4px alrededor de bounds', () => {
  const ctx = createCtxStub();
  assert.doesNotThrow(() => Renderer.drawSelection(ctx, { x: 10, y: 20, w: 100, h: 50 }));
  assert.deepEqual(ctx.callsTo('strokeRect')[0].args, [6, 16, 108, 58]);
  const dashes = ctx.callsTo('setLineDash').map(c => [...c.args[0]]);
  assert.deepEqual(dashes, [[5, 5], []]);
  assert.equal(ctx.methodNames()[0], 'save');
  assert.equal(ctx.methodNames().at(-1), 'restore');
});
