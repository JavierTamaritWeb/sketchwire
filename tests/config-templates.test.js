'use strict';
/* ============================================================
   config-templates.test.js — Tests de js/config.js y js/templates.js
   Ejecutar desde la raíz del proyecto:
     node --test tests/config-templates.test.js
   ============================================================ */

const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers/load.js');

/* ---------------- config.js ---------------- */

test('config.js — TOOLS', async t => {
  const ctx = load('js/config.js');

  await t.test('TOOLS está congelado (Object.freeze)', () => {
    assert.equal(Object.isFrozen(ctx.TOOLS), true);
  });

  await t.test('TOOLS tiene exactamente los 15 ids esperados', () => {
    const expected = [
      'pencil', 'line', 'rect', 'roundedRect', 'circle', 'arrow',
      'text', 'eraser', 'select', 'imagePlaceholder', 'button',
      'input', 'nav', 'card', 'image',
    ];
    const values = Object.values(ctx.TOOLS);
    assert.equal(values.length, 15);
    assert.deepEqual([...values].sort(), [...expected].sort());
    // Las claves también son 15 y únicas
    assert.equal(Object.keys(ctx.TOOLS).length, 15);
    assert.equal(new Set(values).size, 15);
  });
});

test('config.js — TOOL_GROUPS: cada tool referenciado existe en TOOLS', () => {
  const ctx = load('js/config.js');
  const toolIds = new Set(Object.values(ctx.TOOLS));
  assert.ok(Array.isArray(ctx.TOOL_GROUPS));
  assert.ok(ctx.TOOL_GROUPS.length > 0);
  for (const group of ctx.TOOL_GROUPS) {
    assert.equal(typeof group.label, 'string');
    assert.ok(Array.isArray(group.tools));
    for (const tool of group.tools) {
      assert.ok(
        toolIds.has(tool.id),
        `tool.id "${tool.id}" (grupo "${group.label}") no existe en TOOLS`,
      );
      assert.equal(typeof tool.icon, 'string');
      assert.equal(typeof tool.name, 'string');
    }
  }
});

test('config.js — COLORS son colores hex válidos (#rrggbb)', () => {
  const ctx = load('js/config.js');
  assert.ok(Array.isArray(ctx.COLORS));
  assert.ok(ctx.COLORS.length > 0);
  for (const c of ctx.COLORS) {
    assert.match(c, /^#[0-9a-fA-F]{6}$/, `COLORS contiene un hex inválido: ${c}`);
  }
});

test('config.js — CANVAS_W/CANVAS_H', () => {
  const ctx = load('js/config.js');
  assert.equal(ctx.CANVAS_W, 1200);
  assert.equal(ctx.CANVAS_H, 800);
});

test('config.js — UI_DEFAULTS tiene w/h positivos para los 5 componentes UI', () => {
  const ctx = load('js/config.js');
  const { TOOLS, UI_DEFAULTS } = ctx;
  const keys = [TOOLS.BUTTON, TOOLS.INPUT, TOOLS.IMAGE_PLACEHOLDER, TOOLS.NAV, TOOLS.CARD];
  for (const key of keys) {
    const def = UI_DEFAULTS[key];
    assert.ok(def, `UI_DEFAULTS no tiene entrada para "${key}"`);
    assert.equal(typeof def.w, 'number');
    assert.equal(typeof def.h, 'number');
    assert.ok(def.w > 0, `UI_DEFAULTS[${key}].w debe ser > 0 (es ${def.w})`);
    assert.ok(def.h > 0, `UI_DEFAULTS[${key}].h debe ser > 0 (es ${def.h})`);
  }
});

/* ---------------- templates.js ---------------- */

const TEMPLATE_NAMES = ['landing', 'dashboard', 'form'];

test('templates.js — Templates.get devuelve copias profundas', () => {
  const ctx = load('js/templates.js');
  for (const name of TEMPLATE_NAMES) {
    const a = ctx.Templates.get(name);
    assert.ok(Array.isArray(a) && a.length > 0, `template "${name}" vacío`);
    // Mutar el resultado no debe afectar a la siguiente llamada
    a[0].x = 99999;
    a[0].type = 'mutado';
    a.push({ type: 'basura' });
    const b = ctx.Templates.get(name);
    assert.notEqual(a, b, 'get() debe devolver un array nuevo cada vez');
    assert.notEqual(a[0], b[0], 'los elementos deben ser objetos nuevos');
    assert.notEqual(b[0].x, 99999);
    assert.notEqual(b[0].type, 'mutado');
    assert.equal(b.length, a.length - 1, 'la mutación del array no debe persistir');
  }
});

test('templates.js — elementos válidos (type conocido, coords en canvas, w/h positivos)', async t => {
  const ctx = load('js/templates.js');
  const knownTypes = new Set(Object.values(ctx.TOOLS));
  const W = ctx.CANVAS_W; // 1200
  const H = ctx.CANVAS_H; // 800

  for (const name of TEMPLATE_NAMES) {
    await t.test(`template "${name}"`, () => {
      const els = ctx.Templates.get(name);
      assert.ok(els.length > 0);
      els.forEach((el, i) => {
        const tag = `${name}[${i}] (${el.type})`;
        assert.ok(knownTypes.has(el.type), `${tag}: type desconocido "${el.type}"`);

        assert.equal(typeof el.x, 'number', `${tag}: x no numérico`);
        assert.equal(typeof el.y, 'number', `${tag}: y no numérico`);
        assert.ok(Number.isFinite(el.x) && el.x >= 0 && el.x <= W, `${tag}: x=${el.x} fuera de [0,${W}]`);
        assert.ok(Number.isFinite(el.y) && el.y >= 0 && el.y <= H, `${tag}: y=${el.y} fuera de [0,${H}]`);

        if ('w' in el || 'h' in el) {
          assert.equal(typeof el.w, 'number', `${tag}: w no numérico`);
          assert.equal(typeof el.h, 'number', `${tag}: h no numérico`);
          assert.ok(el.w > 0, `${tag}: w=${el.w} debe ser > 0`);
          assert.ok(el.h > 0, `${tag}: h=${el.h} debe ser > 0`);
          // El elemento entero cabe dentro del canvas 1200x800
          assert.ok(el.x + el.w <= W, `${tag}: x+w=${el.x + el.w} > ${W}`);
          assert.ok(el.y + el.h <= H, `${tag}: y+h=${el.y + el.h} > ${H}`);
        }

        assert.equal(typeof el.color, 'string', `${tag}: color no string`);
        // Nota: templates.js usa colores hex de 6 dígitos, salvo el subtítulo
        // del landing que usa C + '80' => hex de 8 dígitos (#rrggbbaa) para
        // simular transparencia. Ambos son válidos para canvas.
        assert.match(el.color, /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, `${tag}: color inválido "${el.color}"`);
        assert.equal(typeof el.lineWidth, 'number', `${tag}: lineWidth no numérico`);
      });
    });
  }
});

test('templates.js — Templates.get("inexistente") devuelve []', () => {
  const ctx = load('js/templates.js');
  const res = ctx.Templates.get('inexistente');
  assert.ok(Array.isArray(res));
  assert.equal(res.length, 0);
  // También con undefined/null
  // (nota: los arrays vienen del realm del vm, así que se comprueba
  //  estructuralmente en vez de con deepStrictEqual contra [] del host)
  assert.equal(ctx.Templates.get().length, 0);
  assert.equal(ctx.Templates.get(null).length, 0);
});

test('templates.js — get() con nombres heredados de Object.prototype devuelve []', () => {
  // Regresión: `all[name] || []` no filtraba propiedades heredadas y
  // Templates.get('toString') lanzaba SyntaxError. Corregido con Object.hasOwn.
  const ctx = load('js/templates.js');
  assert.equal(ctx.Templates.get('toString').length, 0);
  assert.equal(ctx.Templates.get('constructor').length, 0);
  assert.equal(ctx.Templates.get('hasOwnProperty').length, 0);
});
