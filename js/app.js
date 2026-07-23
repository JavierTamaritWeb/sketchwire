/* ============================================================
   app.js — Main application controller
   ============================================================ */

;(function () {
  'use strict';

  /* ── State ── */

  const state = {
    tool:        TOOLS.PENCIL,
    color:       '#1a1a2e',
    lineWidth:   2,
    fontSize:    18,
    zoom:        1,
    fillShapes:  false,
    doubleHead:  false, // nuevas flechas con punta en ambos extremos
    dashed:      false, // nuevas líneas/flechas con trazo discontinuo
    curveFlip:   false, // Shift durante el trazado: curva hacia el otro lado
    showGrid:    true,
    snapGrid:    false,
    elements:    [],
    undoStack:   [],
    redoStack:   [],
    isDrawing:   false,
    startPos:    null,
    currentPath: [],
    selection:   [],    // índices seleccionados, ordenados
    editingIdx:  null,
    dragLast:    null,  // última posición durante un arrastre de selección
    dragSnapshot: null,
    didDrag:     false,
    marquee:     null,  // rectángulo de selección en curso {x1,y1,x2,y2}
    resizing:    null,  // resize en curso {corner, from, original, snapshot, did}
  };

  function setSelection(arr) {
    state.selection = [...new Set(arr)].sort((a, b) => a - b);
  }

  /* ── DOM refs ── */

  const $ = id => document.getElementById(id);

  const mainCanvas   = $('main-canvas');
  const overlayCanvas= $('overlay-canvas');
  const ctx          = mainCanvas.getContext('2d');
  const octx         = overlayCanvas.getContext('2d');
  const wrapper      = $('canvas-wrapper');
  const textInput    = $('text-input');

  /* ── Utility ── */

  function getPos(e) {
    const rect = mainCanvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / state.zoom,
      y: (e.clientY - rect.top)  / state.zoom,
    };
  }

  const UNDO_LIMIT = 50;
  const AUTOSAVE_KEY = 'sketchwire.autosave';
  const GRID_STEP = 20;

  function snapVal(v) {
    return Math.round(v / GRID_STEP) * GRID_STEP;
  }

  // Seed de jitter por elemento: serializable, sobrevive al export/import
  const newSeed = () => (Math.random() * 2 ** 31) | 0;

  function withSeeds(els) {
    return els.map(el => el.seed === undefined ? { ...el, seed: newSeed() } : el);
  }

  // Los elementos se tratan como inmutables (p. ej. moveElement devuelve una
  // copia), así que los snapshots pueden ser copias superficiales del array
  function snapshot() {
    return state.elements.slice();
  }

  function pushUndo(snap) {
    state.undoStack.push(snap);
    if (state.undoStack.length > UNDO_LIMIT) state.undoStack.shift();
    state.redoStack.length = 0;
  }

  function saveUndo() {
    pushUndo(snapshot());
  }

  function getElementBounds(el) {
    if (el.type === 'pencil' || el.type === 'eraser') {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      el.points.forEach(p => {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      });
      return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    }
    if (el.type === 'line' || el.type === 'arrow' || el.type === 'curveArrow') {
      // La curva cuadrática queda dentro del casco convexo de sus 3 puntos,
      // así que incluir el control da un bbox seguro
      const xs = [el.x1, el.x2], ys = [el.y1, el.y2];
      if (el.type === 'curveArrow') {
        xs.push(el.cx); ys.push(el.cy);
        if (el.cx2 !== undefined) { xs.push(el.cx2); ys.push(el.cy2); }
      }
      const x = Math.min(...xs), y = Math.min(...ys);
      return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
    }
    if (el.type === 'text') {
      const lines = el.value.split('\n');
      ctx.save();
      ctx.font = `${el.fontSize}px ${SKETCHY_FONT}`;
      const w = Math.max(...lines.map(ln => ctx.measureText(ln).width));
      ctx.restore();
      return { x: el.x, y: el.y, w, h: lines.length * (el.fontSize + 4) };
    }
    return { x: el.x, y: el.y, w: el.w, h: el.h };
  }

  function distToSegment(p, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    let t = len2 ? ((p.x - x1) * dx + (p.y - y1) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p.x - (x1 + dx * t), p.y - (y1 + dy * t));
  }

  function hitTest(pos) {
    for (let i = state.elements.length - 1; i >= 0; i--) {
      const el = state.elements[i];
      // Los trazos de borrador no son seleccionables
      if (el.type === 'eraser') continue;
      // Líneas y flechas: distancia al segmento, no bounding box
      if (el.type === 'line' || el.type === 'arrow') {
        if (distToSegment(pos, el.x1, el.y1, el.x2, el.y2) <= el.lineWidth / 2 + 6) return i;
        continue;
      }
      // Flecha curva: distancia a la polilínea que muestrea la curva
      // (cuadrática o cúbica según tenga segundo control)
      if (el.type === 'curveArrow') {
        const N = 20;
        const cubic = el.cx2 !== undefined;
        let px = el.x1, py = el.y1, hit = false;
        for (let s = 1; s <= N && !hit; s++) {
          const t = s / N, mt = 1 - t;
          let qx, qy;
          if (cubic) {
            qx = mt * mt * mt * el.x1 + 3 * mt * mt * t * el.cx + 3 * mt * t * t * el.cx2 + t * t * t * el.x2;
            qy = mt * mt * mt * el.y1 + 3 * mt * mt * t * el.cy + 3 * mt * t * t * el.cy2 + t * t * t * el.y2;
          } else {
            qx = mt * mt * el.x1 + 2 * mt * t * el.cx + t * t * el.x2;
            qy = mt * mt * el.y1 + 2 * mt * t * el.cy + t * t * el.y2;
          }
          hit = distToSegment(pos, px, py, qx, qy) <= el.lineWidth / 2 + 6;
          px = qx; py = qy;
        }
        if (hit) return i;
        continue;
      }
      const b = getElementBounds(el);
      if (pos.x >= b.x - 6 && pos.x <= b.x + b.w + 6 &&
          pos.y >= b.y - 6 && pos.y <= b.y + b.h + 6) {
        return i;
      }
    }
    return -1;
  }

  function moveElement(el, dx, dy) {
    const m = { ...el };
    if (m.points) {
      m.points = m.points.map(p => ({ x: p.x + dx, y: p.y + dy }));
    } else if (m.x1 !== undefined) {
      m.x1 += dx; m.y1 += dy; m.x2 += dx; m.y2 += dy;
      if (m.cx !== undefined) { m.cx += dx; m.cy += dy; }
      if (m.cx2 !== undefined) { m.cx2 += dx; m.cy2 += dy; }
    } else {
      m.x = (m.x || 0) + dx;
      m.y = (m.y || 0) + dy;
    }
    return m;
  }

  /* ── Geometría de la flecha curva ── */

  /**
   * Control por defecto de una curveArrow: perpendicular a la cuerda al 25%
   * de su longitud. Con flip, hacia el otro lado.
   */
  function defaultCtrl(p1, p2, flip) {
    const k = flip ? -0.25 : 0.25;
    return {
      cx: (p1.x + p2.x) / 2 - (p2.y - p1.y) * k,
      cy: (p1.y + p2.y) / 2 + (p2.x - p1.x) * k,
    };
  }

  /** Refleja el punto (px,py) respecto a la recta (x1,y1)–(x2,y2). */
  function reflectOverChord(px, py, x1, y1, dx, dy, len2) {
    const t = ((px - x1) * dx + (py - y1) * dy) / len2;
    const fx = x1 + dx * t, fy = y1 + dy * t;
    return { x: 2 * fx - px, y: 2 * fy - py };
  }

  /**
   * Copia de la curveArrow con el/los controles reflejados respecto a la
   * recta (x1,y1)–(x2,y2): invierte el lado del giro sin cambiar extremos.
   */
  function flipCurve(el) {
    const dx = el.x2 - el.x1, dy = el.y2 - el.y1;
    const len2 = dx * dx + dy * dy;
    if (!len2) return el; // extremos coincidentes: nada que reflejar
    const c1 = reflectOverChord(el.cx, el.cy, el.x1, el.y1, dx, dy, len2);
    const m = { ...el, cx: c1.x, cy: c1.y };
    if (el.cx2 !== undefined) {
      const c2 = reflectOverChord(el.cx2, el.cy2, el.x1, el.y1, dx, dy, len2);
      m.cx2 = c2.x; m.cy2 = c2.y;
    }
    return m;
  }

  /**
   * Copia de la curveArrow con los controles llevados por la transformación
   * de semejanza (traslación+rotación+escala) que mapea la cuerda vieja
   * `old{x1,y1,x2,y2}` a la actual de `el`: conserva el lado de la comba, la
   * forma en S y la intensidad relativa. Cuerda nueva degenerada → controles
   * intactos; cuerda vieja degenerada → controles reseteados al default.
   */
  function transformControlsToChord(el, old) {
    const odx = old.x2 - old.x1, ody = old.y2 - old.y1;
    const ndx = el.x2 - el.x1, ndy = el.y2 - el.y1;
    if (odx === ndx && ody === ndy && old.x1 === el.x1 && old.y1 === el.y1) return el;
    const oldLen2 = odx * odx + ody * ody;
    if (ndx * ndx + ndy * ndy < 1e-6) return el;
    if (oldLen2 < 1e-6) {
      if (el.arc === true) {
        const ctrls = ArcMath.arcCtrls(el.x1, el.y1, el.x2, el.y2, 0.5 * Math.hypot(ndx, ndy));
        if (ctrls) return { ...el, ...ctrls };
      }
      if (el.cx2 !== undefined) {
        return { ...el, ...defaultCubicCtrls(el, 0.25 * Math.hypot(ndx, ndy)) };
      }
      const c = defaultCtrl({ x: el.x1, y: el.y1 }, { x: el.x2, y: el.y2 }, false);
      return { ...el, cx: c.cx, cy: c.cy };
    }
    // r = (ndx + i·ndy) / (odx + i·ody), aplicado como z' = p1' + r·(z − p1)
    const a = (ndx * odx + ndy * ody) / oldLen2;
    const b = (ndy * odx - ndx * ody) / oldLen2;
    const map = (px, py) => ({
      x: el.x1 + a * (px - old.x1) - b * (py - old.y1),
      y: el.y1 + b * (px - old.x1) + a * (py - old.y1),
    });
    const c1 = map(el.cx, el.cy);
    const m = { ...el, cx: c1.x, cy: c1.y };
    if (el.cx2 !== undefined) {
      const c2 = map(el.cx2, el.cy2);
      m.cx2 = c2.x; m.cy2 = c2.y;
    }
    return m;
  }

  /**
   * Copia de la flecha con la dirección invertida: la punta pasa al otro
   * extremo. En cuadrática la curva es idéntica (solo cambia la
   * parametrización); en cúbica se intercambian también los controles.
   */
  function reverseArrow(el) {
    const m = { ...el, x1: el.x2, y1: el.y2, x2: el.x1, y2: el.y1 };
    if (el.cx2 !== undefined) {
      m.cx = el.cx2; m.cy = el.cy2;
      m.cx2 = el.cx; m.cy2 = el.cy;
    }
    // La etiqueta se queda en el mismo punto físico del trazo
    if (el.labelT !== undefined) m.labelT = 1 - el.labelT;
    if (el.startAnchor !== undefined || el.endAnchor !== undefined) {
      m.startAnchor = el.endAnchor;
      m.endAnchor = el.startAnchor;
      if (m.startAnchor === undefined) delete m.startAnchor;
      if (m.endAnchor === undefined) delete m.endAnchor;
    }
    return m;
  }

  /**
   * Controles de la "S canónica" de una curveArrow cúbica: c1 al 25% de la
   * cuerda con offset lateral +s, c2 al 75% con −s (lados opuestos).
   */
  function defaultCubicCtrls(el, sVal) {
    const fr = chordFrame(el); // hoisted; null si la cuerda es degenerada
    const ux = fr ? fr.ux : 0, uy = fr ? fr.uy : 0;
    const dx = el.x2 - el.x1, dy = el.y2 - el.y1;
    return {
      cx:  el.x1 + dx * 0.25 + sVal * ux,
      cy:  el.y1 + dy * 0.25 + sVal * uy,
      cx2: el.x1 + dx * 0.75 - sVal * ux,
      cy2: el.y1 + dy * 0.75 - sVal * uy,
    };
  }

  /**
   * Copia de la curveArrow convertida en semicírculo de 180°: marca `arc` y
   * recomputa los controles cúbicos (ArcMath) con comba = cuerda/2,
   * conservando el lado actual de la curva. Cuerda degenerada → intacta.
   */
  function toArc(el) {
    const L = Math.hypot(el.x2 - el.x1, el.y2 - el.y1);
    const side = Math.sign(ArcMath.arcSagitta(el)) || 1;
    const ctrls = ArcMath.arcCtrls(el.x1, el.y1, el.x2, el.y2, side * L / 2);
    if (!ctrls) return el;
    return { ...el, ...ctrls, arc: true };
  }

  /**
   * Copia de un semicírculo con radio nuevo R: los extremos se reubican
   * sobre la dirección de la cuerda actual a ±R del punto medio (el
   * diámetro cambia, el centro no) y los controles se recomputan con
   * comba = ±R para conservar los 180°. `side` fuerza el lado (±1);
   * sin él se conserva el actual. Cuerda degenerada → intacta.
   */
  function resizeArc(el, R, side) {
    const dx = el.x2 - el.x1, dy = el.y2 - el.y1;
    const len = Math.hypot(dx, dy);
    if (len < 1e-3) return el;
    R = Math.max(ArcMath.MIN_SAGITTA, R);
    const dirX = dx / len, dirY = dy / len;
    const mx = (el.x1 + el.x2) / 2, my = (el.y1 + el.y2) / 2;
    const s = (side || Math.sign(ArcMath.arcSagitta(el)) || 1) * R;
    const x1 = mx - R * dirX, y1 = my - R * dirY;
    const x2 = mx + R * dirX, y2 = my + R * dirY;
    const ctrls = ArcMath.arcCtrls(x1, y1, x2, y2, s);
    if (!ctrls) return el;
    return { ...el, x1, y1, x2, y2, ...ctrls };
  }

  /**
   * Handles editables de una flecha seleccionada (nombre + posición + kind).
   * Los de curvatura ('ctrl') van primero para tener prioridad de click
   * sobre los de extremo ('end') cuando se solapan.
   */
  function arrowHandles(el) {
    const handles = [];
    // Handle de etiqueta primero: máxima prioridad de click (si ganara
    // 'ctrl', en curvas planas eclipsaría la etiqueta centrada; la curvatura
    // sigue ajustable con +/−, F y Shift)
    if ((el.type === 'arrow' || el.type === 'curveArrow') && el.label) {
      const lp = arrowLabelPoint(el);
      handles.push({ name: 'labelPos', x: lp.x, y: lp.y, kind: 'label' });
    }
    if (el.type === 'curveArrow') {
      handles.push({ name: 'ctrl', x: el.cx, y: el.cy, kind: 'ctrl' });
      if (el.cx2 !== undefined) handles.push({ name: 'ctrl2', x: el.cx2, y: el.cy2, kind: 'ctrl' });
    }
    if (el.type === 'arrow' || el.type === 'curveArrow') {
      handles.push({ name: 'p1', x: el.x1, y: el.y1, kind: 'end' });
      handles.push({ name: 'p2', x: el.x2, y: el.y2, kind: 'end' });
    }
    return handles;
  }

  /* ── Conectores anclados ── */

  const ANCHORABLE_TYPES = [
    TOOLS.RECT, TOOLS.ROUNDED_RECT, TOOLS.CIRCLE, TOOLS.BUTTON, TOOLS.INPUT,
    TOOLS.IMAGE_PLACEHOLDER, TOOLS.IMAGE, TOOLS.NAV, TOOLS.CARD,
  ];
  const ANCHOR_THRESHOLD = 12;

  function newId() {
    let id;
    do {
      id = Math.random().toString(36).slice(2, 8);
    } while (state.elements.some(el => el.id === id));
    return id;
  }

  /** Índice del elemento anclable bajo el punto (bbox ± umbral), o -1. */
  function findAnchorTarget(p, excludeIdx) {
    for (let i = state.elements.length - 1; i >= 0; i--) {
      if (i === excludeIdx) continue;
      const el = state.elements[i];
      if (!ANCHORABLE_TYPES.includes(el.type)) continue;
      if (p.x >= el.x - ANCHOR_THRESHOLD && p.x <= el.x + el.w + ANCHOR_THRESHOLD &&
          p.y >= el.y - ANCHOR_THRESHOLD && p.y <= el.y + el.h + ANCHOR_THRESHOLD) {
        return i;
      }
    }
    return -1;
  }

  /**
   * Punto del perímetro del bbox en la dirección centro → from (también
   * cuando `from` cae dentro: se prolonga el rayo hasta el borde).
   */
  function rectEdgePoint(b, from) {
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    const dx = from.x - cx, dy = from.y - cy;
    if (!dx && !dy) return { x: cx, y: b.y };
    const t = Math.min(
      dx ? (b.w / 2) / Math.abs(dx) : Infinity,
      dy ? (b.h / 2) / Math.abs(dy) : Infinity
    );
    return { x: cx + dx * t, y: cy + dy * t };
  }

  /**
   * Materializa las coordenadas de los extremos anclados (estado derivado,
   * SIN saveUndo: los snapshots capturan lo materializado y el redraw
   * posterior a un undo re-resuelve). Si el ancla ya no existe, se quita el
   * anchor conservando las últimas coordenadas ("desanclar congelado").
   * En curveArrow, cuando la cuerda cambia los controles se re-proyectan con
   * transformControlsToChord para que la curva conserve su forma.
   * Reemplaza siempre por copias, nunca muta elementos.
   */
  function resolveAnchors() {
    let byId = null;
    for (let i = 0; i < state.elements.length; i++) {
      const el = state.elements[i];
      if ((el.type !== 'arrow' && el.type !== 'curveArrow') ||
          (!el.startAnchor && !el.endAnchor)) continue;
      if (!byId) {
        byId = new Map();
        state.elements.forEach(t => {
          if (t.id && ANCHORABLE_TYPES.includes(t.type) && !byId.has(t.id)) {
            byId.set(t.id, { x: t.x, y: t.y, w: t.w, h: t.h });
          }
        });
      }
      let m = state.elements[i];
      const old = { x1: m.x1, y1: m.y1, x2: m.x2, y2: m.y2 };
      const apply = (key, xKey, yKey, oxKey, oyKey) => {
        const a = m[key];
        if (!a) return;
        const b = byId.get(a.id);
        if (!b) {
          m = { ...m };
          delete m[key];
          return;
        }
        const pt = rectEdgePoint(b, { x: m[oxKey], y: m[oyKey] });
        if (Math.abs(pt.x - m[xKey]) > 0.5 || Math.abs(pt.y - m[yKey]) > 0.5) {
          m = { ...m, [xKey]: pt.x, [yKey]: pt.y };
        }
      };
      apply('startAnchor', 'x1', 'y1', 'x2', 'y2');
      apply('endAnchor', 'x2', 'y2', 'x1', 'y1');
      if (m !== state.elements[i]) {
        // La cuerda cambió: re-proyectar los controles para conservar la forma
        if (m.type === 'curveArrow') m = transformControlsToChord(m, old);
        state.elements[i] = m;
      }
    }
  }

  /** Ancla el extremo dado de una flecha recién creada si cae sobre un anclable. */
  function attachAnchorOnCreate(el, key, p) {
    const idx = findAnchorTarget(p);
    if (idx < 0) return;
    let target = state.elements[idx];
    if (!target.id) {
      target = { ...target, id: newId() };
      state.elements[idx] = target;
    }
    el[key] = { id: target.id };
  }

  /**
   * Perpendicular unitaria y punto medio de la cuerda de una curveArrow
   * (o null si la cuerda es degenerada). Base de F2: proyección del control
   * sobre la mediatriz y ajuste con +/−.
   */
  function chordFrame(el) {
    const dx = el.x2 - el.x1, dy = el.y2 - el.y1;
    const len = Math.hypot(dx, dy);
    if (!len) return null;
    return {
      ux: -dy / len, uy: dx / len,
      mx: (el.x1 + el.x2) / 2, my: (el.y1 + el.y2) / 2,
    };
  }

  /**
   * Punto del trazo de una flecha en el parámetro t ∈ [0,1]: Bézier cúbica o
   * cuadrática para curveArrow, interpolación lineal para arrow/line.
   */
  function arrowPointAt(el, t) {
    const mt = 1 - t;
    if (el.type === 'curveArrow') {
      if (el.cx2 !== undefined) {
        // Cúbica: B(t) = mt³·p1 + 3·mt²·t·c1 + 3·mt·t²·c2 + t³·p2
        return {
          x: mt * mt * mt * el.x1 + 3 * mt * mt * t * el.cx + 3 * mt * t * t * el.cx2 + t * t * t * el.x2,
          y: mt * mt * mt * el.y1 + 3 * mt * mt * t * el.cy + 3 * mt * t * t * el.cy2 + t * t * t * el.y2,
        };
      }
      // Cuadrática: Q(t) = mt²·p1 + 2·mt·t·c + t²·p2
      return {
        x: mt * mt * el.x1 + 2 * mt * t * el.cx + t * t * el.x2,
        y: mt * mt * el.y1 + 2 * mt * t * el.cy + t * t * el.y2,
      };
    }
    return { x: mt * el.x1 + t * el.x2, y: mt * el.y1 + t * el.y2 };
  }

  /** Punto donde se centra la etiqueta de la flecha (labelT, por defecto 0.5). */
  function arrowLabelPoint(el) {
    return arrowPointAt(el, el.labelT !== undefined ? el.labelT : 0.5);
  }

  /**
   * Parámetro t del punto del trazo más cercano a `p`: muestrea N tramos y
   * proyecta sobre cada segmento (t fraccional → arrastre continuo).
   */
  function nearestTOnArrow(el, p, N = 40) {
    let bestT = 0.5, bestD = Infinity;
    let prev = { x: el.x1, y: el.y1 };
    for (let s = 1; s <= N; s++) {
      const q = arrowPointAt(el, s / N);
      const dx = q.x - prev.x, dy = q.y - prev.y;
      const len2 = dx * dx + dy * dy;
      let u = len2 ? ((p.x - prev.x) * dx + (p.y - prev.y) * dy) / len2 : 0;
      u = Math.max(0, Math.min(1, u));
      const d = Math.hypot(p.x - (prev.x + dx * u), p.y - (prev.y + dy * u));
      if (d < bestD) { bestD = d; bestT = (s - 1 + u) / N; }
      prev = q;
    }
    return bestT;
  }

  /* ── Autosave ── */

  let autosaveTimer = null;

  function scheduleAutosave() {
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => {
      try {
        localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(state.elements));
      } catch (_) { /* almacenamiento lleno o bloqueado: se ignora */ }
    }, 500);
  }

  function restoreAutosave() {
    try {
      const raw = localStorage.getItem(AUTOSAVE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (Array.isArray(saved)) state.elements = saved.filter(Exporter.isValidElement);
    } catch (_) { /* autosave corrupto: se ignora */ }
  }

  /* ── Full redraw (coalescido vía requestAnimationFrame) ── */

  let redrawPending = false;

  function redraw() {
    if (redrawPending) return;
    redrawPending = true;
    requestAnimationFrame(() => {
      redrawPending = false;
      redrawNow();
    });
  }

  function redrawNow() {
    resolveAnchors();
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    if (state.showGrid) Renderer.drawGrid(ctx, CANVAS_W, CANVAS_H);
    state.elements.forEach(el => {
      try {
        Renderer.renderElement(ctx, el);
      } catch (err) {
        console.warn('Elemento no renderizable, se omite:', el, err);
      }
    });
    // Sanea índices que hayan quedado fuera de rango y dibuja la selección
    // (handles de resize solo con un único elemento seleccionado)
    state.selection = state.selection.filter(i => state.elements[i]);
    const single = state.selection.length === 1;
    state.selection.forEach(i => {
      const el = state.elements[i];
      // Las flechas usan handles de extremo/curvatura, no esquinas de escala
      const isArrow = el.type === 'arrow' || el.type === 'curveArrow';
      Renderer.drawSelection(ctx, getElementBounds(el), single && !isArrow);
    });
    // Handles de flecha: curvatura (turquesa, con polilínea de control como
    // guía) y extremos (naranja, arrastrables para mover/anclar)
    if (single) {
      const sel = state.elements[state.selection[0]];
      const handles = arrowHandles(sel);
      if (handles.length) {
        const ctrls = handles.filter(h => h.kind === 'ctrl');
        ctx.save();
        if (ctrls.length) {
          ctx.strokeStyle = '#4ecdc4';
          ctx.lineWidth = 1;
          ctx.setLineDash([3, 3]);
          ctx.beginPath();
          ctx.moveTo(sel.x1, sel.y1);
          ctrls.forEach(h => ctx.lineTo(h.x, h.y));
          ctx.lineTo(sel.x2, sel.y2);
          ctx.stroke();
          ctx.setLineDash([]);
        }
        handles.forEach(h => {
          if (h.kind === 'label') {
            // Etiqueta: cuadrado violeta, distinguible de los círculos
            ctx.fillStyle = '#9b59b6';
            ctx.fillRect(h.x - 4, h.y - 4, 8, 8);
            return;
          }
          ctx.fillStyle = h.kind === 'ctrl' ? '#4ecdc4' : '#f39c12';
          ctx.beginPath();
          ctx.arc(h.x, h.y, 5, 0, Math.PI * 2);
          ctx.fill();
        });
        ctx.restore();
      }
    }
    // Feedback de anclaje: resaltar el candidato bajo el extremo arrastrado
    if (state.resizing && state.resizing.anchorCandidate >= 0) {
      const t = state.elements[state.resizing.anchorCandidate];
      if (t) {
        ctx.save();
        ctx.strokeStyle = '#4ecdc4';
        ctx.lineWidth = 2;
        ctx.strokeRect(t.x - 2, t.y - 2, t.w + 4, t.h + 4);
        ctx.restore();
      }
    }
    $('el-count').textContent = state.elements.length;
    // Único punto que sincroniza la UI dependiente de la selección
    const hasSel = state.selection.length > 0;
    $('btn-delete-sel').hidden = !hasSel;
    $('btn-duplicate-sel').hidden = !hasSel;
    // Semántica dual de los controles del panel: con selección única muestran
    // los valores del elemento; sin selección, los defaults de creación.
    // (Con multi-selección no se tocan: conservan lo último mostrado.)
    if (single) {
      const sel = state.elements[state.selection[0]];
      $('stroke-slider').value = sel.lineWidth;
      $('stroke-val').textContent = String(sel.lineWidth);
      if (sel.type === 'arrow' || sel.type === 'curveArrow') {
        $('check-double-head').checked = sel.heads === 'both';
      }
      if (sel.type === 'line' || sel.type === 'arrow' || sel.type === 'curveArrow') {
        $('check-dash').checked = sel.dash === true;
      }
    } else if (!hasSel) {
      $('stroke-slider').value = state.lineWidth;
      $('stroke-val').textContent = String(state.lineWidth);
      $('check-double-head').checked = state.doubleHead;
      $('check-dash').checked = state.dashed;
    }
    scheduleAutosave();
  }

  /* ── Canvas events ── */

  /* ── Resize con handles (selección única) ── */

  const HANDLE_HIT = 8;

  // Los handles se dibujan en las esquinas del marco de selección (bounds ± 4)
  function handleCorners(b) {
    return {
      nw: { x: b.x - 4,       y: b.y - 4 },
      ne: { x: b.x + b.w + 4, y: b.y - 4 },
      sw: { x: b.x - 4,       y: b.y + b.h + 4 },
      se: { x: b.x + b.w + 4, y: b.y + b.h + 4 },
    };
  }

  function hitHandle(pos, b) {
    const cs = handleCorners(b);
    for (const key of Object.keys(cs)) {
      if (Math.abs(pos.x - cs[key].x) <= HANDLE_HIT && Math.abs(pos.y - cs[key].y) <= HANDLE_HIT) return key;
    }
    return null;
  }

  /**
   * Reubica un elemento del rectángulo `from` al rectángulo `to`.
   * pencil/eraser escalan sus points; line/arrow mueven sus extremos;
   * text escala fontSize con la altura; el resto mapea x/y/w/h.
   */
  function scaleElement(el, from, to) {
    const sx = from.w ? to.w / from.w : 1;
    const sy = from.h ? to.h / from.h : 1;
    const mapX = v => to.x + (v - from.x) * sx;
    const mapY = v => to.y + (v - from.y) * sy;
    const m = { ...el };
    if (m.points) {
      m.points = m.points.map(p => ({ x: mapX(p.x), y: mapY(p.y) }));
    } else if (m.x1 !== undefined) {
      m.x1 = mapX(m.x1); m.y1 = mapY(m.y1);
      m.x2 = mapX(m.x2); m.y2 = mapY(m.y2);
      if (m.cx !== undefined) { m.cx = mapX(m.cx); m.cy = mapY(m.cy); }
      if (m.cx2 !== undefined) { m.cx2 = mapX(m.cx2); m.cy2 = mapY(m.cy2); }
    } else if (m.type === 'text') {
      m.x = to.x; m.y = to.y;
      m.fontSize = Math.max(8, Math.round(m.fontSize * sy));
    } else {
      m.x = to.x; m.y = to.y; m.w = to.w; m.h = to.h;
    }
    return m;
  }

  function resizeTo(pos, e) {
    const r = state.resizing;
    const p = (state.snapGrid && !e.altKey) ? { x: snapVal(pos.x), y: snapVal(pos.y) } : pos;
    // Handles de extremo (p1/p2): mueven ese extremo; durante el arrastre se
    // suelta el anclaje de ese lado (para que siga al puntero) y se registra
    // el candidato bajo el cursor para re-anclar al soltar
    if (r.corner === 'p1' || r.corner === 'p2') {
      let copy = { ...r.original };
      if (r.corner === 'p1') {
        delete copy.startAnchor;
        copy.x1 = p.x;
        copy.y1 = p.y;
      } else {
        delete copy.endAnchor;
        copy.x2 = p.x;
        copy.y2 = p.y;
      }
      if (copy.type === 'curveArrow') copy = transformControlsToChord(copy, r.original);
      state.elements[state.selection[0]] = copy;
      r.anchorCandidate = findAnchorTarget(p, state.selection[0]);
      r.did = true;
      return;
    }

    // Handles de curvatura: mueven solo su punto de control
    if (r.corner === 'ctrl' || r.corner === 'ctrl2') {
      // Semicírculo (siempre 180°): el arrastre de cualquiera de los dos
      // controles cambia el RADIO — distancia del puntero al centro del
      // diámetro — y el lado; los extremos se reubican sobre la dirección
      // de la cuerda, así que se sueltan los anclajes como al arrastrar
      // un extremo
      if (r.original.arc === true) {
        const fr = chordFrame(r.original);
        if (fr) {
          const R = Math.hypot(p.x - fr.mx, p.y - fr.my);
          const side = Math.sign((p.x - fr.mx) * fr.ux + (p.y - fr.my) * fr.uy) || 1;
          const copy = resizeArc(r.original, R, side);
          if (copy !== r.original) {
            delete copy.startAnchor;
            delete copy.endAnchor;
            state.elements[state.selection[0]] = copy;
            r.did = true;
          }
        }
        return;
      }
      let cp = p;
      // Shift: restringe el control a la mediatriz de la cuerda → arcos
      // simétricos, solo cambia la intensidad (puede cruzar al otro lado).
      // Solo tiene sentido en cuadrática (en cúbica no hace nada).
      if (e.shiftKey && r.corner === 'ctrl' && r.original.cx2 === undefined) {
        const fr = chordFrame(r.original);
        if (fr) {
          const sVal = (p.x - fr.mx) * fr.ux + (p.y - fr.my) * fr.uy;
          cp = { x: fr.mx + sVal * fr.ux, y: fr.my + sVal * fr.uy };
        }
      }
      state.elements[state.selection[0]] = r.corner === 'ctrl'
        ? { ...r.original, cx: cp.x, cy: cp.y }
        : { ...r.original, cx2: cp.x, cy2: cp.y };
      r.did = true;
      return;
    }

    // Handle de etiqueta: desliza labelT por el trazo (pos crudo, el snap a
    // rejilla no tiene sentido sobre un parámetro t)
    if (r.corner === 'labelPos') {
      let t = nearestTOnArrow(r.original, pos);
      t = Math.max(0.05, Math.min(0.95, t));
      const copy = { ...r.original };
      if (Math.abs(t - 0.5) < 0.03) delete copy.labelT; // imán al centro → JSON canónico
      else copy.labelT = t;
      state.elements[state.selection[0]] = copy;
      r.did = true;
      return;
    }
    const f = r.from;
    let x1 = f.x, y1 = f.y, x2 = f.x + f.w, y2 = f.y + f.h;
    if (r.corner.includes('w')) x1 = p.x;
    if (r.corner.includes('e')) x2 = p.x;
    if (r.corner.includes('n')) y1 = p.y;
    if (r.corner.includes('s')) y2 = p.y;
    const to = {
      x: Math.min(x1, x2), y: Math.min(y1, y2),
      w: Math.abs(x2 - x1), h: Math.abs(y2 - y1),
    };
    // Tamaño mínimo, salvo en dimensiones que ya eran 0 (líneas rectas)
    if ((f.w > 0 && to.w < 10) || (f.h > 0 && to.h < 10)) return;
    state.elements[state.selection[0]] = scaleElement(r.original, f, to);
    r.did = true;
  }

  function onMouseDown(e) {
    const pos = getPos(e);

    // SELECT tool
    if (state.tool === TOOLS.SELECT) {
      // 1. Handles de resize (antes que el hit-test de elementos)
      if (state.selection.length === 1) {
        const selEl = state.elements[state.selection[0]];
        // Handles de flecha (curvatura; el commit de conectores añade extremos)
        for (const h of arrowHandles(selEl)) {
          if (Math.hypot(pos.x - h.x, pos.y - h.y) <= HANDLE_HIT) {
            state.resizing = { corner: h.name, from: null, original: selEl, snapshot: snapshot(), did: false };
            return;
          }
        }
        const b = getElementBounds(selEl);
        const corner = hitHandle(pos, b);
        if (corner) {
          state.resizing = {
            corner,
            from: b,
            original: selEl,
            snapshot: snapshot(),
            did: false,
          };
          return;
        }
      }

      const idx = hitTest(pos);

      // 2. Shift+click: toggle en la selección
      if (e.shiftKey) {
        if (idx >= 0) {
          setSelection(state.selection.includes(idx)
            ? state.selection.filter(i => i !== idx)
            : [...state.selection, idx]);
          redraw();
        }
        return;
      }

      // 3. Click sobre un elemento: seleccionar (si no lo estaba) e iniciar drag
      if (idx >= 0) {
        if (!state.selection.includes(idx)) setSelection([idx]);
        state.dragLast = pos;
        // Snapshot ANTES de que el drag mute state.elements
        state.dragSnapshot = snapshot();
        state.didDrag = false;
      }
      // 4. Click en vacío: iniciar marquee
      else {
        setSelection([]);
        state.marquee = { x1: pos.x, y1: pos.y, x2: pos.x, y2: pos.y };
      }
      redraw();
      return;
    }

    // TEXT tool
    if (state.tool === TOOLS.TEXT) {
      showTextInput(pos);
      return;
    }

    state.isDrawing = true;
    state.startPos  = pos;
    state.curveFlip = false;

    if (state.tool === TOOLS.PENCIL || state.tool === TOOLS.ERASER) {
      state.currentPath = [pos];
    }
  }

  /* ── Overlay preview (coalescido vía requestAnimationFrame) ── */

  let overlayPending = false;
  let lastPos = null;

  function paintOverlay() {
    octx.clearRect(0, 0, CANVAS_W, CANVAS_H);

    // Marquee de selección
    if (state.marquee) {
      const m = state.marquee;
      const x = Math.min(m.x1, m.x2), y = Math.min(m.y1, m.y2);
      const w = Math.abs(m.x2 - m.x1), h = Math.abs(m.y2 - m.y1);
      octx.fillStyle = 'rgba(78, 205, 196, 0.08)';
      octx.fillRect(x, y, w, h);
      octx.strokeStyle = '#4ecdc4';
      octx.lineWidth = 1;
      octx.setLineDash([5, 5]);
      octx.strokeRect(x, y, w, h);
      octx.setLineDash([]);
      return;
    }

    if (!state.isDrawing || !lastPos) return;
    const pos = lastPos;

    // Freehand preview
    if (state.tool === TOOLS.PENCIL || state.tool === TOOLS.ERASER) {
      if (!state.currentPath.length) return;
      octx.strokeStyle = state.tool === TOOLS.ERASER ? '#ff000040' : state.color;
      octx.lineWidth   = state.tool === TOOLS.ERASER ? state.lineWidth * 4 : state.lineWidth;
      octx.lineCap     = 'round';
      octx.lineJoin    = 'round';
      octx.beginPath();
      octx.moveTo(state.currentPath[0].x, state.currentPath[0].y);
      state.currentPath.forEach(p => octx.lineTo(p.x, p.y));
      octx.stroke();
      return;
    }

    // Shape preview
    if (!state.startPos) return;
    octx.strokeStyle = state.color;
    octx.lineWidth   = state.lineWidth;
    octx.setLineDash([4, 4]);

    const x = Math.min(state.startPos.x, pos.x);
    const y = Math.min(state.startPos.y, pos.y);
    const w = Math.abs(pos.x - state.startPos.x);
    const h = Math.abs(pos.y - state.startPos.y);

    switch (state.tool) {
      case TOOLS.RECT:
        octx.strokeRect(x, y, w, h);
        break;
      case TOOLS.ROUNDED_RECT:
        octx.beginPath(); octx.roundRect(x, y, w, h, 12); octx.stroke();
        break;
      case TOOLS.CIRCLE:
        octx.beginPath(); octx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2); octx.stroke();
        break;
      case TOOLS.LINE:
      case TOOLS.ARROW:
        octx.beginPath(); octx.moveTo(state.startPos.x, state.startPos.y); octx.lineTo(pos.x, pos.y); octx.stroke();
        break;
      case TOOLS.CURVE_ARROW: {
        // Mismo control por defecto que tendrá el elemento al soltarse
        // (Shift durante el trazado comba hacia el otro lado)
        const c = defaultCtrl(state.startPos, pos, state.curveFlip);
        octx.beginPath();
        octx.moveTo(state.startPos.x, state.startPos.y);
        octx.quadraticCurveTo(c.cx, c.cy, pos.x, pos.y);
        octx.stroke();
        break;
      }
      case TOOLS.ARC: {
        // Mismo semicírculo de 180° que tendrá el elemento al soltarse
        // (Shift durante el trazado comba hacia el otro lado)
        const L = Math.hypot(pos.x - state.startPos.x, pos.y - state.startPos.y);
        const arc = ArcMath.arcCtrls(state.startPos.x, state.startPos.y, pos.x, pos.y,
          (state.curveFlip ? -1 : 1) * L / 2);
        octx.beginPath();
        octx.moveTo(state.startPos.x, state.startPos.y);
        if (arc) octx.bezierCurveTo(arc.cx, arc.cy, arc.cx2, arc.cy2, pos.x, pos.y);
        else octx.lineTo(pos.x, pos.y);
        octx.stroke();
        break;
      }
      default:
        octx.strokeRect(x, y, w, h);
    }
    octx.setLineDash([]);
  }

  function scheduleOverlay() {
    if (overlayPending) return;
    overlayPending = true;
    requestAnimationFrame(() => {
      overlayPending = false;
      paintOverlay();
    });
  }

  function onMouseMove(e) {
    const pos = getPos(e);

    // Resize en curso
    if (state.resizing && e.buttons === 1) {
      resizeTo(pos, e);
      redraw();
      return;
    }

    // Marquee en curso
    if (state.marquee && e.buttons === 1) {
      state.marquee.x2 = pos.x;
      state.marquee.y2 = pos.y;
      scheduleOverlay();
      return;
    }

    // Arrastre de la selección (movimiento incremental, vale para N elementos)
    if (state.tool === TOOLS.SELECT && state.selection.length && state.dragLast && e.buttons === 1) {
      const dx = pos.x - state.dragLast.x;
      const dy = pos.y - state.dragLast.y;
      if (dx || dy) {
        state.selection.forEach(i => {
          state.elements[i] = moveElement(state.elements[i], dx, dy);
        });
        state.dragLast = pos;
        state.didDrag = true;
        redraw();
      }
      return;
    }

    if (!state.isDrawing) return;
    lastPos = pos;
    // Shift mientras se traza la flecha curva: curva hacia el otro lado
    if (state.tool === TOOLS.CURVE_ARROW || state.tool === TOOLS.ARC) state.curveFlip = e.shiftKey;
    // Los puntos se acumulan en cada evento (no se pierde trazo) descartando
    // los que están a <2px del anterior (decimación: reduce el path 3-5x);
    // el pintado se coalesce a un frame por refresco
    if (state.tool === TOOLS.PENCIL || state.tool === TOOLS.ERASER) {
      const last = state.currentPath[state.currentPath.length - 1];
      if (!last || Math.hypot(pos.x - last.x, pos.y - last.y) >= 2) {
        state.currentPath.push(pos);
      }
    }
    scheduleOverlay();
  }

  function onMouseUp(e) {
    // Fin de resize: el snapshot se capturó al agarrar el handle
    if (state.resizing) {
      const r = state.resizing;
      if (r.did) {
        pushUndo(r.snapshot);
        // Soltar un extremo sobre un anclable lo ancla (asignando id si falta)
        if ((r.corner === 'p1' || r.corner === 'p2') && r.anchorCandidate >= 0) {
          let target = state.elements[r.anchorCandidate];
          if (!target.id) {
            target = { ...target, id: newId() };
            state.elements[r.anchorCandidate] = target;
          }
          const key = r.corner === 'p1' ? 'startAnchor' : 'endAnchor';
          const selIdx = state.selection[0];
          state.elements[selIdx] = { ...state.elements[selIdx], [key]: { id: target.id } };
        }
      }
      state.resizing = null;
      redraw();
      return;
    }

    // Fin de marquee: seleccionar los elementos que intersecan el rectángulo
    if (state.marquee) {
      const m = state.marquee;
      state.marquee = null;
      octx.clearRect(0, 0, CANVAS_W, CANVAS_H);
      const rx = Math.min(m.x1, m.x2), ry = Math.min(m.y1, m.y2);
      const rw = Math.abs(m.x2 - m.x1), rh = Math.abs(m.y2 - m.y1);
      if (rw > 3 || rh > 3) {
        const sel = [];
        state.elements.forEach((el, i) => {
          if (el.type === 'eraser') return;
          const b = getElementBounds(el);
          if (b.x < rx + rw && b.x + b.w > rx && b.y < ry + rh && b.y + b.h > ry) sel.push(i);
        });
        setSelection(sel);
      }
      redraw();
      return;
    }

    // Fin de arrastre de selección: el snapshot se capturó en onMouseDown,
    // antes de que onMouseMove mutara state.elements
    if (state.tool === TOOLS.SELECT && state.selection.length && state.dragLast) {
      if (state.didDrag && state.dragSnapshot) {
        pushUndo(state.dragSnapshot);
        // Snap al soltar: se alinea el primer elemento y el resto conserva
        // sus distancias relativas
        if (state.snapGrid && !e.altKey) {
          const b = getElementBounds(state.elements[state.selection[0]]);
          const dx = snapVal(b.x) - b.x;
          const dy = snapVal(b.y) - b.y;
          if (dx || dy) {
            state.selection.forEach(i => {
              state.elements[i] = moveElement(state.elements[i], dx, dy);
            });
          }
        }
      }
      state.dragLast = null;
      state.dragSnapshot = null;
      state.didDrag = false;
      redraw();
      return;
    }

    if (!state.isDrawing) return;
    const pos = getPos(e);
    octx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    state.isDrawing = false;
    lastPos = null;

    // Freehand commit
    if (state.tool === TOOLS.PENCIL || state.tool === TOOLS.ERASER) {
      state.currentPath.push(pos);
      saveUndo();
      state.elements.push({
        type: state.tool,
        points: state.currentPath,
        color: state.color,
        lineWidth: state.lineWidth,
        seed: newSeed(),
      });
      state.currentPath = [];
      redraw();
      return;
    }

    if (!state.startPos) return;
    // Snap a la cuadrícula al crear (Alt lo desactiva; no aplica a lápiz/borrador)
    const doSnap = state.snapGrid && !e.altKey;
    const p1 = doSnap ? { x: snapVal(state.startPos.x), y: snapVal(state.startPos.y) } : state.startPos;
    const p2 = doSnap ? { x: snapVal(pos.x), y: snapVal(pos.y) } : pos;
    const x = Math.min(p1.x, p2.x);
    const y = Math.min(p1.y, p2.y);
    const w = Math.abs(p2.x - p1.x);
    const h = Math.abs(p2.y - p1.y);

    // Line / Arrow / Curve / Arc (descarta clicks sin arrastre: longitud ~0)
    if ([TOOLS.LINE, TOOLS.ARROW, TOOLS.CURVE_ARROW, TOOLS.ARC].includes(state.tool)) {
      if (Math.hypot(p2.x - p1.x, p2.y - p1.y) >= 4) {
        saveUndo();
        const el = {
          // La herramienta arco no es un tipo de elemento: crea curveArrow
          type: state.tool === TOOLS.ARC ? TOOLS.CURVE_ARROW : state.tool,
          x1: p1.x, y1: p1.y,
          x2: p2.x, y2: p2.y,
          color: state.color, lineWidth: state.lineWidth,
          seed: newSeed(),
        };
        if (state.tool === TOOLS.CURVE_ARROW) {
          // Curvatura por defecto: control perpendicular al 25% de la longitud
          // (Shift al trazar: al otro lado); se ajusta después con su handle
          const c = defaultCtrl(p1, p2, state.curveFlip);
          el.cx = c.cx;
          el.cy = c.cy;
        }
        if (state.tool === TOOLS.ARC) {
          // Semicírculo de 180°: el arrastre es el diámetro (radio = mitad
          // de la longitud arrastrada; Shift: comba hacia el otro lado).
          // Sin puntas de flecha: es un trazo, no un conector.
          const L = Math.hypot(p2.x - p1.x, p2.y - p1.y);
          const arc = ArcMath.arcCtrls(p1.x, p1.y, p2.x, p2.y,
            (state.curveFlip ? -1 : 1) * L / 2);
          Object.assign(el, arc);
          el.arc = true;
          el.heads = 'none';
        }
        if ((state.tool === TOOLS.ARROW || state.tool === TOOLS.CURVE_ARROW) && state.doubleHead) {
          el.heads = 'both';
        }
        if (state.dashed) el.dash = true;
        state.elements.push(el);
        // Extremos sobre un elemento anclable: la flecha nace conectada
        if (state.tool !== TOOLS.LINE) {
          attachAnchorOnCreate(el, 'startAnchor', p1);
          attachAnchorOnCreate(el, 'endAnchor', p2);
        }
      }
    }
    // Geometric shapes
    else if ([TOOLS.RECT, TOOLS.ROUNDED_RECT, TOOLS.CIRCLE].includes(state.tool)) {
      if (w > 3 && h > 3) {
        saveUndo();
        state.elements.push({
          type: state.tool,
          x, y, w, h,
          color: state.color, lineWidth: state.lineWidth,
          fill: state.fillShapes,
          seed: newSeed(),
        });
      }
    }
    // UI components
    else if (UI_DEFAULTS[state.tool]) {
      const defs = UI_DEFAULTS[state.tool];
      saveUndo();
      state.elements.push({
        type: state.tool,
        x, y,
        w: w > 20 ? w : defs.w,
        h: h > 20 ? h : defs.h,
        color: state.color, lineWidth: state.lineWidth,
        seed: newSeed(),
      });
    }

    state.startPos = null;
    redraw();
  }

  /* ── Text input ── */

  function showTextInput(pos, initial = '', fontSize = state.fontSize) {
    // El textarea vive dentro del wrapper ya escalado por CSS transform:
    // se posiciona en coordenadas sin escalar
    textInput.hidden  = false;
    textInput.style.left     = pos.x + 'px';
    textInput.style.top      = pos.y + 'px';
    textInput.style.fontSize = fontSize + 'px';
    textInput.value  = initial;
    textInput.focus();
    textInput.select();
  }

  function commitText() {
    if (textInput.hidden) return;
    const val = textInput.value.trim();
    textInput.hidden = true;

    // Edición de un elemento existente (texto o etiqueta de componente)
    const editing = state.editingIdx;
    state.editingIdx = null;
    if (editing !== null) {
      const el = state.elements[editing];
      if (!el) return;
      saveUndo();
      if (el.type === 'text') {
        if (!val) {
          // Texto vaciado = borrado
          state.elements.splice(editing, 1);
          setSelection([]);
        } else {
          state.elements[editing] = { ...el, value: val };
        }
      } else {
        const copy = { ...el };
        if (val) copy.label = val;
        else delete copy.label; // vacío: vuelve a la etiqueta por defecto
        state.elements[editing] = copy;
      }
      redraw();
      return;
    }

    if (!val) return;
    saveUndo();

    const posX = parseFloat(textInput.style.left);
    const posY = parseFloat(textInput.style.top);

    state.elements.push({
      type: 'text',
      x: posX, y: posY,
      value: val,
      color: state.color,
      fontSize: state.fontSize,
      lineWidth: state.lineWidth,
    });
    redraw();
  }

  textInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitText(); }
    if (e.key === 'Escape') { textInput.hidden = true; state.editingIdx = null; }
  });
  textInput.addEventListener('blur', commitText);

  /* ── Edición con doble click (herramienta Mover) ── */

  const LABELED_TYPES = [TOOLS.BUTTON, TOOLS.INPUT, TOOLS.NAV, TOOLS.CARD];

  mainCanvas.addEventListener('dblclick', e => {
    if (state.tool !== TOOLS.SELECT) return;
    const pos = getPos(e);
    // Doble click sobre un handle de curvatura: resetear la curvatura
    // (cuadrática → control por defecto; cúbica → S canónica)
    if (state.selection.length === 1) {
      const sel = state.elements[state.selection[0]];
      // Doble click sobre el handle de etiqueta desplazada: re-centrarla.
      // Con labelT ausente no se intercepta (el flujo cae al editor de texto)
      if (sel && sel.labelT !== undefined &&
          (sel.type === 'arrow' || sel.type === 'curveArrow')) {
        const lp = arrowLabelPoint(sel);
        if (Math.hypot(pos.x - lp.x, pos.y - lp.y) <= HANDLE_HIT) {
          saveUndo();
          const copy = { ...sel };
          delete copy.labelT;
          state.elements[state.selection[0]] = copy;
          redraw();
          return;
        }
      }
      if (sel && arrowHandles(sel).some(h => h.kind === 'ctrl' && Math.hypot(pos.x - h.x, pos.y - h.y) <= HANDLE_HIT)) {
        saveUndo();
        if (sel.arc === true) {
          // Semicírculo: re-normalizar a 180° exactos, lado actual
          state.elements[state.selection[0]] = toArc(sel);
        } else if (sel.cx2 !== undefined) {
          const len = Math.hypot(sel.x2 - sel.x1, sel.y2 - sel.y1);
          state.elements[state.selection[0]] = { ...sel, ...defaultCubicCtrls(sel, 0.25 * len) };
        } else {
          const c = defaultCtrl({ x: sel.x1, y: sel.y1 }, { x: sel.x2, y: sel.y2 }, false);
          state.elements[state.selection[0]] = { ...sel, cx: c.cx, cy: c.cy };
        }
        redraw();
        return;
      }
    }
    const idx = hitTest(pos);
    if (idx < 0) return;
    const el = state.elements[idx];
    if (el.type === 'text') {
      state.editingIdx = idx;
      showTextInput({ x: el.x, y: el.y }, el.value, el.fontSize);
    } else if (el.type === 'arrow' || el.type === 'curveArrow') {
      // Etiqueta de la flecha: el editor se abre en su posición actual
      const mid = arrowLabelPoint(el);
      state.editingIdx = idx;
      showTextInput({ x: mid.x - 40, y: mid.y - 10 }, el.label || '', 13);
    } else if (LABELED_TYPES.includes(el.type)) {
      state.editingIdx = idx;
      showTextInput({ x: el.x, y: el.y }, el.label || '', 14);
    }
  });

  /* ── Insertar imágenes: pegar (Ctrl/Cmd+V) o arrastrar desde el disco ── */

  const IMAGE_MIME = /^image\/(png|jpeg)$/;

  /**
   * Inserta una imagen desde un data-URL. Sin `at` se centra en el canvas;
   * con `at` (coords de canvas) se centra en ese punto, sin salirse.
   */
  function addImage(src, at) {
    const img = new Image();
    img.onload = () => {
      // Escalar para que quepa holgada en el canvas, conservando proporción
      const scale = Math.min(1, (CANVAS_W * 0.8) / img.naturalWidth, (CANVAS_H * 0.8) / img.naturalHeight);
      const w = Math.max(1, Math.round(img.naturalWidth * scale));
      const h = Math.max(1, Math.round(img.naturalHeight * scale));
      const cx = at ? at.x : CANVAS_W / 2;
      const cy = at ? at.y : CANVAS_H / 2;
      const x = Math.round(Math.max(0, Math.min(CANVAS_W - w, cx - w / 2)));
      const y = Math.round(Math.max(0, Math.min(CANVAS_H - h, cy - h / 2)));
      saveUndo();
      state.elements.push({
        type: TOOLS.IMAGE,
        x, y, w, h, src,
        color: state.color, lineWidth: state.lineWidth,
        seed: newSeed(),
      });
      // Queda seleccionada con Mover para arrastrarla/redimensionarla al momento
      selectTool(TOOLS.SELECT);
      setSelection([state.elements.length - 1]);
      redraw();
    };
    img.onerror = () => alert('No se pudo cargar la imagen');
    img.src = src;
  }

  function addImageFile(file, at) {
    if (!file || !IMAGE_MIME.test(file.type)) return;
    const reader = new FileReader();
    reader.onload = () => addImage(reader.result, at);
    reader.readAsDataURL(file);
  }

  document.addEventListener('paste', e => {
    // No interceptar el pegado dentro de campos de texto
    const tag = e.target.tagName;
    if (e.target === textInput || tag === 'INPUT' || tag === 'TEXTAREA') return;
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    for (const item of items) {
      if (IMAGE_MIME.test(item.type)) {
        e.preventDefault();
        addImageFile(item.getAsFile());
        return;
      }
    }
  });

  // Drag & drop de archivos desde el escritorio al lienzo
  let dragDepth = 0;

  function setDropHighlight(on) {
    wrapper.classList.toggle('canvas-area__wrapper--dropping', on);
  }

  mainCanvas.addEventListener('dragover', e => {
    // preventDefault es lo que habilita el drop
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  mainCanvas.addEventListener('dragenter', e => {
    e.preventDefault();
    dragDepth++;
    setDropHighlight(true);
  });
  mainCanvas.addEventListener('dragleave', () => {
    if (--dragDepth <= 0) { dragDepth = 0; setDropHighlight(false); }
  });
  mainCanvas.addEventListener('drop', e => {
    e.preventDefault();
    dragDepth = 0;
    setDropHighlight(false);
    const pos = getPos(e);
    const files = [...(e.dataTransfer.files || [])].filter(f => IMAGE_MIME.test(f.type));
    if (!files.length) return;
    // Varias imágenes: en cascada desde el punto de suelta
    files.forEach((f, i) => addImageFile(f, { x: pos.x + i * 24, y: pos.y + i * 24 }));
  });

  /* ── Canvas cursor ── */

  function updateCursor() {
    mainCanvas.classList.toggle('canvas-area__canvas--move', state.tool === TOOLS.SELECT);
  }

  /* ── Acciones sobre la selección ── */

  function selectTool(id) {
    state.tool = id;
    setSelection([]);
    updateToolbarActive();
    updateCursor();
    redraw();
  }

  function deleteSelection() {
    if (!state.selection.length) return;
    saveUndo();
    // De mayor a menor índice para que los splice no se desplacen entre sí
    [...state.selection].sort((a, b) => b - a).forEach(i => state.elements.splice(i, 1));
    setSelection([]);
    redraw();
  }

  function duplicateSelection() {
    if (!state.selection.length) return;
    saveUndo();
    const start = state.elements.length;
    // Los clones de anclables reciben id nuevo; se mapea para re-vincular
    const idMap = new Map();
    state.selection.forEach(i => {
      const src = state.elements[i];
      const copy = moveElement(src, 15, 15);
      copy.seed = newSeed();
      if (src.id) {
        copy.id = newId();
        idMap.set(src.id, copy.id);
      }
      state.elements.push(copy);
    });
    // Flechas clonadas: si su ancla también se clonó, apuntan al clon;
    // si no, conservan el anchor al original
    for (let i = start; i < state.elements.length; i++) {
      const el = state.elements[i];
      if (el.startAnchor || el.endAnchor) {
        const copy = { ...el };
        if (copy.startAnchor && idMap.has(copy.startAnchor.id)) copy.startAnchor = { id: idMap.get(copy.startAnchor.id) };
        if (copy.endAnchor && idMap.has(copy.endAnchor.id)) copy.endAnchor = { id: idMap.get(copy.endAnchor.id) };
        state.elements[i] = copy;
      }
    }
    // Los clones quedan seleccionados
    setSelection(Array.from({ length: state.elements.length - start }, (_, k) => start + k));
    redraw();
  }

  /* ── Build sidebar ── */

  function buildSidebar() {
    const sidebar = $('sidebar');
    sidebar.innerHTML = '';
    TOOL_GROUPS.forEach(group => {
      const div = document.createElement('div');
      div.className = 'sidebar__group';

      const label = document.createElement('span');
      label.className = 'sidebar__group-label';
      label.textContent = group.label;
      div.appendChild(label);

      group.tools.forEach(t => {
        const btn = document.createElement('button');
        btn.className = 'sidebar__tool';
        btn.dataset.tool = t.id;
        btn.title = t.key ? `${t.name} (${t.key.toUpperCase()})` : t.name;
        btn.innerHTML = `<span>${t.icon}</span><span class="sidebar__tool-name">${t.name}</span>`;
        btn.addEventListener('click', () => selectTool(t.id));
        div.appendChild(btn);
      });
      sidebar.appendChild(div);
    });
    updateToolbarActive();
  }

  function updateToolbarActive() {
    document.querySelectorAll('.sidebar__tool').forEach(btn => {
      const active = btn.dataset.tool === state.tool;
      btn.classList.toggle('sidebar__tool--active', active);
      btn.setAttribute('aria-pressed', String(active));
    });
  }

  /* ── Build color grid ── */

  function buildColors() {
    const grid = $('color-grid');
    grid.innerHTML = '';
    COLORS.forEach(c => {
      // <button> real: accesible por teclado y anunciable con aria-pressed
      const swatch = document.createElement('button');
      swatch.type = 'button';
      swatch.className = 'panel__color-swatch';
      swatch.style.background = c;
      swatch.dataset.color = c;
      swatch.setAttribute('aria-label', `Color ${c}`);
      swatch.addEventListener('click', () => setColor(c));
      grid.appendChild(swatch);
    });
    updateColorActive();
  }

  function setColor(c) {
    state.color = c;
    $('color-picker').value = c;
    $('color-hex').textContent = c;
    updateColorActive();
  }

  function updateColorActive() {
    document.querySelectorAll('.panel__color-swatch').forEach(s => {
      const active = s.dataset.color === state.color;
      s.classList.toggle('panel__color-swatch--active', active);
      s.setAttribute('aria-pressed', String(active));
    });
  }

  /* ── Panel controls wiring ── */

  function wireControls() {
    // Color picker
    $('color-picker').addEventListener('input', e => setColor(e.target.value));

    // Stroke slider — semántica dual: con selección edita el grosor de los
    // elementos seleccionados en vivo; sin selección fija el default de
    // creación. Todo el deslizamiento cuenta como UN paso de undo: el
    // snapshot se captura al primer 'input' del gesto y se apila en 'change'.
    let strokeGestureSnap = null;
    $('stroke-slider').addEventListener('input', e => {
      const v = +e.target.value;
      $('stroke-val').textContent = e.target.value;
      if (state.selection.length) {
        if (!strokeGestureSnap) strokeGestureSnap = snapshot();
        state.selection.forEach(i => {
          state.elements[i] = { ...state.elements[i], lineWidth: v };
        });
        redraw();
      } else {
        state.lineWidth = v;
      }
    });
    // El cierre del gesto no puede depender solo de 'change': un <input
    // type=range> NO dispara 'change' si el valor comprometido coincide con
    // el previo al gesto (p. ej. arrastrar 2→5→2), lo que dejaría un
    // snapshot huérfano que corrompería el siguiente gesto. Por eso se
    // cierra también en pointerup/pointercancel, y si el gesto terminó
    // donde empezó se restauran las referencias originales sin apilar undo.
    function commitStrokeGesture() {
      if (!strokeGestureSnap) return;
      const snap = strokeGestureSnap;
      strokeGestureSnap = null;
      const unchanged = snap.length === state.elements.length &&
        snap.every((el, i) => el === state.elements[i] ||
          el.lineWidth === state.elements[i].lineWidth);
      if (unchanged) {
        // Gesto no-op: recupera los objetos originales (solo cambió la
        // identidad de los seleccionados, no sus valores).
        state.elements = snap;
      } else {
        pushUndo(snap);
      }
    }
    $('stroke-slider').addEventListener('change', commitStrokeGesture);
    $('stroke-slider').addEventListener('pointerup', commitStrokeGesture);
    $('stroke-slider').addEventListener('pointercancel', commitStrokeGesture);

    // Font slider
    $('font-slider').addEventListener('input', e => {
      state.fontSize = +e.target.value;
      $('font-val').textContent = e.target.value;
    });

    // Zoom slider
    $('zoom-slider').addEventListener('input', e => {
      state.zoom = +e.target.value / 100;
      $('zoom-val').textContent = e.target.value;
      wrapper.style.transform = `scale(${state.zoom})`;
    });

    // Checkboxes
    $('check-fill').addEventListener('change', e => { state.fillShapes = e.target.checked; });
    // Doble punta — semántica dual: con selección aplica/quita heads:'both'
    // a las flechas seleccionadas (los no-flecha se ignoran); sin selección
    // fija el default para las nuevas flechas.
    $('check-double-head').addEventListener('change', e => {
      const on = e.target.checked;
      if (state.selection.length) {
        const arrows = state.selection.filter(i => {
          const el = state.elements[i];
          // Los semicírculos (heads:'none') nunca llevan punta
          return (el.type === 'arrow' || el.type === 'curveArrow') && el.heads !== 'none';
        });
        if (!arrows.length) return;
        saveUndo();
        arrows.forEach(i => {
          const copy = { ...state.elements[i] };
          if (on) copy.heads = 'both';
          else delete copy.heads;
          state.elements[i] = copy;
        });
        redraw();
      } else {
        state.doubleHead = on;
      }
    });
    // Trazo discontinuo: misma semántica dual que la doble punta, sobre
    // line/arrow/curveArrow
    $('check-dash').addEventListener('change', e => {
      const on = e.target.checked;
      if (state.selection.length) {
        const strokes = state.selection.filter(i => {
          const t = state.elements[i].type;
          return t === 'line' || t === 'arrow' || t === 'curveArrow';
        });
        if (!strokes.length) return;
        saveUndo();
        strokes.forEach(i => {
          const copy = { ...state.elements[i] };
          if (on) copy.dash = true;
          else delete copy.dash;
          state.elements[i] = copy;
        });
        redraw();
      } else {
        state.dashed = on;
      }
    });
    $('check-grid').addEventListener('change', e => { state.showGrid = e.target.checked; redraw(); });
    $('check-snap').addEventListener('change', e => { state.snapGrid = e.target.checked; });

    // Undo / Redo
    $('btn-undo').addEventListener('click', undo);
    $('btn-redo').addEventListener('click', redo);

    // Clear
    $('btn-clear').addEventListener('click', () => {
      saveUndo();
      state.elements = [];
      setSelection([]);
      try { localStorage.removeItem(AUTOSAVE_KEY); } catch (_) {}
      redraw();
    });

    // Selection actions
    $('btn-delete-sel').addEventListener('click', deleteSelection);
    $('btn-duplicate-sel').addEventListener('click', duplicateSelection);

    // Import
    $('btn-import').addEventListener('click', async () => {
      const els = await Exporter.importJSON();
      if (els) {
        saveUndo();
        state.elements = withSeeds(els);
        redraw();
      }
    });
  }

  /* ── Undo / Redo ── */

  function undo() {
    if (!state.undoStack.length) return;
    state.redoStack.push(snapshot());
    state.elements = state.undoStack.pop();
    setSelection([]);
    redraw();
  }

  function redo() {
    if (!state.redoStack.length) return;
    state.undoStack.push(snapshot());
    state.elements = state.redoStack.pop();
    setSelection([]);
    redraw();
  }

  /* ── Keyboard shortcuts ── */

  const TOOL_KEYS = {};
  TOOL_GROUPS.forEach(g => g.tools.forEach(t => { if (t.key) TOOL_KEYS[t.key] = t.id; }));

  const NUDGE = {
    ArrowLeft:  [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp:    [0, -1],
    ArrowDown:  [0, 1],
  };

  document.addEventListener('keydown', e => {
    // No capturar mientras se escribe en cualquier control
    const tag = e.target.tagName;
    if (e.target === textInput || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    const k = e.key.toLowerCase();

    // Undo / Redo (Cmd+Shift+Z es el redo estándar en macOS)
    if ((e.ctrlKey || e.metaKey) && k === 'z') {
      e.preventDefault();
      if (e.shiftKey) redo(); else undo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); redo(); return; }
    if ((e.ctrlKey || e.metaKey) && k === 'd') { e.preventDefault(); duplicateSelection(); return; }

    if ((e.key === 'Delete' || e.key === 'Backspace') && state.selection.length) {
      e.preventDefault();
      deleteSelection();
      return;
    }

    if (e.key === 'Escape' && state.selection.length) {
      setSelection([]);
      redraw();
      return;
    }

    // Ctrl/Cmd+A: seleccionar todo (con la herramienta Mover)
    if ((e.ctrlKey || e.metaKey) && k === 'a') {
      e.preventDefault();
      selectTool(TOOLS.SELECT);
      setSelection(state.elements.map((el, i) => el.type === 'eraser' ? -1 : i).filter(i => i >= 0));
      redraw();
      return;
    }

    // Nudge de la selección con flechas (Shift: paso de cuadrícula)
    if (NUDGE[e.key] && state.selection.length) {
      e.preventDefault();
      const f = e.shiftKey ? GRID_STEP : 1;
      saveUndo();
      state.selection.forEach(i => {
        state.elements[i] = moveElement(state.elements[i], NUDGE[e.key][0] * f, NUDGE[e.key][1] * f);
      });
      redraw();
      return;
    }

    // F: invertir el lado del giro de las flechas curvas seleccionadas
    if (k === 'f' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey &&
        state.selection.some(i => state.elements[i].type === 'curveArrow')) {
      saveUndo();
      state.selection.forEach(i => {
        if (state.elements[i].type === 'curveArrow') {
          state.elements[i] = flipCurve(state.elements[i]);
        }
      });
      redraw();
      return;
    }

    // Q: alternar semicírculo en las flechas curvas seleccionadas
    // (activar = snap a 180° conservando el lado, sin puntas; desactivar
    // deja la cúbica tal cual, quitando la marca y recuperando la punta)
    if (k === 'q' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey &&
        state.selection.some(i => state.elements[i].type === 'curveArrow')) {
      saveUndo();
      state.selection.forEach(i => {
        const el = state.elements[i];
        if (el.type !== 'curveArrow') return;
        if (el.arc === true) {
          const copy = { ...el };
          delete copy.arc;
          if (copy.heads === 'none') delete copy.heads;
          state.elements[i] = copy;
        } else {
          state.elements[i] = { ...toArc(el), heads: 'none' };
        }
      });
      redraw();
      return;
    }

    // D: invertir la dirección de las flechas seleccionadas (la punta pasa
    // al otro extremo; en curvas la forma no cambia)
    if (k === 'd' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey &&
        state.selection.some(i => ['arrow', 'curveArrow'].includes(state.elements[i].type))) {
      saveUndo();
      state.selection.forEach(i => {
        if (['arrow', 'curveArrow'].includes(state.elements[i].type)) {
          state.elements[i] = reverseArrow(state.elements[i]);
        }
      });
      redraw();
      return;
    }

    // S: alternar la flecha curva seleccionada entre curva simple (cuadrática)
    // y curva en S (cúbica con dos controles)
    if (k === 's' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey &&
        state.selection.length === 1 &&
        state.elements[state.selection[0]].type === 'curveArrow') {
      const el = state.elements[state.selection[0]];
      saveUndo();
      if (el.cx2 !== undefined) {
        // Cúbica → cuadrática: quitar el segundo control y resetear el primero
        // (la marca de arco no puede sobrevivir en una cuadrática)
        const copy = { ...el };
        delete copy.cx2;
        delete copy.cy2;
        delete copy.arc;
        const c = defaultCtrl({ x: el.x1, y: el.y1 }, { x: el.x2, y: el.y2 }, false);
        copy.cx = c.cx;
        copy.cy = c.cy;
        state.elements[state.selection[0]] = copy;
      } else {
        // Cuadrática → S canónica conservando la intensidad lateral actual
        const fr = chordFrame(el);
        const len = Math.hypot(el.x2 - el.x1, el.y2 - el.y1);
        let sVal = 0.25 * len;
        if (fr) {
          const cur = (el.cx - fr.mx) * fr.ux + (el.cy - fr.my) * fr.uy;
          if (Math.abs(cur) > 1) sVal = cur;
        }
        state.elements[state.selection[0]] = { ...el, ...defaultCubicCtrls(el, sVal) };
      }
      redraw();
      return;
    }

    // +/−: ajustar la intensidad de curvatura de la flecha curva seleccionada
    // ('+' aleja cada control del eje en su lado actual, '−' lo acerca y puede
    // cruzar; Shift: paso fino de 1px). Conserva la componente lateral y,
    // en cúbica, la forma en S (cada control según su propio signo).
    if ((e.key === '+' || e.key === '=' || e.key === '-') &&
        !e.ctrlKey && !e.metaKey && !e.altKey && state.selection.length === 1) {
      const el = state.elements[state.selection[0]];
      if (el.type === 'curveArrow') {
        // Semicírculo (siempre 180°): +/− ajustan el RADIO con pasos de
        // 5px/1px; el centro del diámetro no se mueve. En arcos anclados
        // el redraw re-materializa los extremos (el ajuste no persiste).
        if (el.arc === true) {
          const mag = (e.shiftKey ? 1 : 5) * (e.key === '-' ? -1 : 1);
          const R = Math.hypot(el.x2 - el.x1, el.y2 - el.y1) / 2 + mag;
          const copy = resizeArc(el, R);
          if (copy !== el) {
            e.preventDefault();
            saveUndo();
            state.elements[state.selection[0]] = copy;
            redraw();
          }
          return;
        }
        const fr = chordFrame(el);
        if (fr) {
          e.preventDefault();
          const mag = (e.shiftKey ? 1 : 5) * (e.key === '-' ? -1 : 1);
          const shifted = (cx, cy) => {
            const sVal = (cx - fr.mx) * fr.ux + (cy - fr.my) * fr.uy;
            const d = mag * (Math.sign(sVal) || 1);
            return { x: cx + d * fr.ux, y: cy + d * fr.uy };
          };
          saveUndo();
          const c1 = shifted(el.cx, el.cy);
          const copy = { ...el, cx: c1.x, cy: c1.y };
          if (el.cx2 !== undefined) {
            const c2 = shifted(el.cx2, el.cy2);
            copy.cx2 = c2.x;
            copy.cy2 = c2.y;
          }
          state.elements[state.selection[0]] = copy;
          redraw();
        }
        return;
      }
    }

    // Selección de herramienta por tecla
    if (!e.ctrlKey && !e.metaKey && !e.altKey && TOOL_KEYS[k]) {
      selectTool(TOOL_KEYS[k]);
    }
  });

  /* ── Modals ── */

  function setupModals() {
    // <dialog> nativo: showModal() da foco, trampa de Tab y Escape gratis;
    // un click cuyo target es el propio dialog cae en el backdrop
    const exportModal = $('modal-export');
    $('btn-export').addEventListener('click', () => exportModal.showModal());
    exportModal.querySelector('.modal__cancel').addEventListener('click', () => exportModal.close());
    exportModal.addEventListener('click', e => { if (e.target === exportModal) exportModal.close(); });
    exportModal.querySelectorAll('[data-export]').forEach(btn => {
      btn.addEventListener('click', () => {
        Exporter[btn.dataset.export](state.elements);
        exportModal.close();
      });
    });

    const tplModal = $('modal-templates');
    $('btn-templates').addEventListener('click', () => tplModal.showModal());
    tplModal.querySelector('.modal__cancel').addEventListener('click', () => tplModal.close());
    tplModal.addEventListener('click', e => { if (e.target === tplModal) tplModal.close(); });
    tplModal.querySelectorAll('[data-template]').forEach(btn => {
      btn.addEventListener('click', () => {
        saveUndo();
        state.elements = withSeeds(Templates.get(btn.dataset.template));
        setSelection([]);
        tplModal.close();
        redraw();
      });
    });
  }

  /* ── Canvas event binding ── */

  // Pointer events con captura: funciona con ratón, táctil y stylus, y el
  // trazo/drag sigue recibiendo eventos aunque el puntero salga del canvas
  mainCanvas.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    mainCanvas.setPointerCapture(e.pointerId);
    onMouseDown(e);
  });
  mainCanvas.addEventListener('pointermove', onMouseMove);
  mainCanvas.addEventListener('pointerup', e => {
    if (mainCanvas.hasPointerCapture(e.pointerId)) mainCanvas.releasePointerCapture(e.pointerId);
    onMouseUp(e);
  });
  mainCanvas.addEventListener('pointercancel', e => {
    if (state.isDrawing || state.didDrag) onMouseUp(e);
  });

  /* ── Init ── */

  function init() {
    // Repintar cuando cargue una imagen (autosave/import restauran data-URLs)
    Renderer.setImageLoadCallback(redraw);
    restoreAutosave();
    buildSidebar();
    buildColors();
    wireControls();
    setupModals();
    updateCursor();
    redraw();
  }

  init();

})();
