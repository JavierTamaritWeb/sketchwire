'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load, loadAll, getGlobal } = require('./helpers/load.js');

test('config.js expone TOOLS y CANVAS_W en el contexto', () => {
  const ctx = load('js/config.js');
  assert.ok(ctx.TOOLS, 'TOOLS debe existir');
  assert.equal(typeof ctx.TOOLS, 'object');
  assert.equal(ctx.TOOLS.PENCIL, 'pencil');
  assert.equal(ctx.CANVAS_W, 1200);
  assert.equal(ctx.CANVAS_H, 800);
  assert.ok(Array.isArray(ctx.TOOL_GROUPS));
  assert.ok(Array.isArray(ctx.COLORS));
  assert.equal(typeof ctx.UI_DEFAULTS, 'object');
  assert.equal(typeof ctx.SKETCHY_FONT, 'string');
  // getGlobal lee bindings const arbitrarios del contexto
  assert.equal(getGlobal(ctx, 'CANVAS_W'), 1200);
});

test('loadAll carga todos los scripts en orden y expone los globals', () => {
  const ctx = loadAll();
  assert.equal(typeof ctx.Sketchy, 'object');
  assert.equal(typeof ctx.Sketchy.line, 'function');
  assert.equal(typeof ctx.Renderer, 'object');
  assert.equal(typeof ctx.Renderer.renderElement, 'function');
  assert.equal(typeof ctx.Exporter, 'object');
  assert.equal(typeof ctx.Exporter.png, 'function');
  assert.equal(typeof ctx.Templates, 'object');
});
