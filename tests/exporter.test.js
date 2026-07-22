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
  // Regresión: antes el tag llevaba fill="none" (de la plantilla `s`) MÁS un
  // segundo fill="...20" — atributo duplicado = XML mal formado y relleno
  // perdido en navegadores. Ahora debe haber exactamente un fill por tag.
  assert.ok(!withFill.includes('fill="none"'), 'rect fill:true no debe llevar fill="none" duplicado');
  assert.equal((withFill.match(/fill="/g) || []).length, 1, 'un único atributo fill');
  assert.ok(noFill.includes('fill="none"'));
  assert.equal((noFill.match(/fill="/g) || []).length, 1, 'un único atributo fill');
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

test('Exporter.html: _escapeHtml escapa comillas dobles y simples', () => {
  // Regresión: antes _escapeHtml solo reemplazaba & < > y las comillas
  // llegaban crudas al HTML (inyección si algún día iban a un atributo).
  const ctx = freshCtx();
  ctx.Exporter.html([{ ...base, type: 'text', value: 'con "comillas" y \'simples\'', fontSize: 14, x: 1, y: 2 }]);
  const out = lastBlob(ctx).content;
  assert.ok(out.includes('con &quot;comillas&quot; y &#39;simples&#39;'), 'comillas escapadas');
  assert.ok(!out.includes('con "comillas"'), 'no deben aparecer comillas crudas del usuario');
});

test('Exporter.html: color y lineWidth se escapan en los atributos style', () => {
  // Regresión: antes color/lineWidth se interpolaban crudos dentro de
  // style="..." y un JSON manipulado inyectaba HTML activo en el export.
  // (La validación de importJSON es la primera defensa; esto es defensa
  // en profundidad.)
  const ctx = freshCtx();
  const evil = { ...base, color: '"><script>alert(1)</script>', type: 'rect', x: 0, y: 0, w: 10, h: 10, fill: false };
  ctx.Exporter.html([evil]);
  const out = lastBlob(ctx).content;
  assert.ok(!out.includes('"><script>alert(1)</script>'), 'el color no debe llegar crudo al atributo style');
  assert.ok(out.includes('&quot;&gt;&lt;script&gt;'), 'el color aparece escapado');
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

/* ============================================================
   Validación de import (isValidElement)
   ============================================================ */

test('Exporter.isValidElement: acepta los elementos que produce la app', () => {
  const ctx = freshCtx();
  const eraser = { ...base, type: 'eraser', points: [{ x: 1, y: 2 }, { x: 3, y: 4 }] };
  for (const el of [elLine, elArrow, elRectFill, elRectNoFill, elPencil, elText, elButton, elInput, elNav, elCard, eraser]) {
    assert.ok(ctx.Exporter.isValidElement(el), `debe aceptar type=${el.type}`);
  }
  // Color hex de 8 dígitos (#rrggbbaa), usado por el template landing
  assert.ok(ctx.Exporter.isValidElement({ ...elText, color: '#1a1a2e80' }));
});

test('Exporter.isValidElement: rechaza elementos malformados', () => {
  const ctx = freshCtx();
  const bad = [
    null,
    'texto',
    { ...base, type: 'inventado', x: 0, y: 0, w: 10, h: 10 },
    { ...base, type: 'select', x: 0, y: 0, w: 10, h: 10 },          // select no es un elemento
    { ...base, type: 'pencil' },                                     // sin points
    { ...base, type: 'pencil', points: [{ x: '1', y: 2 }] },         // coordenada string
    { ...base, type: 'line', x1: 0, y1: 0, x2: 'a', y2: 0 },
    { ...base, type: 'rect', x: 0, y: 0, w: 10 },                    // falta h
    { ...base, type: 'text', x: 0, y: 0, fontSize: 14 },             // falta value
    { ...elRectFill, color: 'red' },                                 // color no-hex
    { ...elRectFill, color: '"><script>' },                          // color malicioso
    { ...elRectFill, lineWidth: '2' },                               // lineWidth string
    { ...elRectFill, x: NaN },
  ];
  for (const el of bad) {
    assert.equal(ctx.Exporter.isValidElement(el), false, `debe rechazar ${JSON.stringify(el)}`);
  }
});

/* ============================================================
   Eraser en exports
   ============================================================ */

test('Exporter.svg: eraser se aproxima con trazo blanco de lineWidth*4', () => {
  // Regresión: antes el eraser no tenía case en SVG y lo borrado reaparecía.
  const ctx = freshCtx();
  const eraser = { ...base, type: 'eraser', points: [{ x: 10, y: 10 }, { x: 50, y: 50 }] };
  ctx.Exporter.svg([elPencil, eraser]);
  const out = lastBlob(ctx).content;
  const eraserPath = out.split('\n').find(l => l.includes('stroke="#ffffff"'));
  assert.ok(eraserPath, 'debe emitir un path blanco para el eraser');
  assert.ok(eraserPath.includes('stroke-width="8"'), 'ancho = lineWidth * 4');
  assert.match(eraserPath, /d="M10 10 L50 50"/);
});

test('Exporter.png: repinta fondo blanco con destination-over tras renderizar (eraser)', () => {
  // Regresión: el eraser (destination-out) perforaba el fondo y el PNG salía
  // transparente / el JPG negro.
  const ctx = freshCtx();
  const eraser = { ...base, type: 'eraser', points: [{ x: 10, y: 10 }, { x: 50, y: 50 }] };
  ctx.Exporter.png([elPencil, eraser]);
  const canvas = ctx.document.created.find(e => e.tagName === 'CANVAS');
  const fills = canvas._ctx.callsTo('fillRect');
  assert.deepEqual(fills[fills.length - 1].args, [0, 0, 1200, 800], 'último fillRect cubre todo el canvas');
  const gcoSets = canvas._ctx.callsTo('set globalCompositeOperation').map(c => c.args[0]);
  assert.ok(gcoSets.includes('destination-over'), 'usa destination-over para el fondo');
  assert.equal(gcoSets[gcoSets.length - 1], 'source-over', 'restaura source-over al final');
});

/* ============================================================
   Multilínea, etiquetas y SVG incrustado en HTML
   ============================================================ */

test('Exporter.svg: texto multilínea genera un <tspan> por línea', () => {
  const ctx = freshCtx();
  ctx.Exporter.svg([{ ...base, type: 'text', value: 'línea 1\nlínea 2\nlínea 3', fontSize: 16, x: 40, y: 40 }]);
  const out = lastBlob(ctx).content;
  const tspans = out.match(/<tspan/g) || [];
  assert.equal(tspans.length, 3, 'un tspan por línea');
  assert.ok(out.includes('dy="20"'), 'interlineado fontSize + 4');
  assert.ok(out.includes('línea 3'));
});

test('Exporter.html: los tipos vectoriales van en un <svg> incrustado', () => {
  // Regresión: antes pencil/line/arrow/circle/eraser se omitían en silencio.
  const ctx = freshCtx();
  const elCircle = { ...base, type: 'circle', x: 10, y: 10, w: 60, h: 60, fill: false };
  ctx.Exporter.html([elPencil, elLine, elArrow, elCircle, elButton]);
  const out = lastBlob(ctx).content;
  assert.ok(out.includes('<svg width="1200" height="800"'), 'incrusta un svg del tamaño del canvas');
  assert.ok(out.includes('<path d="M1 2 L3 4 L5 6"'), 'pencil presente');
  assert.ok(out.includes('x1="10" y1="20"'), 'line presente');
  assert.ok(out.includes('<ellipse'), 'circle presente');
  assert.ok((out.match(/<line /g) || []).length >= 4, 'line + 3 líneas de la flecha');
  assert.ok(out.includes('<button'), 'los componentes siguen como HTML nativo');
});

test('Exporter.html sin tipos vectoriales: no incrusta <svg>', () => {
  const ctx = freshCtx();
  ctx.Exporter.html([elButton, elCard]);
  const out = lastBlob(ctx).content;
  assert.ok(!out.includes('<svg'), 'sin vectores no debe haber svg incrustado');
});

test('exports: el.label personaliza button/input/nav/card en SVG y HTML (escapado)', () => {
  const ctx = freshCtx();
  const btn = { ...elButton, label: 'Enviar <ya>' };
  const card = { ...elCard, label: 'Mi Card' };
  ctx.Exporter.svg([btn, card]);
  const svgOut = lastBlob(ctx).content;
  assert.ok(svgOut.includes('Enviar &lt;ya&gt;'), 'label escapado en SVG');
  assert.ok(!svgOut.includes('>Button<'), 'no usa el fallback si hay label');
  assert.ok(svgOut.includes('Mi Card'));

  ctx.Exporter.html([btn, card]);
  const htmlOut = lastBlob(ctx).content;
  assert.ok(htmlOut.includes('Enviar &lt;ya&gt;'), 'label escapado en HTML');
  assert.ok(htmlOut.includes('Mi Card'));
});

test('Exporter.isValidElement: label opcional debe ser string', () => {
  const ctx = freshCtx();
  assert.ok(ctx.Exporter.isValidElement({ ...elButton, label: 'Enviar' }));
  assert.equal(ctx.Exporter.isValidElement({ ...elButton, label: 42 }), false);
  assert.ok(ctx.Exporter.isValidElement(elButton), 'sin label sigue siendo válido');
});

/* ============================================================
   Imágenes pegadas (type: image)
   ============================================================ */

const PNG_SRC = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
const elImage = { ...base, type: 'image', x: 100, y: 50, w: 200, h: 150, src: PNG_SRC };

test('Exporter.isValidElement: image válida con data-URL PNG/JPEG', () => {
  const ctx = freshCtx();
  assert.ok(ctx.Exporter.isValidElement(elImage));
  assert.ok(ctx.Exporter.isValidElement({ ...elImage, src: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==' }));
});

test('Exporter.isValidElement: rechaza image con src peligroso o malformado', () => {
  const ctx = freshCtx();
  const bad = [
    { ...elImage, src: 'javascript:alert(1)' },
    { ...elImage, src: 'https://evil.example/x.png' },
    { ...elImage, src: 'data:text/html;base64,PHNjcmlwdD4=' },
    { ...elImage, src: 'data:image/svg+xml;base64,PHN2Zz4=' },   // SVG puede ejecutar scripts
    { ...elImage, src: 'data:image/png;base64,"><script>' },     // charset no-base64
    { ...elImage, src: 42 },
    { ...elImage, src: undefined },
    { ...elImage, w: '200' },
  ];
  for (const el of bad) {
    assert.equal(ctx.Exporter.isValidElement(el), false, `debe rechazar src=${String(el.src).slice(0, 40)}`);
  }
});

test('Exporter.svg: image genera <image> con href, tamaño y posición', () => {
  const ctx = freshCtx();
  ctx.Exporter.svg([elImage]);
  const out = lastBlob(ctx).content;
  assert.match(out, /<image x="100" y="50" width="200" height="150" href="data:image\/png;base64,/);
});

test('Exporter.html: image genera <img> posicionado con el src escapado', () => {
  const ctx = freshCtx();
  ctx.Exporter.html([elImage]);
  const out = lastBlob(ctx).content;
  assert.ok(out.includes('<img src="data:image/png;base64,'), 'img presente');
  assert.ok(out.includes('left:100px;top:50px;width:200px;height:150px'), 'posición y tamaño');
});

test('Exporter.json: round-trip de un elemento image conserva el src', async () => {
  const ctx = freshCtx();
  ctx.Exporter.json([elImage]);
  const jsonStr = lastBlob(ctx).content;
  const p = ctx.Exporter.importJSON();
  const input = ctx.document.created[ctx.document.created.length - 1];
  input.onchange({ target: { files: [{ text: jsonStr }] } });
  const els = JSON.parse(JSON.stringify(await p));
  assert.equal(els.length, 1, 'la imagen sobrevive a la validación del import');
  assert.equal(els[0].src, PNG_SRC);
});

/* ============================================================
   Flecha curva (type: curveArrow)
   ============================================================ */

const elCurve = { ...base, type: 'curveArrow', x1: 10, y1: 20, cx: 60, cy: 80, x2: 110, y2: 20 };

test('Exporter.isValidElement: curveArrow requiere x1/y1/x2/y2/cx/cy numéricos', () => {
  const ctx = freshCtx();
  assert.ok(ctx.Exporter.isValidElement(elCurve));
  assert.equal(ctx.Exporter.isValidElement({ ...elCurve, cx: undefined }), false);
  assert.equal(ctx.Exporter.isValidElement({ ...elCurve, cy: 'a' }), false);
});

test('Exporter.svg: curveArrow genera <path> con Q y 2 líneas de punta', () => {
  const ctx = freshCtx();
  ctx.Exporter.svg([elCurve]);
  const out = lastBlob(ctx).content;
  assert.ok(out.includes('<path d="M10 20 Q60 80 110 20"'), 'path cuadrático');
  assert.equal((out.match(/<line /g) || []).length, 2, '2 líneas de punta');
});

test('Exporter.html: curveArrow va en el <svg> incrustado', () => {
  const ctx = freshCtx();
  ctx.Exporter.html([elCurve]);
  const out = lastBlob(ctx).content;
  assert.ok(out.includes('<svg width="1200"'), 'svg incrustado presente');
  assert.ok(out.includes('Q60 80 110 20'), 'curva dentro del svg');
});

/* ============================================================
   Doble punta (heads) y tamaño de punta derivado del grosor
   ============================================================ */

test('Exporter.isValidElement: heads acepta undefined/end/both y rechaza el resto', () => {
  const ctx = freshCtx();
  assert.ok(ctx.Exporter.isValidElement(elCurve), 'sin heads sigue siendo válido');
  assert.ok(ctx.Exporter.isValidElement({ ...elCurve, heads: 'end' }));
  assert.ok(ctx.Exporter.isValidElement({ ...elCurve, heads: 'both' }));
  assert.ok(ctx.Exporter.isValidElement({ ...elArrow, heads: 'both' }));
  for (const heads of ['x', true, 1, null, '', 'start']) {
    assert.equal(ctx.Exporter.isValidElement({ ...elCurve, heads }), false, `debe rechazar heads=${JSON.stringify(heads)}`);
    assert.equal(ctx.Exporter.isValidElement({ ...elArrow, heads }), false, `debe rechazar heads=${JSON.stringify(heads)} en arrow`);
  }
});

test('Exporter.svg: curveArrow con heads both genera 1 <path> + 4 <line> (2 sin heads)', () => {
  const ctx = freshCtx();
  ctx.Exporter.svg([{ ...elCurve, heads: 'both' }]);
  const both = lastBlob(ctx).content;
  assert.equal((both.match(/<path d="M10 20 Q/g) || []).length, 1, 'una única curva');
  assert.equal((both.match(/<line /g) || []).length, 4, '2 puntas × 2 líneas');
  // Las líneas de la punta inicial parten de (x1,y1)
  assert.ok(both.includes('<line x1="10" y1="20"'), 'punta inicial anclada en (x1,y1)');

  // Regresión: sin heads (y con heads:'end') sigue siendo 1 path + 2 líneas
  ctx.Exporter.svg([elCurve]);
  const plain = lastBlob(ctx).content;
  assert.equal((plain.match(/<line /g) || []).length, 2);
  ctx.Exporter.svg([{ ...elCurve, heads: 'end' }]);
  const end = lastBlob(ctx).content;
  assert.equal((end.match(/<line /g) || []).length, 2, "heads:'end' ≡ comportamiento actual");
});

test('Exporter.svg: arrow con heads both genera 5 <line> (cuerpo + 2 puntas)', () => {
  const ctx = freshCtx();
  ctx.Exporter.svg([{ ...elArrow, heads: 'both' }]);
  const out = lastBlob(ctx).content;
  assert.equal((out.match(/<line /g) || []).length, 5);
  assert.ok(out.includes('<line x1="0" y1="0" x2="100" y2="0"'), 'cuerpo intacto');
});

test('Exporter.svg: la punta escala con lineWidth (10 + 2·lw; 14 con el default 2)', () => {
  const ctx = freshCtx();
  // elArrow: (0,0)→(100,0), angle 0 → extremo de punta en 100 − hl·cos(0.4)
  ctx.Exporter.svg([elArrow]); // lineWidth 2 → hl 14 (coordenadas históricas)
  const lw2 = lastBlob(ctx).content;
  assert.ok(lw2.includes(`x2="${100 - 14 * Math.cos(0.4)}"`), 'lw=2 → punta de 14');
  ctx.Exporter.svg([{ ...elArrow, lineWidth: 4 }]);
  const lw4 = lastBlob(ctx).content;
  assert.ok(lw4.includes(`x2="${100 - 18 * Math.cos(0.4)}"`), 'lw=4 → punta de 18');
  assert.ok(!lw4.includes(`x2="${100 - 14 * Math.cos(0.4)}"`), 'lw=4 ya no usa 14');
});

test('Exporter.json + importJSON: heads both sobrevive al round-trip y valida', async () => {
  const ctx = freshCtx();
  const elements = [{ ...elArrow, heads: 'both' }, { ...elCurve, heads: 'both' }, elCurve];
  ctx.Exporter.json(elements);
  const jsonStr = lastBlob(ctx).content;
  const p = ctx.Exporter.importJSON();
  const input = ctx.document.created[ctx.document.created.length - 1];
  input.onchange({ target: { files: [{ text: jsonStr }] } });
  const els = JSON.parse(JSON.stringify(await p));
  assert.equal(els.length, 3, 'ningún elemento descartado por la validación');
  assert.deepEqual(els, elements, 'heads persiste tal cual');
});

/* ============================================================
   Trazo discontinuo (dash) y regresión de validación de label
   ============================================================ */

test('Exporter.isValidElement: dash acepta undefined/true y rechaza el resto', () => {
  const ctx = freshCtx();
  assert.ok(ctx.Exporter.isValidElement({ ...elLine, dash: true }));
  assert.ok(ctx.Exporter.isValidElement(elLine), 'sin dash sigue válido');
  assert.equal(ctx.Exporter.isValidElement({ ...elLine, dash: false }), false);
  assert.equal(ctx.Exporter.isValidElement({ ...elLine, dash: 1 }), false);
  assert.equal(ctx.Exporter.isValidElement({ ...elLine, dash: 'true' }), false);
});

test('Exporter.isValidElement: label no-string se rechaza también en flechas (regresión de orden)', () => {
  // Regresión: el check de label estaba tras los return tempranos por tipo
  // y era inalcanzable para line/arrow/curveArrow/pencil
  const ctx = freshCtx();
  assert.equal(ctx.Exporter.isValidElement({ ...elArrow, label: 5 }), false);
  assert.equal(ctx.Exporter.isValidElement({ ...elCurve, label: {} }), false);
  assert.equal(ctx.Exporter.isValidElement({ ...elPencil, label: 5 }), false);
  assert.ok(ctx.Exporter.isValidElement({ ...elArrow, label: 'ok' }));
});

test('Exporter.svg: arrow con dash lleva stroke-dasharray solo en el cuerpo', () => {
  const ctx = freshCtx();
  ctx.Exporter.svg([{ ...elArrow, lineWidth: 3, dash: true }]);
  const out = lastBlob(ctx).content;
  const lines = out.split('\n').filter(l => l.startsWith('<line'));
  assert.equal(lines.length, 3);
  assert.ok(lines[0].includes('stroke-dasharray="12 12"'), 'cuerpo discontinuo');
  assert.ok(!lines[1].includes('stroke-dasharray'), 'punta 1 sólida');
  assert.ok(!lines[2].includes('stroke-dasharray'), 'punta 2 sólida');
});

test('Exporter.svg: curveArrow con dash lleva stroke-dasharray en el <path>', () => {
  const ctx = freshCtx();
  ctx.Exporter.svg([{ ...elCurve, dash: true }]);
  const out = lastBlob(ctx).content;
  const path = out.split('\n').find(l => l.startsWith('<path'));
  assert.ok(path.includes('stroke-dasharray="8 8"'));
  const lines = out.split('\n').filter(l => l.startsWith('<line'));
  assert.ok(lines.every(l => !l.includes('stroke-dasharray')), 'puntas sólidas');
});

test('Exporter.json + importJSON: dash sobrevive al round-trip', async () => {
  const ctx = freshCtx();
  const els = [{ ...elLine, dash: true }, { ...elCurve, dash: true }];
  ctx.Exporter.json(els);
  const jsonStr = lastBlob(ctx).content;
  const p = ctx.Exporter.importJSON();
  const input = ctx.document.created[ctx.document.created.length - 1];
  input.onchange({ target: { files: [{ text: jsonStr }] } });
  const back = JSON.parse(JSON.stringify(await p));
  assert.equal(back.length, 2);
  assert.ok(back.every(e => e.dash === true));
});

/* ============================================================
   Etiquetas sobre flechas en exports
   ============================================================ */

test('Exporter.svg: arrow con label genera <text> centrado y escapado', () => {
  const ctx = freshCtx();
  ctx.Exporter.svg([{ ...elArrow, label: 'sí <& "ya"' }]);
  const out = lastBlob(ctx).content;
  const text = out.split('\n').find(l => l.startsWith('<text'));
  assert.ok(text, 'hay <text>');
  assert.ok(text.includes('text-anchor="middle"'));
  assert.ok(text.includes('paint-order="stroke"'), 'halo blanco');
  assert.ok(text.includes('x="50" y="0"'), 'punto medio del segmento (0,0)-(100,0)');
  assert.ok(text.includes('sí &lt;&amp; &quot;ya&quot;'), 'contenido escapado');
});

test('Exporter.svg: curveArrow con label centra el <text> en Q(0.5)', () => {
  const ctx = freshCtx();
  ctx.Exporter.svg([{ ...base, type: 'curveArrow', x1: 0, y1: 0, cx: 50, cy: 100, x2: 100, y2: 0, label: 'ok' }]);
  const out = lastBlob(ctx).content;
  const text = out.split('\n').find(l => l.startsWith('<text'));
  assert.ok(text.includes('x="50" y="50"'), 'Q(0.5) de la curva');
});

test('Exporter.html: el label de la flecha va en el <svg> incrustado, escapado', () => {
  const ctx = freshCtx();
  ctx.Exporter.html([{ ...elArrow, label: '<b>x</b>' }]);
  const out = lastBlob(ctx).content;
  assert.ok(out.includes('&lt;b&gt;x&lt;/b&gt;'), 'escapado');
  assert.ok(!out.includes('<b>x</b>'), 'nunca crudo');
});

test('round-trip JSON conserva el label de una flecha', async () => {
  const ctx = freshCtx();
  ctx.Exporter.json([{ ...elCurve, label: 'flujo' }]);
  const jsonStr = lastBlob(ctx).content;
  const p = ctx.Exporter.importJSON();
  const input = ctx.document.created[ctx.document.created.length - 1];
  input.onchange({ target: { files: [{ text: jsonStr }] } });
  const back = JSON.parse(JSON.stringify(await p));
  assert.equal(back[0].label, 'flujo');
});
