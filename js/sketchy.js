/* ============================================================
   sketchy.js — Hand-drawn primitives for the canvas
   ============================================================ */

const Sketchy = (() => {

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
      const mx = x1 + (x2 - x1) * t + (Math.random() - 0.5) * roughness;
      const my = y1 + (y2 - y1) * t + (Math.random() - 0.5) * roughness;
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
        x + r + (w - 2 * r) * t + (Math.random() - 0.5) * roughness,
        y + (Math.random() - 0.5) * roughness
      );
    }
    ctx.arcTo(x + w, y, x + w, y + r, r);

    // Right edge
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      ctx.lineTo(
        x + w + (Math.random() - 0.5) * roughness,
        y + r + (h - 2 * r) * t + (Math.random() - 0.5) * roughness
      );
    }
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);

    // Bottom edge
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      ctx.lineTo(
        x + w - r - (w - 2 * r) * t + (Math.random() - 0.5) * roughness,
        y + h + (Math.random() - 0.5) * roughness
      );
    }
    ctx.arcTo(x, y + h, x, y + h - r, r);

    // Left edge
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      ctx.lineTo(
        x + (Math.random() - 0.5) * roughness,
        y + h - r - (h - 2 * r) * t + (Math.random() - 0.5) * roughness
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
      const px = cx + rx * Math.cos(angle) + (Math.random() - 0.5) * roughness;
      const py = cy + ry * Math.sin(angle) + (Math.random() - 0.5) * roughness;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.stroke();
  }

  /**
   * Draw a sketchy arrow (line + arrowhead).
   */
  function arrow(ctx, x1, y1, x2, y2, roughness = 1.5) {
    line(ctx, x1, y1, x2, y2, roughness);
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const headLen = 14;
    line(ctx, x2, y2,
      x2 - headLen * Math.cos(angle - 0.4),
      y2 - headLen * Math.sin(angle - 0.4),
      roughness
    );
    line(ctx, x2, y2,
      x2 - headLen * Math.cos(angle + 0.4),
      y2 - headLen * Math.sin(angle + 0.4),
      roughness
    );
  }

  return { line, rect, roundedRect, ellipse, arrow };
})();
