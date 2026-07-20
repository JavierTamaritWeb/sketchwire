'use strict';
/* ============================================================
   ctx-stub.js — Stub de CanvasRenderingContext2D que registra
   todas las llamadas y asignaciones de propiedades en .calls
   ============================================================ */

const METHODS = [
  'beginPath', 'moveTo', 'lineTo', 'stroke', 'fill', 'arcTo', 'arc',
  'fillText', 'strokeText', 'strokeRect', 'fillRect', 'setLineDash',
  'save', 'restore', 'clearRect', 'ellipse', 'roundRect', 'closePath',
  'rect', 'clip', 'translate', 'rotate', 'scale', 'drawImage',
  'quadraticCurveTo', 'bezierCurveTo', 'measureText',
];

const PROPS = [
  'strokeStyle', 'fillStyle', 'lineWidth', 'font', 'textAlign',
  'textBaseline', 'lineCap', 'lineJoin', 'globalCompositeOperation',
  'globalAlpha',
];

/**
 * createCtxStub() -> ctx
 *
 * ctx.calls              array de { name, args } en orden de invocación.
 *                        Las asignaciones de propiedad se registran como
 *                        { name: 'set strokeStyle', args: [valor] }.
 * ctx.methodNames()      -> array de nombres (para asserts de secuencia).
 * ctx.callsTo(name)      -> solo las llamadas a ese método/propiedad.
 * ctx.reset()            vacía .calls.
 *
 * Leer una propiedad (ctx.strokeStyle) devuelve el último valor asignado.
 * measureText devuelve { width } aproximado para no romper a quien lo use.
 */
function createCtxStub() {
  const calls = [];
  const ctx = { calls };

  for (const m of METHODS) {
    ctx[m] = (...args) => {
      calls.push({ name: m, args });
      if (m === 'measureText') {
        return { width: args[0] == null ? 0 : String(args[0]).length * 7 };
      }
      return undefined;
    };
  }

  const values = {};
  for (const p of PROPS) {
    Object.defineProperty(ctx, p, {
      enumerable: true,
      get: () => values[p],
      set: v => {
        values[p] = v;
        calls.push({ name: `set ${p}`, args: [v] });
      },
    });
  }

  ctx.methodNames = () => calls.map(c => c.name);
  ctx.callsTo = name => calls.filter(c => c.name === name);
  ctx.reset = () => { calls.length = 0; };

  return ctx;
}

module.exports = { createCtxStub, METHODS, PROPS };
