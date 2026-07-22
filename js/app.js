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
      if (el.type === 'curveArrow') { xs.push(el.cx); ys.push(el.cy); }
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
      if (el.type === 'curveArrow') {
        const N = 20;
        let px = el.x1, py = el.y1, hit = false;
        for (let s = 1; s <= N && !hit; s++) {
          const t = s / N, mt = 1 - t;
          const qx = mt * mt * el.x1 + 2 * mt * t * el.cx + t * t * el.x2;
          const qy = mt * mt * el.y1 + 2 * mt * t * el.cy + t * t * el.y2;
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

  /**
   * Copia de la curveArrow con el control reflejado respecto a la recta
   * (x1,y1)–(x2,y2): invierte el lado del giro sin cambiar los extremos.
   */
  function flipCurve(el) {
    const dx = el.x2 - el.x1, dy = el.y2 - el.y1;
    const len2 = dx * dx + dy * dy;
    if (!len2) return el; // extremos coincidentes: nada que reflejar
    const t = ((el.cx - el.x1) * dx + (el.cy - el.y1) * dy) / len2;
    const px = el.x1 + dx * t, py = el.y1 + dy * t;
    return { ...el, cx: 2 * px - el.cx, cy: 2 * py - el.cy };
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
   * Punto medio del trazo de una flecha: para curveArrow, el punto de la
   * curva en t=0.5 (no el punto medio de la cuerda); para arrow/line, el
   * punto medio del segmento. Donde se centra la etiqueta.
   */
  function arrowMidpoint(el) {
    if (el.type === 'curveArrow') {
      if (el.cx2 !== undefined) {
        // Cúbica: B(0.5) = 0.125·p1 + 0.375·c1 + 0.375·c2 + 0.125·p2
        return {
          x: 0.125 * el.x1 + 0.375 * el.cx + 0.375 * el.cx2 + 0.125 * el.x2,
          y: 0.125 * el.y1 + 0.375 * el.cy + 0.375 * el.cy2 + 0.125 * el.y2,
        };
      }
      // Cuadrática: Q(0.5) = 0.25·p1 + 0.5·c + 0.25·p2
      return {
        x: 0.25 * el.x1 + 0.5 * el.cx + 0.25 * el.x2,
        y: 0.25 * el.y1 + 0.5 * el.cy + 0.25 * el.y2,
      };
    }
    return { x: (el.x1 + el.x2) / 2, y: (el.y1 + el.y2) / 2 };
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
      Renderer.drawSelection(ctx, getElementBounds(state.elements[i]), single);
    });
    // Handle de curvatura de la flecha curva seleccionada
    if (single) {
      const sel = state.elements[state.selection[0]];
      if (sel.type === 'curveArrow') {
        ctx.save();
        ctx.strokeStyle = '#4ecdc4';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(sel.x1, sel.y1);
        ctx.lineTo(sel.cx, sel.cy);
        ctx.lineTo(sel.x2, sel.y2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#4ecdc4';
        ctx.beginPath();
        ctx.arc(sel.cx, sel.cy, 5, 0, Math.PI * 2);
        ctx.fill();
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
    // Handle de curvatura: mueve solo el punto de control
    if (r.corner === 'ctrl') {
      let cp = p;
      // Shift: restringe el control a la mediatriz de la cuerda → arcos
      // simétricos, solo cambia la intensidad (puede cruzar al otro lado)
      if (e.shiftKey) {
        const fr = chordFrame(r.original);
        if (fr) {
          const sVal = (p.x - fr.mx) * fr.ux + (p.y - fr.my) * fr.uy;
          cp = { x: fr.mx + sVal * fr.ux, y: fr.my + sVal * fr.uy };
        }
      }
      state.elements[state.selection[0]] = { ...r.original, cx: cp.x, cy: cp.y };
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
        // Handle de curvatura de la flecha curva
        if (selEl.type === 'curveArrow' &&
            Math.hypot(pos.x - selEl.cx, pos.y - selEl.cy) <= HANDLE_HIT) {
          state.resizing = { corner: 'ctrl', from: null, original: selEl, snapshot: snapshot(), did: false };
          return;
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
    if (state.tool === TOOLS.CURVE_ARROW) state.curveFlip = e.shiftKey;
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
      if (state.resizing.did) pushUndo(state.resizing.snapshot);
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

    // Line / Arrow / Curve (descarta clicks sin arrastre: líneas de longitud ~0)
    if ([TOOLS.LINE, TOOLS.ARROW, TOOLS.CURVE_ARROW].includes(state.tool)) {
      if (Math.hypot(p2.x - p1.x, p2.y - p1.y) >= 4) {
        saveUndo();
        const el = {
          type: state.tool,
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
        if ((state.tool === TOOLS.ARROW || state.tool === TOOLS.CURVE_ARROW) && state.doubleHead) {
          el.heads = 'both';
        }
        if (state.dashed) el.dash = true;
        state.elements.push(el);
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
    // Doble click sobre el handle de curvatura: resetear al 25% por defecto
    if (state.selection.length === 1) {
      const sel = state.elements[state.selection[0]];
      if (sel && sel.type === 'curveArrow' &&
          Math.hypot(pos.x - sel.cx, pos.y - sel.cy) <= HANDLE_HIT) {
        saveUndo();
        const c = defaultCtrl({ x: sel.x1, y: sel.y1 }, { x: sel.x2, y: sel.y2 }, false);
        state.elements[state.selection[0]] = { ...sel, cx: c.cx, cy: c.cy };
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
      // Etiqueta de la flecha, centrada sobre el punto medio del trazo
      const mid = arrowMidpoint(el);
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
    state.selection.forEach(i => {
      const copy = moveElement(state.elements[i], 15, 15);
      copy.seed = newSeed();
      state.elements.push(copy);
    });
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
          const t = state.elements[i].type;
          return t === 'arrow' || t === 'curveArrow';
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

    // +/−: ajustar la intensidad de curvatura de la flecha curva seleccionada
    // ('+' aleja el control del eje en su lado actual, '−' lo acerca y puede
    // cruzar; Shift: paso fino de 1px). Conserva la componente lateral.
    if ((e.key === '+' || e.key === '=' || e.key === '-') &&
        !e.ctrlKey && !e.metaKey && !e.altKey && state.selection.length === 1) {
      const el = state.elements[state.selection[0]];
      if (el.type === 'curveArrow') {
        const fr = chordFrame(el);
        if (fr) {
          e.preventDefault();
          const sVal = (el.cx - fr.mx) * fr.ux + (el.cy - fr.my) * fr.uy;
          const dir = (e.key === '-' ? -1 : 1) * (Math.sign(sVal) || 1);
          const d = (e.shiftKey ? 1 : 5) * dir;
          saveUndo();
          state.elements[state.selection[0]] = { ...el, cx: el.cx + d * fr.ux, cy: el.cy + d * fr.uy };
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
