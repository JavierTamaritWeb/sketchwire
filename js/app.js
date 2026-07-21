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
    showGrid:    true,
    snapGrid:    false,
    elements:    [],
    undoStack:   [],
    redoStack:   [],
    isDrawing:   false,
    startPos:    null,
    currentPath: [],
    selectedIdx: null,
    editingIdx:  null,
    dragOffset:  { x: 0, y: 0 },
    dragSnapshot: null,
    didDrag:     false,
  };

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
    if (el.type === 'line' || el.type === 'arrow') {
      return {
        x: Math.min(el.x1, el.x2),
        y: Math.min(el.y1, el.y2),
        w: Math.abs(el.x2 - el.x1),
        h: Math.abs(el.y2 - el.y1),
      };
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
    } else {
      m.x = (m.x || 0) + dx;
      m.y = (m.y || 0) + dy;
    }
    return m;
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
    if (state.selectedIdx !== null && state.elements[state.selectedIdx]) {
      Renderer.drawSelection(ctx, getElementBounds(state.elements[state.selectedIdx]));
    }
    $('el-count').textContent = state.elements.length;
    // Único punto que sincroniza la UI dependiente de la selección
    const hasSel = state.selectedIdx !== null;
    $('btn-delete-sel').hidden = !hasSel;
    $('btn-duplicate-sel').hidden = !hasSel;
    scheduleAutosave();
  }

  /* ── Canvas events ── */

  function onMouseDown(e) {
    const pos = getPos(e);

    // SELECT tool
    if (state.tool === TOOLS.SELECT) {
      const idx = hitTest(pos);
      if (idx >= 0) {
        state.selectedIdx = idx;
        const b = getElementBounds(state.elements[idx]);
        state.dragOffset = { x: pos.x - b.x, y: pos.y - b.y };
        // Snapshot ANTES de que el drag mute state.elements
        state.dragSnapshot = snapshot();
        state.didDrag = false;
      } else {
        state.selectedIdx = null;
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

    if (state.tool === TOOLS.PENCIL || state.tool === TOOLS.ERASER) {
      state.currentPath = [pos];
    }
  }

  /* ── Overlay preview (coalescido vía requestAnimationFrame) ── */

  let overlayPending = false;
  let lastPos = null;

  function paintOverlay() {
    octx.clearRect(0, 0, CANVAS_W, CANVAS_H);
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

    // Dragging selected element
    if (state.tool === TOOLS.SELECT && state.selectedIdx !== null && e.buttons === 1) {
      const el = state.elements[state.selectedIdx];
      const b  = getElementBounds(el);
      const dx = pos.x - state.dragOffset.x - b.x;
      const dy = pos.y - state.dragOffset.y - b.y;
      state.elements[state.selectedIdx] = moveElement(el, dx, dy);
      state.didDrag = true;
      redraw();
      return;
    }

    if (!state.isDrawing) return;
    lastPos = pos;
    // Los puntos se acumulan en cada evento (no se pierde trazo);
    // el pintado se coalesce a un frame por refresco
    if (state.tool === TOOLS.PENCIL || state.tool === TOOLS.ERASER) {
      state.currentPath.push(pos);
    }
    scheduleOverlay();
  }

  function onMouseUp(e) {
    // End drag of selected element: el snapshot se capturó en onMouseDown,
    // antes de que onMouseMove mutara state.elements
    if (state.tool === TOOLS.SELECT && state.selectedIdx !== null) {
      if (state.didDrag && state.dragSnapshot) {
        pushUndo(state.dragSnapshot);
        // Snap al soltar el drag
        if (state.snapGrid && !e.altKey) {
          const el = state.elements[state.selectedIdx];
          const b = getElementBounds(el);
          const dx = snapVal(b.x) - b.x;
          const dy = snapVal(b.y) - b.y;
          if (dx || dy) state.elements[state.selectedIdx] = moveElement(el, dx, dy);
        }
      }
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

    // Line / Arrow (descarta clicks sin arrastre: líneas de longitud ~0)
    if (state.tool === TOOLS.LINE || state.tool === TOOLS.ARROW) {
      if (Math.hypot(p2.x - p1.x, p2.y - p1.y) >= 4) {
        saveUndo();
        state.elements.push({
          type: state.tool,
          x1: p1.x, y1: p1.y,
          x2: p2.x, y2: p2.y,
          color: state.color, lineWidth: state.lineWidth,
          seed: newSeed(),
        });
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
          state.selectedIdx = null;
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
    const idx = hitTest(getPos(e));
    if (idx < 0) return;
    const el = state.elements[idx];
    if (el.type === 'text') {
      state.editingIdx = idx;
      showTextInput({ x: el.x, y: el.y }, el.value, el.fontSize);
    } else if (LABELED_TYPES.includes(el.type)) {
      state.editingIdx = idx;
      showTextInput({ x: el.x, y: el.y }, el.label || '', 14);
    }
  });

  /* ── Canvas cursor ── */

  function updateCursor() {
    mainCanvas.classList.toggle('canvas-area__canvas--move', state.tool === TOOLS.SELECT);
  }

  /* ── Acciones sobre la selección ── */

  function selectTool(id) {
    state.tool = id;
    state.selectedIdx = null;
    updateToolbarActive();
    updateCursor();
    redraw();
  }

  function deleteSelection() {
    if (state.selectedIdx === null) return;
    saveUndo();
    state.elements.splice(state.selectedIdx, 1);
    state.selectedIdx = null;
    redraw();
  }

  function duplicateSelection() {
    if (state.selectedIdx === null) return;
    saveUndo();
    const copy = moveElement(state.elements[state.selectedIdx], 15, 15);
    copy.seed = newSeed();
    state.elements.push(copy);
    state.selectedIdx = state.elements.length - 1;
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

    // Stroke slider
    $('stroke-slider').addEventListener('input', e => {
      state.lineWidth = +e.target.value;
      $('stroke-val').textContent = e.target.value;
    });

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
    $('check-grid').addEventListener('change', e => { state.showGrid = e.target.checked; redraw(); });
    $('check-snap').addEventListener('change', e => { state.snapGrid = e.target.checked; });

    // Undo / Redo
    $('btn-undo').addEventListener('click', undo);
    $('btn-redo').addEventListener('click', redo);

    // Clear
    $('btn-clear').addEventListener('click', () => {
      saveUndo();
      state.elements = [];
      state.selectedIdx = null;
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
    state.selectedIdx = null;
    redraw();
  }

  function redo() {
    if (!state.redoStack.length) return;
    state.undoStack.push(snapshot());
    state.elements = state.redoStack.pop();
    state.selectedIdx = null;
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

    if ((e.key === 'Delete' || e.key === 'Backspace') && state.selectedIdx !== null) {
      e.preventDefault();
      deleteSelection();
      return;
    }

    if (e.key === 'Escape' && state.selectedIdx !== null) {
      state.selectedIdx = null;
      redraw();
      return;
    }

    // Nudge de la selección con flechas (Shift: paso de cuadrícula)
    if (NUDGE[e.key] && state.selectedIdx !== null) {
      e.preventDefault();
      const f = e.shiftKey ? GRID_STEP : 1;
      saveUndo();
      state.elements[state.selectedIdx] =
        moveElement(state.elements[state.selectedIdx], NUDGE[e.key][0] * f, NUDGE[e.key][1] * f);
      redraw();
      return;
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
        state.selectedIdx = null;
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
