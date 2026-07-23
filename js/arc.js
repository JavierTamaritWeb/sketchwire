/* ============================================================
   arc.js — Geometría de arcos circulares para la flecha curva

   Un arco de circunferencia de amplitud ≤ 180° se aproxima con UNA
   Bézier cúbica (controles tangentes de longitud k = 4/3·tan(α/4)·R),
   así el elemento sigue siendo un curveArrow cúbico normal (con la
   marca opcional `arc: true`) y renderer/exportadores/hit-test no
   cambian. El error radial máximo es ≈1.7% del radio en el semicírculo
   completo, invisible bajo el jitter de Sketchy.

   El "radio" se controla vía la sagitta s (comba: distancia firmada del
   ápice a la cuerda): R = (h² + s²) / (2·|s|), con h = cuerda/2.
   |s| = h → semicírculo exacto (radio mínimo L/2); s → 0 → arco cada
   vez más plano (R → ∞). El signo de s indica el lado, con el mismo
   convenio que la perpendicular u = (-dy, dx)/L de chordFrame (app.js).
   ============================================================ */

const ArcMath = (() => {
  'use strict';

  // Comba mínima en px (por debajo el arco es visualmente una recta)
  const MIN_SAGITTA = 6;

  /**
   * Sagitta firmada recortada al rango válido [min(6, h), h] conservando
   * el signo (lado); s = 0 se trata como lado positivo. Una sola cúbica
   * no representa bien arcos > 180°, de ahí el tope en h (semicírculo).
   */
  function clampSagitta(s, chordLen) {
    const h = chordLen / 2;
    const lo = Math.min(MIN_SAGITTA, h);
    const sign = Math.sign(s) || 1;
    return sign * Math.max(lo, Math.min(h, Math.abs(s)));
  }

  /**
   * Controles cúbicos {cx, cy, cx2, cy2} del arco circular sobre la
   * cuerda (x1,y1)–(x2,y2) con sagitta firmada s. Devuelve null si la
   * cuerda o la sagitta son degeneradas.
   */
  function arcCtrls(x1, y1, x2, y2, s) {
    const dx = x2 - x1, dy = y2 - y1;
    const L = Math.hypot(dx, dy);
    if (L < 1e-3 || !isFinite(s) || Math.abs(s) < 1e-3) return null;
    const h = L / 2;
    const abs = Math.min(Math.abs(s), h);
    const sign = Math.sign(s);
    const ux = -dy / L, uy = dx / L;
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    const apexX = mx + sign * abs * ux, apexY = my + sign * abs * uy;
    const R = (h * h + abs * abs) / (2 * abs);
    // Centro: desde el punto medio, R − |s| hacia el lado contrario al ápice
    const cX = mx - sign * (R - abs) * ux;
    const cY = my - sign * (R - abs) * uy;
    const alpha = 2 * Math.asin(Math.min(1, h / R)); // amplitud del arco menor
    const k = (4 / 3) * Math.tan(alpha / 4) * R;     // longitud de control
    // Tangente unitaria en p en el sentido de recorrido: perpendicular al
    // radio; el ángulo tangente-cuerda hacia el ápice es α/4 < 90°, así
    // que el signo del producto escalar con `toward` la orienta
    const tangentAt = (px, py, towardX, towardY) => {
      const rx = (px - cX) / R, ry = (py - cY) / R;
      let tx = -ry, ty = rx;
      if (tx * towardX + ty * towardY < 0) { tx = -tx; ty = -ty; }
      return { tx, ty };
    };
    const t1 = tangentAt(x1, y1, apexX - x1, apexY - y1);
    const t2 = tangentAt(x2, y2, x2 - apexX, y2 - apexY);
    return {
      cx:  x1 + k * t1.tx, cy:  y1 + k * t1.ty,
      cx2: x2 - k * t2.tx, cy2: y2 - k * t2.ty,
    };
  }

  /**
   * Sagitta firmada actual de una curveArrow: proyección del punto B(0.5)
   * del trazo sobre la perpendicular de la cuerda en su punto medio.
   * Acepta cuadráticas y cúbicas; 0 con cuerda degenerada.
   */
  function arcSagitta(el) {
    const dx = el.x2 - el.x1, dy = el.y2 - el.y1;
    const L = Math.hypot(dx, dy);
    if (L < 1e-3) return 0;
    let bx, by;
    if (el.cx2 !== undefined) {
      // B(0.5) cúbica = (p1 + 3·c1 + 3·c2 + p2) / 8
      bx = (el.x1 + 3 * el.cx + 3 * el.cx2 + el.x2) / 8;
      by = (el.y1 + 3 * el.cy + 3 * el.cy2 + el.y2) / 8;
    } else {
      // B(0.5) cuadrática = (p1 + 2·c + p2) / 4
      bx = (el.x1 + 2 * el.cx + el.x2) / 4;
      by = (el.y1 + 2 * el.cy + el.y2) / 4;
    }
    const ux = -dy / L, uy = dx / L;
    return (bx - (el.x1 + el.x2) / 2) * ux + (by - (el.y1 + el.y2) / 2) * uy;
  }

  return { arcCtrls, arcSagitta, clampSagitta, MIN_SAGITTA };
})();
