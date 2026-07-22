/* ============================================================
   sketchy.js — Hand-drawn primitives for the canvas
   ============================================================ */

const Sketchy = (() => {

  /* ── Fuente de aleatoriedad ── */

  let rand = Math.random;

  // PRNG mulberry32: rápido, determinista y suficiente para el jitter visual
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /**
   * Fija la fuente de aleatoriedad: con un seed numérico el dibujo es
   * determinista (mismo seed ⇒ mismo trazo, sin "temblor" entre redraws);
   * con cualquier otro valor vuelve a Math.random.
   */
  function setSeed(seed) {
    rand = (typeof seed === 'number' && isFinite(seed)) ? mulberry32(seed) : Math.random;
  }

  /**
   * Draw a wobbly hand-drawn line between two points.
   */
  function line(ctx, x1, y1, x2, y2, roughness = 1.5) {
    const len = Math.hypot(x2 - x1, y2 - y1);
    const segments = Math.max(2, Math.floor(len / 20));
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    for (let i = 1; i <= segments; i++) {
      const t = i / segments;
      const mx = x1 + (x2 - x1) * t + (rand() - 0.5) * roughness;
      const my = y1 + (y2 - y1) * t + (rand() - 0.5) * roughness;
      ctx.lineTo(mx, my);
    }
    ctx.stroke();
  }

  /**
   * Draw a sketchy rectangle (4 wobbly lines).
   */
  function rect(ctx, x, y, w, h, roughness = 1.5) {
    line(ctx, x,     y,     x + w, y,     roughness);
    line(ctx, x + w, y,     x + w, y + h, roughness);
    line(ctx, x + w, y + h, x,     y + h, roughness);
    line(ctx, x,     y + h, x,     y,     roughness);
  }

  /**
   * Draw a sketchy rounded rectangle.
   */
  function roundedRect(ctx, x, y, w, h, r = 12, roughness = 1) {
    const segs = 8;
    ctx.beginPath();
    ctx.moveTo(x + r, y);

    // Top edge
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      ctx.lineTo(
        x + r + (w - 2 * r) * t + (rand() - 0.5) * roughness,
        y + (rand() - 0.5) * roughness
      );
    }
    ctx.arcTo(x + w, y, x + w, y + r, r);

    // Right edge
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      ctx.lineTo(
        x + w + (rand() - 0.5) * roughness,
        y + r + (h - 2 * r) * t + (rand() - 0.5) * roughness
      );
    }
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);

    // Bottom edge
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      ctx.lineTo(
        x + w - r - (w - 2 * r) * t + (rand() - 0.5) * roughness,
        y + h + (rand() - 0.5) * roughness
      );
    }
    ctx.arcTo(x, y + h, x, y + h - r, r);

    // Left edge
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      ctx.lineTo(
        x + (rand() - 0.5) * roughness,
        y + h - r - (h - 2 * r) * t + (rand() - 0.5) * roughness
      );
    }
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
    ctx.stroke();
  }

  /**
   * Draw a sketchy ellipse.
   */
  function ellipse(ctx, cx, cy, rx, ry, roughness = 1.5) {
    const pts = 36;
    ctx.beginPath();
    for (let i = 0; i <= pts; i++) {
      const angle = (i / pts) * Math.PI * 2;
      const px = cx + rx * Math.cos(angle) + (rand() - 0.5) * roughness;
      const py = cy + ry * Math.sin(angle) + (rand() - 0.5) * roughness;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.stroke();
  }

  /**
   * Draw a wobbly quadratic curve from (x1,y1) to (x2,y2) with control
   * point (cx,cy).
   */
  function curve(ctx, x1, y1, cx, cy, x2, y2, roughness = 1.5) {
    const len = Math.hypot(cx - x1, cy - y1) + Math.hypot(x2 - cx, y2 - cy);
    const segments = Math.max(8, Math.floor(len / 20));
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    for (let i = 1; i <= segments; i++) {
      const t = i / segments;
      const mt = 1 - t;
      ctx.lineTo(
        mt * mt * x1 + 2 * mt * t * cx + t * t * x2 + (rand() - 0.5) * roughness,
        mt * mt * y1 + 2 * mt * t * cy + t * t * y2 + (rand() - 0.5) * roughness
      );
    }
    ctx.stroke();
  }

  /**
   * Draw a wobbly cubic curve from (x1,y1) to (x2,y2) with control
   * points (cx1,cy1) and (cx2,cy2).
   */
  function cubicCurve(ctx, x1, y1, cx1, cy1, cx2, cy2, x2, y2, roughness = 1.5) {
    const len = Math.hypot(cx1 - x1, cy1 - y1) + Math.hypot(cx2 - cx1, cy2 - cy1) + Math.hypot(x2 - cx2, y2 - cy2);
    const segments = Math.max(8, Math.floor(len / 20));
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    for (let i = 1; i <= segments; i++) {
      const t = i / segments;
      const mt = 1 - t;
      ctx.lineTo(
        mt * mt * mt * x1 + 3 * mt * mt * t * cx1 + 3 * mt * t * t * cx2 + t * t * t * x2 + (rand() - 0.5) * roughness,
        mt * mt * mt * y1 + 3 * mt * mt * t * cy1 + 3 * mt * t * t * cy2 + t * t * t * y2 + (rand() - 0.5) * roughness
      );
    }
    ctx.stroke();
  }

  /**
   * Segmentos de una punta de flecha en (x, y) apuntando según `angle`.
   * Pura y sin jitter (no consume el PRNG): devuelve los 2 segmentos
   * [{x1,y1,x2,y2}, {x1,y1,x2,y2}] con aberturas angle ± 0.4.
   * Compartida por renderer y exporter para no duplicar el cálculo.
   */
  function arrowHead(x, y, angle, len) {
    return [
      { x1: x, y1: y, x2: x - len * Math.cos(angle - 0.4), y2: y - len * Math.sin(angle - 0.4) },
      { x1: x, y1: y, x2: x - len * Math.cos(angle + 0.4), y2: y - len * Math.sin(angle + 0.4) },
    ];
  }

  /**
   * Draw a sketchy arrow (line + arrowhead).
   * La punta escala con el grosor del trazo: 10 + 2·lineWidth
   * (con el default lineWidth=2 son los 14px históricos).
   */
  function arrow(ctx, x1, y1, x2, y2, roughness = 1.5) {
    line(ctx, x1, y1, x2, y2, roughness);
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const headLen = 10 + 2 * (ctx.lineWidth || 2);
    arrowHead(x2, y2, angle, headLen).forEach(sg => {
      line(ctx, sg.x1, sg.y1, sg.x2, sg.y2, roughness);
    });
  }

  return { line, rect, roundedRect, ellipse, arrow, arrowHead, curve, cubicCurve, setSeed };
})();
