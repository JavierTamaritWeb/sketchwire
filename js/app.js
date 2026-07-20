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
    elements:    [],
    undoStack:   [],
    redoStack:   [],
    isDrawing:   false,
    startPos:    null,
    currentPath: [],
    selectedIdx: null,
    dragOffset:  { x: 0, y: 0 },
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

  function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function saveUndo() {
    state.undoStack.push(clone(state.elements));
    state.redoStack.length = 0;
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
      return { x: el.x, y: el.y, w: el.value.length * el.fontSize * 0.55, h: el.fontSize + 8 };
    }
    return { x: el.x, y: el.y, w: el.w, h: el.h };
  }

  function hitTest(pos) {
    for (let i = state.elements.length - 1; i >= 0; i--) {
      const b = getElementBounds(state.elements[i]);
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

  /* ── Full redraw ── */

  function redraw() {
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    if (state.showGrid) Renderer.drawGrid(ctx, CANVAS_W, CANVAS_H);
    state.elements.forEach(el => Renderer.renderElement(ctx, el));
    if (state.selectedIdx !== null && state.elements[state.selectedIdx]) {
      Renderer.drawSelection(ctx, getElementBounds(state.elements[state.selectedIdx]));
    }
    $('el-count').textContent = state.elements.length;
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
        $('btn-delete-sel').hidden = false;
      } else {
        state.selectedIdx = null;
        $('btn-delete-sel').hidden = true;
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

  function onMouseMove(e) {
    const pos = getPos(e);

    // Dragging selected element
    if (state.tool === TOOLS.SELECT && state.selectedIdx !== null && e.buttons === 1) {
      const el = state.elements[state.selectedIdx];
      const b  = getElementBounds(el);
      const dx = pos.x - state.dragOffset.x - b.x;
      const dy = pos.y - state.dragOffset.y - b.y;
      state.elements[state.selectedIdx] = moveElement(el, dx, dy);
      redraw();
      return;
    }

    if (!state.isDrawing) return;

    octx.clearRect(0, 0, CANVAS_W, CANVAS_H);

    // Freehand preview
    if (state.tool === TOOLS.PENCIL || state.tool === TOOLS.ERASER) {
      state.currentPath.push(pos);
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

  function onMouseUp(e) {
    // End drag of selected element
    if (state.tool === TOOLS.SELECT && state.selectedIdx !== null) {
      saveUndo();
      redraw();
      return;
    }

    if (!state.isDrawing) return;
    const pos = getPos(e);
    octx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    state.isDrawing = false;
    saveUndo();

    // Freehand commit
    if (state.tool === TOOLS.PENCIL || state.tool === TOOLS.ERASER) {
      state.currentPath.push(pos);
      state.elements.push({
        type: state.tool,
        points: state.currentPath,
        color: state.color,
        lineWidth: state.lineWidth,
      });
      state.currentPath = [];
      redraw();
      return;
    }

    if (!state.startPos) return;
    const x = Math.min(state.startPos.x, pos.x);
    const y = Math.min(state.startPos.y, pos.y);
    const w = Math.abs(pos.x - state.startPos.x);
    const h = Math.abs(pos.y - state.startPos.y);

    // Line / Arrow
    if (state.tool === TOOLS.LINE || state.tool === TOOLS.ARROW) {
      state.elements.push({
        type: state.tool,
        x1: state.startPos.x, y1: state.startPos.y,
        x2: pos.x, y2: pos.y,
        color: state.color, lineWidth: state.lineWidth,
      });
    }
    // Geometric shapes
    else if ([TOOLS.RECT, TOOLS.ROUNDED_RECT, TOOLS.CIRCLE].includes(state.tool)) {
      if (w > 3 && h > 3) {
        state.elements.push({
          type: state.tool,
          x, y, w, h,
          color: state.color, lineWidth: state.lineWidth,
          fill: state.fillShapes,
        });
      }
    }
    // UI components
    else if (UI_DEFAULTS[state.tool]) {
      const defs = UI_DEFAULTS[state.tool];
      state.elements.push({
        type: state.tool,
        x, y,
        w: w > 20 ? w : defs.w,
        h: h > 20 ? h : defs.h,
        color: state.color, lineWidth: state.lineWidth,
      });
    }

    state.startPos = null;
    redraw();
  }

  /* ── Text input ── */

  function showTextInput(pos) {
    textInput.hidden  = false;
    textInput.style.left     = (pos.x * state.zoom) + 'px';
    textInput.style.top      = (pos.y * state.zoom) + 'px';
    textInput.style.fontSize = state.fontSize + 'px';
    textInput.value  = '';
    textInput.focus();
  }

  function commitText() {
    if (textInput.hidden) return;
    const val = textInput.value.trim();
    textInput.hidden = true;
    if (!val) return;
    saveUndo();

    const posX = parseFloat(textInput.style.left) / state.zoom;
    const posY = parseFloat(textInput.style.top)  / state.zoom;

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
    if (e.key === 'Escape') { textInput.hidden = true; }
  });
  textInput.addEventListener('blur', commitText);

  /* ── Canvas cursor ── */

  function updateCursor() {
    mainCanvas.classList.toggle('canvas-area__canvas--move', state.tool === TOOLS.SELECT);
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
        btn.title = t.name;
        btn.innerHTML = `<span>${t.icon}</span><span class="sidebar__tool-name">${t.name}</span>`;
        btn.addEventListener('click', () => {
          state.tool = t.id;
          state.selectedIdx = null;
          $('btn-delete-sel').hidden = true;
          updateToolbarActive();
          updateCursor();
          redraw();
        });
        div.appendChild(btn);
      });
      sidebar.appendChild(div);
    });
    updateToolbarActive();
  }

  function updateToolbarActive() {
    document.querySelectorAll('.sidebar__tool').forEach(btn => {
      btn.classList.toggle('sidebar__tool--active', btn.dataset.tool === state.tool);
    });
  }

  /* ── Build color grid ── */

  function buildColors() {
    const grid = $('color-grid');
    grid.innerHTML = '';
    COLORS.forEach(c => {
      const swatch = document.createElement('div');
      swatch.className = 'panel__color-swatch';
      swatch.style.background = c;
      swatch.dataset.color = c;
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
      s.classList.toggle('panel__color-swatch--active', s.dataset.color === state.color);
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

    // Undo / Redo
    $('btn-undo').addEventListener('click', undo);
    $('btn-redo').addEventListener('click', redo);

    // Clear
    $('btn-clear').addEventListener('click', () => {
      saveUndo();
      state.elements = [];
      state.selectedIdx = null;
      $('btn-delete-sel').hidden = true;
      redraw();
    });

    // Delete selection
    $('btn-delete-sel').addEventListener('click', () => {
      if (state.selectedIdx === null) return;
      saveUndo();
      state.elements.splice(state.selectedIdx, 1);
      state.selectedIdx = null;
      $('btn-delete-sel').hidden = true;
      redraw();
    });

    // Import
    $('btn-import').addEventListener('click', async () => {
      const els = await Exporter.importJSON();
      if (els) {
        saveUndo();
        state.elements = els;
        redraw();
      }
    });
  }

  /* ── Undo / Redo ── */

  function undo() {
    if (!state.undoStack.length) return;
    state.redoStack.push(clone(state.elements));
    state.elements = state.undoStack.pop();
    state.selectedIdx = null;
    $('btn-delete-sel').hidden = true;
    redraw();
  }

  function redo() {
    if (!state.redoStack.length) return;
    state.undoStack.push(clone(state.elements));
    state.elements = state.redoStack.pop();
    redraw();
  }

  /* ── Keyboard shortcuts ── */

  document.addEventListener('keydown', e => {
    if (e.target === textInput) return; // Don't capture while typing text

    if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undo(); }
    if ((e.ctrlKey || e.metaKey) && e.key === 'y') { e.preventDefault(); redo(); }

    if ((e.key === 'Delete' || e.key === 'Backspace') && state.selectedIdx !== null) {
      e.preventDefault();
      saveUndo();
      state.elements.splice(state.selectedIdx, 1);
      state.selectedIdx = null;
      $('btn-delete-sel').hidden = true;
      redraw();
    }
  });

  /* ── Modals ── */

  function setupModals() {
    // Export modal
    const exportModal = $('modal-export');
    $('btn-export').addEventListener('click', () => { exportModal.hidden = false; });
    exportModal.querySelectorAll('.modal__backdrop, .modal__cancel').forEach(el => {
      el.addEventListener('click', () => { exportModal.hidden = true; });
    });
    exportModal.querySelectorAll('[data-export]').forEach(btn => {
      btn.addEventListener('click', () => {
        const fmt = btn.dataset.export;
        Exporter[fmt](state.elements);
        exportModal.hidden = true;
      });
    });

    // Templates modal
    const tplModal = $('modal-templates');
    $('btn-templates').addEventListener('click', () => { tplModal.hidden = false; });
    tplModal.querySelectorAll('.modal__backdrop, .modal__cancel').forEach(el => {
      el.addEventListener('click', () => { tplModal.hidden = true; });
    });
    tplModal.querySelectorAll('[data-template]').forEach(btn => {
      btn.addEventListener('click', () => {
        saveUndo();
        state.elements = Templates.get(btn.dataset.template);
        state.selectedIdx = null;
        $('btn-delete-sel').hidden = true;
        tplModal.hidden = true;
        redraw();
      });
    });
  }

  /* ── Canvas event binding ── */

  mainCanvas.addEventListener('mousedown', onMouseDown);
  mainCanvas.addEventListener('mousemove', onMouseMove);
  mainCanvas.addEventListener('mouseup',   onMouseUp);
  mainCanvas.addEventListener('mouseleave', e => {
    if (state.isDrawing) onMouseUp(e);
  });

  /* ── Init ── */

  function init() {
    buildSidebar();
    buildColors();
    wireControls();
    setupModals();
    updateCursor();
    redraw();
  }

  init();

})();
