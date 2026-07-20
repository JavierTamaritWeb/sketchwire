'use strict';
/* ============================================================
   exporter.test.js — Tests de js/exporter.js sobre el
   COMPORTAMIENTO ACTUAL. Los blobs generados se capturan vía
   los stubs de Blob y URL.createObjectURL del helper
   (context.URL.blobs). No se modifica código de js/.
   ============================================================ */

const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers/load.js');

/** Contexto fresco con Exporter y sus dependencias (Renderer/Sketchy). */
function freshCtx() {
  return load('js/sketchy.js', 'js/renderer.js', 'js/exporter.js');
}

/** Último blob pasado a URL.createObjectURL en el contexto. */
function lastBlob(ctx) {
  const blobs = ctx.URL.blobs;
  assert.ok(blobs.length > 0, 'se esperaba al menos un blob capturado');
  return blobs[blobs.length - 1];
}

/* ── Elementos de ejemplo (mismas propiedades que crea app.js) ── */
const base = { color: '#333344', lineWidth: 2 };
const elLine = { ...base, type: 'line', x1: 10, y1: 20, x2: 110, y2: 220 };
const elArrow = { ...base, type: 'arrow', x1: 0, y1: 0, x2: 100, y2: 0 };
const elRectFill = { ...base, type: 'rect', x: 5, y: 6, w: 100, h: 50, fill: true };
const elRectNoFill = { ...base, type: 'rect', x: 300, y: 6, w: 100, h: 50, fill: false };
const elPencil = { ...base, type: 'pencil', points: [{ x: 1, y: 2 }, { x: 3, y: 4 }, { x: 5, y: 6 }] };
const elText = { ...base, type: 'text', value: 'Hola <b> & "mundo"', fontSize: 16, x: 40, y: 40 };
const elButton = { ...base, type: 'button', x: 10, y: 10, w: 120, h: 40 };
const elInput = { ...base, type: 'input', x: 10, y: 60, w: 200, h: 36 };
const elNav = { ...base, type: 'nav', x: 0, y: 0, w: 1200, h: 60 };
const elCard = { ...base, type: 'card', x: 400, y: 100, w: 260, h: 200 };

/* ============================================================
   SVG
   ============================================================ */

test('Exporter.svg: SVG bien formado (empieza <svg, termina </svg>) con tipo MIME correcto', () => {
  const ctx = freshCtx();
  ctx.Exporter.svg([elLine, elText]);
  const blob = lastBlob(ctx);
  assert.equal(blob.type, 'image/svg+xml');
  const out = blob.content;
  assert.ok(out.startsWith('<svg'), 'debe empezar por <svg');
  assert.ok(out.trimEnd().endsWith('</svg>'), 'debe terminar en </svg>');
  assert.ok(out.includes(`width="1200"`) && out.includes(`height="800"`));
});

test('Exporter.svg: line con x1/y1/x2/y2 correctos', () => {
  const ctx = freshCtx();
  ctx.Exporter.svg([elLine]);
  const out = lastBlob(ctx).content;
  assert.match(out, /<line x1="10" y1="20" x2="110" y2="220" /);
  assert.ok(out.includes(`stroke="#333344"`));
  assert.ok(out.includes(`stroke-width="2"`));
});

test('Exporter.svg: rect con fill cuando el elemento tiene fill:true', () => {
  const ctx = freshCtx();
  ctx.Exporter.svg([elRectFill, elRectNoFill]);
  const out = lastBlob(ctx).content;
  const rects = out.split('\n').filter(l => l.startsWith('<rect x='));
  assert.equal(rects.length, 2);
  const [withFill, noFill] = rects;
  assert.match(withFill, /x="5" y="6" width="100" height="50"/);
  assert.ok(withFill.includes(`fill="#33334420"`), 'rect fill:true debe llevar fill con alfa');
  assert.ok(!noFill.includes('#33334420'), 'rect fill:false no debe llevar fill de color');
  // BUG CONOCIDO (comportamiento actual documentado): la plantilla `s`
  // ya incluye fill="none" y para fill:true se añade un SEGUNDO atributo
  // fill al mismo <rect>. Un atributo duplicado hace el XML mal formado
  // (los parsers XML estrictos rechazan el archivo; los navegadores suelen
  // quedarse con el primero, es decir, "none": el relleno se pierde).
  assert.ok(
    withFill.includes('fill="none"') && withFill.includes('fill="#33334420"'),
    'comportamiento actual: atributo fill duplicado en rect con fill:true',
  );
});

test('Exporter.svg: text con el contenido escapado (<, &, " nunca crudos)', () => {
  const ctx = freshCtx();
  ctx.Exporter.svg([elText]);
  const out = lastBlob(ctx).content;
  const textLine = out.split('\n').find(l => l.startsWith('<text'));
  assert.ok(textLine, 'debe haber un <text>');
  assert.ok(textLine.includes('Hola &lt;b&gt; &amp; &quot;mundo&quot;'), 'valor escapado');
  assert.ok(!textLine.includes('<b>'), 'no debe aparecer <b> crudo');
  assert.ok(!textLine.includes('& "'), 'no debe aparecer & crudo');
  assert.match(textLine, /x="40" y="56"/); // y = el.y + fontSize
  assert.ok(textLine.includes(`font-size="16"`));
});

test('Exporter.svg: arrow genera 3 <line>', () => {
  const ctx = freshCtx();
  ctx.Exporter.svg([elArrow]);
  const out = lastBlob(ctx).content;
  const lines = out.match(/<line /g) || [];
  assert.equal(lines.length, 3, 'cuerpo + 2 trazos de punta');
  assert.ok(out.includes(`<line x1="0" y1="0" x2="100" y2="0"`), 'cuerpo de la flecha');
});

test('Exporter.svg: pencil genera <path> con M/L', () => {
  const ctx = freshCtx();
  ctx.Exporter.svg([elPencil]);
  const out = lastBlob(ctx).content;
  assert.ok(out.includes(`<path d="M1 2 L3 4 L5 6"`), 'path con M inicial y L sucesivos');
});

test('Exporter.svg: pencil con un solo punto no genera <path> (comportamiento actual)', () => {
  const ctx = freshCtx();
  ctx.Exporter.svg([{ ...base, type: 'pencil', points: [{ x: 1, y: 2 }] }]);
  const out = lastBlob(ctx).content;
  assert.ok(!out.includes('<path'), 'un punto solo se omite');
});

/* ============================================================
   JSON
   ============================================================ */

test('Exporter.json: JSON parseable con version, canvasSize y elements intactos (round-trip)', () => {
  const ctx = freshCtx();
  const elements = [elLine, elRectFill, elText, elPencil];
  ctx.Exporter.json(elements);
  const blob = lastBlob(ctx);
  assert.equal(blob.type, 'application/json');
  const data = JSON.parse(blob.content);
  assert.equal(data.version, 1);
  assert.deepEqual(data.canvasSize, { w: 1200, h: 800 });
  assert.deepEqual(data.elements, elements, 'round-trip sin pérdida');
});

test('Exporter.json + importJSON: round-trip completo devuelve los mismos elementos', async () => {
  const ctx = freshCtx();
  const elements = [elLine, elText];
  ctx.Exporter.json(elements);
  const jsonStr = lastBlob(ctx).content;

  const p = ctx.Exporter.importJSON();
  const input = ctx.document.created[ctx.document.created.length - 1];
  assert.equal(input.tagName, 'INPUT');
  assert.equal(input.type, 'file');
  assert.equal(input.accept, '.json');
  assert.ok(input.clicked, 'importJSON hace click en el input');
  input.onchange({ target: { files: [{ text: jsonStr }] } });
  // Los objetos se parsean dentro del contexto vm (otro Object.prototype):
  // se normalizan via JSON para comparar estructura, no identidad de realm.
  assert.deepEqual(JSON.parse(JSON.stringify(await p)), elements);
});

test('Exporter.importJSON: JSON inválido alerta y resuelve null', async () => {
  const ctx = freshCtx();
  const p = ctx.Exporter.importJSON();
  const input = ctx.document.created[ctx.document.created.length - 1];
  input.onchange({ target: { files: [{ text: 'esto no es json{' }] } });
  assert.equal(await p, null);
  assert.deepEqual(ctx.alerts, ['Archivo JSON inválido']);
});

/* ============================================================
   HTML
   ============================================================ */

test('Exporter.html: contiene button/input/nav/card según los elementos', () => {
  const ctx = freshCtx();
  ctx.Exporter.html([elButton, elInput, elNav, elCard]);
  const blob = lastBlob(ctx);
  assert.equal(blob.type, 'text/html');
  const out = blob.content;
  assert.ok(out.startsWith('<!DOCTYPE html>'));
  assert.match(out, /<button style="left:10px;top:10px;width:120px;height:40px;/);
  assert.match(out, /<input placeholder="Type here\.\.\." style="left:10px;top:60px;/);
  assert.match(out, /<nav style="left:0px;top:0px;width:1200px;height:60px;/);
  assert.ok(out.includes('Card Title'), 'card renderiza su título');
  assert.match(out, /<div style="left:400px;top:100px;width:260px;height:200px;[^"]*border-radius:10px/);
});

test('Exporter.html: escapa el texto del usuario en <p> (&, <, >)', () => {
  const ctx = freshCtx();
  ctx.Exporter.html([{ ...base, type: 'text', value: 'a < b & <script>x</script>', fontSize: 14, x: 1, y: 2 }]);
  const out = lastBlob(ctx).content;
  assert.ok(out.includes('a &lt; b &amp; &lt;script&gt;x&lt;/script&gt;'));
  assert.ok(!out.includes('<script>'), 'no debe colarse <script> crudo');
});

test('Exporter.html: _escapeHtml NO escapa comillas dobles (comportamiento actual)', () => {
  // BUG CONOCIDO (documentado, no corregido): _escapeHtml solo reemplaza
  // & < >. Las comillas del usuario llegan crudas al HTML. Hoy el value
  // solo se interpola como contenido de <p> (no en atributos), así que no
  // rompe, pero si algún día se interpola en un atributo sería inyección.
  const ctx = freshCtx();
  ctx.Exporter.html([{ ...base, type: 'text', value: 'con "comillas"', fontSize: 14, x: 1, y: 2 }]);
  const out = lastBlob(ctx).content;
  assert.ok(out.includes('con "comillas"'), 'las comillas aparecen sin escapar');
  assert.ok(!out.includes('&quot;'));
});

test('Exporter.html: propiedades del elemento se interpolan SIN escapar en atributos style (comportamiento actual)', () => {
  // BUG CONOCIDO (documentado, no corregido): color/lineWidth/x/y/w/h se
  // interpolan crudos dentro de style="...". Con los colores de la paleta
  // (COLORS) es inofensivo, pero importJSON no valida el JSON importado:
  // un archivo manipulado con color = '"><script>...' rompe el atributo y
  // acaba como HTML activo en el archivo exportado (inyección de HTML).
  const ctx = freshCtx();
  const evil = { ...base, color: '"><script>alert(1)</script>', type: 'rect', x: 0, y: 0, w: 10, h: 10, fill: false };
  ctx.Exporter.html([evil]);
  const out = lastBlob(ctx).content;
  assert.ok(out.includes('"><script>alert(1)</script>'), 'el color llega crudo al atributo style');
});

/* ============================================================
   PNG / JPG
   ============================================================ */

test('Exporter.png: no lanza con el canvas stub y descarga wireframe.png', () => {
  const ctx = freshCtx();
  assert.doesNotThrow(() => ctx.Exporter.png([elLine, elRectFill, elText, elPencil, elButton, elInput, elNav, elCard, elArrow]));
  const canvas = ctx.document.created.find(e => e.tagName === 'CANVAS');
  assert.ok(canvas, 'crea un canvas temporal');
  assert.equal(canvas.width, 1200);
  assert.equal(canvas.height, 800);
  // Fondo blanco pintado antes de renderizar
  assert.deepEqual(canvas._ctx.callsTo('fillRect')[0].args, [0, 0, 1200, 800]);
  const a = ctx.document.created.find(e => e.tagName === 'A');
  assert.ok(a, 'crea el anchor de descarga');
  assert.equal(a.download, 'wireframe.png');
  assert.equal(a.href, 'data:fake');
  assert.ok(a.clicked);
});

test('Exporter.jpg: no lanza con el canvas stub y descarga wireframe.jpg', () => {
  const ctx = freshCtx();
  assert.doesNotThrow(() => ctx.Exporter.jpg([elLine, elText]));
  const a = ctx.document.created.find(e => e.tagName === 'A');
  assert.equal(a.download, 'wireframe.jpg');
  assert.ok(a.clicked);
});
