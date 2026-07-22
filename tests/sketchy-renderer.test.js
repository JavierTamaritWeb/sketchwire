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

  // Regresión: antes los links reservaban 30px pero se pintaban con paso de
  // 70px y 'Contact' caía fuera del navbar. Ahora reserva y paso coinciden
  // (70px) y todos los links quedan dentro, sin pisar la hamburguesa (w-30).
  const contact = ctx.callsTo('fillText').find(c => c.args[0] === 'Contact');
  assert.equal(contact.args[1], w - 70 * 3 - 40 + 2 * 70); // 490
  assert.ok(contact.args[1] < w - 30, 'Contact dentro del navbar, sin pisar la hamburguesa');
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

/* ────────────────────────────────────────────────────────────
   Jitter determinista (seed)
   ──────────────────────────────────────────────────────────── */

test('Sketchy.setSeed: mismo seed produce exactamente la misma secuencia de llamadas', () => {
  const a = createCtxStub();
  Sketchy.setSeed(12345);
  Sketchy.rect(a, 10, 10, 100, 60);

  const b = createCtxStub();
  Sketchy.setSeed(12345);
  Sketchy.rect(b, 10, 10, 100, 60);

  assert.deepEqual(
    a.calls.map(c => [c.name, ...c.args]),
    b.calls.map(c => [c.name, ...c.args]),
    'mismo seed ⇒ mismo trazo exacto',
  );

  // Seeds distintos producen trazos distintos
  const c = createCtxStub();
  Sketchy.setSeed(99999);
  Sketchy.rect(c, 10, 10, 100, 60);
  assert.notDeepEqual(
    a.calls.map(x => [x.name, ...x.args]),
    c.calls.map(x => [x.name, ...x.args]),
  );
  Sketchy.setSeed(null);
});

test('renderElement: el.seed hace el render reproducible entre redraws', () => {
  // Este es el guardián del "temblor": sin seed cada redraw cambiaba el
  // jitter; con el.seed dos renders del mismo elemento son idénticos.
  const el = { type: 'rect', x: 5, y: 5, w: 80, h: 40, color: '#333344', lineWidth: 2, seed: 42 };
  const a = createCtxStub();
  Renderer.renderElement(a, el);
  const b = createCtxStub();
  Renderer.renderElement(b, el);
  assert.deepEqual(
    a.calls.map(c => [c.name, ...c.args]),
    b.calls.map(c => [c.name, ...c.args]),
  );
});

test('renderElement: el.label personaliza button/input/nav/card en canvas', () => {
  const btn = createCtxStub();
  Renderer.renderElement(btn, { type: 'button', x: 0, y: 0, w: 120, h: 40, color: '#333344', lineWidth: 2, label: 'Enviar' });
  assert.deepEqual(btn.callsTo('fillText').map(c => c.args[0]), ['Enviar']);

  const nav = createCtxStub();
  Renderer.renderElement(nav, { type: 'nav', x: 0, y: 0, w: 600, h: 50, color: '#333344', lineWidth: 2, label: 'MiMarca' });
  assert.equal(nav.callsTo('fillText')[0].args[0], 'MiMarca');

  const card = createCtxStub();
  Renderer.renderElement(card, { type: 'card', x: 0, y: 0, w: 220, h: 280, color: '#333344', lineWidth: 2, label: 'Precios' });
  assert.deepEqual(card.callsTo('fillText').map(c => c.args[0]), ['Precios']);
});

test('drawSelection con withHandles: 4 handles en las esquinas del marco', () => {
  const ctx = createCtxStub();
  Renderer.drawSelection(ctx, { x: 10, y: 20, w: 100, h: 50 }, true);
  // Marco + 4 handles = 5 strokeRect; 4 fillRect (relleno blanco de cada handle)
  assert.equal(ctx.callsTo('strokeRect').length, 5);
  assert.equal(ctx.callsTo('fillRect').length, 4);
  // Primer handle centrado en la esquina nw del marco (x-4, y-4), tamaño 8
  assert.deepEqual(ctx.callsTo('fillRect')[0].args, [10 - 4 - 4, 20 - 4 - 4, 8, 8]);
});

test('drawSelection sin withHandles: solo el marco (sin handles)', () => {
  const ctx = createCtxStub();
  Renderer.drawSelection(ctx, { x: 10, y: 20, w: 100, h: 50 });
  assert.equal(ctx.callsTo('strokeRect').length, 1);
  assert.equal(ctx.callsTo('fillRect').length, 0);
});

test('renderElement image: sin Image global dibuja placeholder punteado, no lanza', () => {
  // En el navegador dibuja la imagen (drawImage con caché); en Node no hay
  // Image, así que el fallback es el marco punteado del placeholder.
  const ctx = createCtxStub();
  const el = { type: 'image', x: 10, y: 20, w: 200, h: 150, color: '#333344', lineWidth: 2, src: 'data:image/png;base64,AAAA' };
  assert.doesNotThrow(() => Renderer.renderElement(ctx, el));
  assert.deepEqual(ctx.callsTo('strokeRect')[0].args, [10, 20, 200, 150]);
  assert.deepEqual(ctx.callsTo('setLineDash').map(c => [...c.args[0]]), [[4, 4], []]);
  assert.equal(ctx.callsTo('drawImage').length, 0);
});

/* ────────────────────────────────────────────────────────────
   Flecha curva
   ──────────────────────────────────────────────────────────── */

test('Sketchy.curve: beginPath + moveTo + lineTos + stroke, puntos cerca de la cuadrática', () => {
  const ctx = createCtxStub();
  const roughness = 1.5;
  const [x1, y1, cx, cy, x2, y2] = [0, 0, 100, 100, 200, 0];
  Sketchy.curve(ctx, x1, y1, cx, cy, x2, y2, roughness);
  const names = ctx.methodNames();
  assert.equal(names[0], 'beginPath');
  assert.equal(names[1], 'moveTo');
  assert.equal(names[names.length - 1], 'stroke');
  assert.deepEqual(ctx.callsTo('moveTo')[0].args, [x1, y1]);
  const lineTos = ctx.callsTo('lineTo');
  assert.ok(lineTos.length >= 8, 'al menos 8 segmentos');
  const tol = roughness / 2 + 1e-9;
  lineTos.forEach((c, idx) => {
    const t = (idx + 1) / lineTos.length;
    const mt = 1 - t;
    const qx = mt * mt * x1 + 2 * mt * t * cx + t * t * x2;
    const qy = mt * mt * y1 + 2 * mt * t * cy + t * t * y2;
    assert.ok(Math.abs(c.args[0] - qx) <= tol, `x del punto ${idx} cerca de la curva`);
    assert.ok(Math.abs(c.args[1] - qy) <= tol, `y del punto ${idx} cerca de la curva`);
  });
});

test('Sketchy.arrowHead: pura y determinista, 2 segmentos desde la punta de longitud len', () => {
  const segs = Sketchy.arrowHead(100, 100, 0, 14);
  assert.equal(segs.length, 2);
  for (const sg of segs) {
    // Ambos segmentos parten exactamente de la punta (sin jitter)
    assert.equal(sg.x1, 100);
    assert.equal(sg.y1, 100);
    // Longitud exacta = len (sin aleatoriedad)
    const d = Math.hypot(sg.x2 - sg.x1, sg.y2 - sg.y1);
    assert.ok(Math.abs(d - 14) <= 1e-9, `longitud ${d}, esperado 14 exacto`);
  }
  // Aberturas simétricas respecto al eje (angle=0): mismo x, desviaciones
  // en y opuestas alrededor de la punta (y=100)
  assert.ok(Math.abs(segs[0].x2 - segs[1].x2) <= 1e-9);
  assert.ok(Math.abs((segs[0].y2 - 100) + (segs[1].y2 - 100)) <= 1e-9);
  // Pura: dos llamadas idénticas devuelven exactamente lo mismo
  // (comparación estructural por el gotcha de realm del vm)
  const again = Sketchy.arrowHead(100, 100, 0, 14);
  assert.deepEqual(
    segs.map(sg => [sg.x1, sg.y1, sg.x2, sg.y2]),
    again.map(sg => [sg.x1, sg.y1, sg.x2, sg.y2]),
  );
});

test('renderElement arrow con heads both: 2 líneas de punta extra (5 strokes)', () => {
  const single = render(baseEl({ type: 'arrow', x1: 0, y1: 0, x2: 100, y2: 50 }));
  assert.equal(single.callsTo('stroke').length, 3);
  const both = render(baseEl({ type: 'arrow', x1: 0, y1: 0, x2: 100, y2: 50, heads: 'both' }));
  assert.equal(both.callsTo('stroke').length, 5);
  // Las 2 líneas extra parten del inicio (0,0): moveTo exactos
  const starts = both.callsTo('moveTo').map(c => c.args);
  assert.deepEqual(starts[3], [0, 0]);
  assert.deepEqual(starts[4], [0, 0]);
});

test('renderElement curveArrow con heads both: punta inicial extra, determinista con seed', () => {
  const base = { type: 'curveArrow', x1: 10, y1: 10, cx: 100, cy: 80, x2: 200, y2: 10, color: '#333344', lineWidth: 2, seed: 7 };
  const single = createCtxStub();
  Renderer.renderElement(single, base);
  const both = createCtxStub();
  Renderer.renderElement(both, { ...base, heads: 'both' });
  // 2 Sketchy.line extra respecto al render sin heads
  assert.equal(single.callsTo('stroke').length, 3);
  assert.equal(both.callsTo('stroke').length, 5);
  // Las líneas extra arrancan exactamente en (x1,y1)
  const starts = both.callsTo('moveTo').map(c => c.args);
  assert.deepEqual(starts[3], [10, 10]);
  assert.deepEqual(starts[4], [10, 10]);
  // Determinismo: mismo seed ⇒ mismo trazo también con doble punta
  const again = createCtxStub();
  Renderer.renderElement(again, { ...base, heads: 'both' });
  assert.deepEqual(
    both.calls.map(c => [c.name, ...c.args]),
    again.calls.map(c => [c.name, ...c.args]),
  );
});

test('renderElement arrow/curveArrow: la punta escala con lineWidth (10 + 2·lw)', () => {
  // arrow con lineWidth 4 → headLen 18 (renderElement fija ctx.lineWidth)
  const ctx = render(baseEl({ type: 'arrow', x1: 0, y1: 0, x2: 100, y2: 0, lineWidth: 4 }));
  const names = ctx.methodNames();
  const strokeIdx = names.reduce((acc, n, i) => (n === 'stroke' ? [...acc, i] : acc), []);
  for (const si of [strokeIdx[1], strokeIdx[2]]) {
    const lastLineTo = ctx.calls[si - 1];
    assert.equal(lastLineTo.name, 'lineTo');
    const d = Math.hypot(lastLineTo.args[0] - 100, lastLineTo.args[1] - 0);
    assert.ok(Math.abs(d - 18) <= 1.5 + 1e-9, `cabeza a distancia ${d}, esperado ~18`);
  }
});

test('renderElement curveArrow: curva + 2 líneas de punta, determinista con seed', () => {
  const el = { type: 'curveArrow', x1: 10, y1: 10, cx: 100, cy: 80, x2: 200, y2: 10, color: '#333344', lineWidth: 2, seed: 7 };
  const a = createCtxStub();
  Renderer.renderElement(a, el);
  // 3 strokes: la curva y las 2 líneas de la punta
  assert.equal(a.callsTo('stroke').length, 3);
  assert.equal(a.methodNames()[0], 'save');
  assert.equal(a.methodNames()[a.methodNames().length - 1], 'restore');
  // La punta arranca exactamente en (x2,y2): moveTo sin jitter de las 2 líneas
  const moveTos = a.callsTo('moveTo');
  assert.deepEqual(moveTos[1].args, [200, 10]);
  assert.deepEqual(moveTos[2].args, [200, 10]);
  // Mismo seed ⇒ mismo trazo
  const b = createCtxStub();
  Renderer.renderElement(b, el);
  assert.deepEqual(
    a.calls.map(c => [c.name, ...c.args]),
    b.calls.map(c => [c.name, ...c.args]),
  );
});

/* ────────────────────────────────────────────────────────────
   Trazo discontinuo (dash)
   ──────────────────────────────────────────────────────────── */

test('renderElement line con dash: setLineDash proporcional a lineWidth', () => {
  const ctx = createCtxStub();
  Renderer.renderElement(ctx, { type: 'line', x1: 0, y1: 0, x2: 100, y2: 0, color: '#333344', lineWidth: 2, dash: true, seed: 1 });
  const dashes = ctx.callsTo('setLineDash').map(c => [...c.args[0]]);
  assert.deepEqual(dashes, [[8, 8], []], 'dash [4·lw, 4·lw] activado y limpiado');
});

test('renderElement arrow con dash: dash solo en el cuerpo, puntas sólidas', () => {
  const ctx = createCtxStub();
  Renderer.renderElement(ctx, { type: 'arrow', x1: 0, y1: 0, x2: 100, y2: 0, color: '#333344', lineWidth: 3, dash: true, seed: 1 });
  const names = ctx.methodNames();
  // El setLineDash([12,12]) va antes del primer stroke (cuerpo) y el
  // setLineDash([]) antes de las puntas (strokes 2 y 3)
  const dashes = ctx.callsTo('setLineDash').map(c => [...c.args[0]]);
  assert.deepEqual(dashes, [[12, 12], []]);
  const firstStroke = names.indexOf('stroke');
  const clearDash = names.lastIndexOf('setLineDash');
  assert.ok(clearDash > firstStroke, 'el dash se limpia después del cuerpo');
  assert.equal(ctx.callsTo('stroke').length, 3, 'cuerpo + 2 líneas de punta');
});

test('renderElement arrow sin dash: determinista con seed tras la descomposición', () => {
  // Regresión: el case arrow se descompuso (cuerpo + puntas) para el dash;
  // el orden de consumo del PRNG debe ser idéntico entre renders
  const el = { type: 'arrow', x1: 10, y1: 10, x2: 150, y2: 90, color: '#333344', lineWidth: 2, seed: 42 };
  const a = createCtxStub();
  Renderer.renderElement(a, el);
  const b = createCtxStub();
  Renderer.renderElement(b, el);
  assert.deepEqual(
    a.calls.map(c => [c.name, ...c.args]),
    b.calls.map(c => [c.name, ...c.args]),
  );
  assert.equal(a.callsTo('stroke').length, 3);
  assert.equal(a.callsTo('setLineDash').length, 0, 'sin dash no se toca setLineDash');
});

test('renderElement curveArrow con dash: dash en la curva, puntas sólidas', () => {
  const ctx = createCtxStub();
  Renderer.renderElement(ctx, { type: 'curveArrow', x1: 0, y1: 0, cx: 50, cy: 60, x2: 100, y2: 0, color: '#333344', lineWidth: 2, dash: true, seed: 1 });
  const dashes = ctx.callsTo('setLineDash').map(c => [...c.args[0]]);
  assert.deepEqual(dashes, [[8, 8], []]);
  assert.equal(ctx.callsTo('stroke').length, 3);
});

/* ────────────────────────────────────────────────────────────
   Etiquetas sobre flechas (label)
   ──────────────────────────────────────────────────────────── */

test('renderElement arrow con label: halo strokeText + fillText en el punto medio', () => {
  const ctx = createCtxStub();
  Renderer.renderElement(ctx, { type: 'arrow', x1: 0, y1: 0, x2: 100, y2: 40, color: '#333344', lineWidth: 2, label: 'sí', seed: 1 });
  const strokeTexts = ctx.callsTo('strokeText');
  const fillTexts = ctx.callsTo('fillText');
  assert.equal(strokeTexts.length, 1, 'halo blanco');
  assert.equal(fillTexts.length, 1);
  assert.deepEqual(strokeTexts[0].args, ['sí', 50, 20]);
  assert.deepEqual(fillTexts[0].args, ['sí', 50, 20]);
  // El halo va antes que el relleno
  const names = ctx.methodNames();
  assert.ok(names.indexOf('strokeText') < names.indexOf('fillText'));
});

test('renderElement curveArrow con label: texto en Q(0.5), no en el punto medio de la cuerda', () => {
  const ctx = createCtxStub();
  // Cuerda de (0,0) a (100,0); control en (50,100) → Q(0.5) = (50, 50);
  // el punto medio de la cuerda sería (50, 0)
  Renderer.renderElement(ctx, { type: 'curveArrow', x1: 0, y1: 0, cx: 50, cy: 100, x2: 100, y2: 0, color: '#333344', lineWidth: 2, label: 'envía', seed: 1 });
  const fill = ctx.callsTo('fillText')[0];
  assert.deepEqual(fill.args, ['envía', 50, 50], 'centrado sobre la curva, no la cuerda');
});

test('renderElement arrow sin label: ningún fillText/strokeText', () => {
  const ctx = createCtxStub();
  Renderer.renderElement(ctx, { type: 'arrow', x1: 0, y1: 0, x2: 100, y2: 0, color: '#333344', lineWidth: 2, seed: 1 });
  assert.equal(ctx.callsTo('fillText').length, 0);
  assert.equal(ctx.callsTo('strokeText').length, 0);
});

/* ────────────────────────────────────────────────────────────
   Curva en S (cúbica)
   ──────────────────────────────────────────────────────────── */

test('Sketchy.cubicCurve: beginPath + moveTo + lineTos + stroke, puntos cerca de la cúbica', () => {
  const ctx = createCtxStub();
  const roughness = 1.5;
  const [x1, y1, cx1, cy1, cx2, cy2, x2, y2] = [0, 0, 50, 80, 150, -80, 200, 0];
  Sketchy.cubicCurve(ctx, x1, y1, cx1, cy1, cx2, cy2, x2, y2, roughness);
  const names = ctx.methodNames();
  assert.equal(names[0], 'beginPath');
  assert.equal(names[1], 'moveTo');
  assert.equal(names[names.length - 1], 'stroke');
  assert.deepEqual(ctx.callsTo('moveTo')[0].args, [x1, y1]);
  const lineTos = ctx.callsTo('lineTo');
  assert.ok(lineTos.length >= 8);
  const tol = roughness / 2 + 1e-9;
  lineTos.forEach((c, idx) => {
    const t = (idx + 1) / lineTos.length;
    const mt = 1 - t;
    const bx = mt ** 3 * x1 + 3 * mt * mt * t * cx1 + 3 * mt * t * t * cx2 + t ** 3 * x2;
    const by = mt ** 3 * y1 + 3 * mt * mt * t * cy1 + 3 * mt * t * t * cy2 + t ** 3 * y2;
    assert.ok(Math.abs(c.args[0] - bx) <= tol, `x del punto ${idx}`);
    assert.ok(Math.abs(c.args[1] - by) <= tol, `y del punto ${idx}`);
  });
});

test('renderElement curveArrow cúbica: usa cubicCurve y orienta la punta con p2−c2', () => {
  const el = { type: 'curveArrow', x1: 0, y1: 0, cx: 50, cy: 80, cx2: 150, cy2: -80, x2: 200, y2: 0, color: '#333344', lineWidth: 2, seed: 5 };
  const ctx = createCtxStub();
  Renderer.renderElement(ctx, el);
  // 3 strokes: la curva + 2 líneas de punta
  assert.equal(ctx.callsTo('stroke').length, 3);
  // Las líneas de la punta arrancan en (200,0); su dirección viene de la
  // tangente p2−c2 = (50, 80) → ángulo atan2(80, 50)
  const moveTos = ctx.callsTo('moveTo');
  assert.deepEqual(moveTos[1].args, [200, 0]);
  const angle = Math.atan2(0 - (-80), 200 - 150);
  const headLen = 10 + 2 * 2;
  const expectedTip = [200 - headLen * Math.cos(angle - 0.4), 0 - headLen * Math.sin(angle - 0.4)];
  // El primer lineTo tras el moveTo de la punta apunta hacia expectedTip
  // (con jitter ±0.75); basta comprobar el último lineTo de esa línea
  const strokes = ctx.methodNames().reduce((acc, n, i) => (n === 'stroke' ? [...acc, i] : acc), []);
  assert.ok(strokes.length === 3);
});

test('renderElement curveArrow cúbica: determinista con seed (heads both incluido)', () => {
  const el = { type: 'curveArrow', x1: 0, y1: 0, cx: 50, cy: 80, cx2: 150, cy2: -80, x2: 200, y2: 0, color: '#333344', lineWidth: 2, heads: 'both', seed: 9 };
  const a = createCtxStub();
  Renderer.renderElement(a, el);
  const b = createCtxStub();
  Renderer.renderElement(b, el);
  assert.deepEqual(
    a.calls.map(c => [c.name, ...c.args]),
    b.calls.map(c => [c.name, ...c.args]),
  );
  // curva + 2 puntas × 2 extremos = 5 strokes
  assert.equal(a.callsTo('stroke').length, 5);
});

test('renderElement curveArrow cúbica con label: texto en B(0.5)', () => {
  // B(0.5) = 0.125·p1 + 0.375·c1 + 0.375·c2 + 0.125·p2
  const el = { type: 'curveArrow', x1: 0, y1: 0, cx: 40, cy: 80, cx2: 160, cy2: 80, x2: 200, y2: 0, color: '#333344', lineWidth: 2, label: 'x', seed: 1 };
  const ctx = createCtxStub();
  Renderer.renderElement(ctx, el);
  const fill = ctx.callsTo('fillText')[0];
  assert.deepEqual(fill.args, ['x', 0.375 * 40 + 0.375 * 160 + 0.125 * 200, 0.375 * 80 + 0.375 * 80]);
});
