/* ============================================================
   renderer.js — Canvas rendering for all element types
   ============================================================ */

const Renderer = (() => {

  /* ── Caché de imágenes (elementos type:image con src data-URL) ── */

  const _imgCache = new Map();
  let _onImageLoad = null;

  /** app.js registra aquí su redraw para repintar cuando cargue una imagen */
  function setImageLoadCallback(fn) {
    _onImageLoad = fn;
  }

  function _getImage(src) {
    let img = _imgCache.get(src);
    if (!img) {
      img = new Image();
      img.onload = () => { if (_onImageLoad) _onImageLoad(); };
      img.src = src;
      _imgCache.set(src, img);
    }
    return img;
  }

  function _image(ctx, el) {
    // En entornos sin Image (tests en Node) se dibuja solo el placeholder
    const img = (typeof Image !== 'undefined') ? _getImage(el.src) : null;
    if (img && img.complete && img.naturalWidth) {
      ctx.drawImage(img, el.x, el.y, el.w, el.h);
      return;
    }
    // Placeholder mientras carga (o si el src es irrecuperable)
    ctx.strokeStyle = el.color;
    ctx.lineWidth = el.lineWidth;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(el.x, el.y, el.w, el.h);
    ctx.setLineDash([]);
  }

  /* ── Etiqueta de flecha (arrow/curveArrow) ── */

  /**
   * Punto medio del trazo: en curveArrow el punto de la curva en t=0.5
   * (cuadrática o cúbica), no el punto medio de la cuerda.
   */
  function _arrowMid(el) {
    if (el.type === 'curveArrow') {
      if (el.cx2 !== undefined) {
        return {
          x: 0.125 * el.x1 + 0.375 * el.cx + 0.375 * el.cx2 + 0.125 * el.x2,
          y: 0.125 * el.y1 + 0.375 * el.cy + 0.375 * el.cy2 + 0.125 * el.y2,
        };
      }
      return {
        x: 0.25 * el.x1 + 0.5 * el.cx + 0.25 * el.x2,
        y: 0.25 * el.y1 + 0.5 * el.cy + 0.25 * el.y2,
      };
    }
    return { x: (el.x1 + el.x2) / 2, y: (el.y1 + el.y2) / 2 };
  }

  /** Etiqueta 13px centrada sobre el trazo, con halo blanco de legibilidad */
  function _arrowLabel(ctx, el) {
    if (!el.label) return;
    const mid = _arrowMid(el);
    ctx.font = `13px ${SKETCHY_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 4;
    ctx.strokeText(el.label, mid.x, mid.y);
    ctx.fillStyle = el.color;
    ctx.fillText(el.label, mid.x, mid.y);
  }

  /* ── UI component helpers ── */

  function _button(ctx, x, y, w, h, color, lw, label) {
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.fillStyle = color + '15';
    Sketchy.roundedRect(ctx, x, y, w, h, 8);
    ctx.fill();
    ctx.font = `${Math.min(16, h * 0.5)}px ${SKETCHY_FONT}`;
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label || 'Button', x + w / 2, y + h / 2);
  }

  function _input(ctx, x, y, w, h, color, lw, label) {
    ctx.strokeStyle = color + '80';
    ctx.lineWidth = lw;
    Sketchy.roundedRect(ctx, x, y, w, h, 4);
    ctx.font = `${Math.min(13, h * 0.45)}px ${SKETCHY_FONT}`;
    ctx.fillStyle = color + '60';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(label || 'Type here...', x + 10, y + h / 2);
  }

  function _imagePlaceholder(ctx, x, y, w, h, color, lw) {
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    Sketchy.rect(ctx, x, y, w, h);
    // Cross
    ctx.setLineDash([6, 4]);
    Sketchy.line(ctx, x, y, x + w, y + h);
    Sketchy.line(ctx, x + w, y, x, y + h);
    ctx.setLineDash([]);
    // Mountain icon
    const cx = x + w / 2;
    const cy = y + h / 2;
    const s = Math.min(w, h) * 0.2;
    ctx.beginPath();
    ctx.moveTo(cx - s, cy + s * 0.6);
    ctx.lineTo(cx - s * 0.3, cy - s * 0.4);
    ctx.lineTo(cx + s * 0.2, cy + s * 0.1);
    ctx.lineTo(cx + s * 0.5, cy - s * 0.6);
    ctx.lineTo(cx + s, cy + s * 0.6);
    ctx.closePath();
    ctx.stroke();
  }

  function _nav(ctx, x, y, w, h, color, lw, label) {
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.fillStyle = color + '0a';
    Sketchy.rect(ctx, x, y, w, h);
    ctx.fill();
    // Logo
    Sketchy.roundedRect(ctx, x + 10, y + (h - 20) / 2, 60, 20, 4);
    ctx.font = `12px ${SKETCHY_FONT}`;
    ctx.fillStyle = color;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(label || 'Logo', x + 20, y + h / 2);
    // Links
    const links = ['Home', 'About', 'Contact'];
    // 70px por link (mismo paso que el bucle) + 40 de hueco para la hamburguesa
    const startX = x + w - 70 * links.length - 40;
    links.forEach((link, i) => {
      ctx.fillText(link, startX + i * 70, y + h / 2);
    });
    // Hamburger
    const hx = x + w - 30;
    const hy = y + h / 2 - 6;
    for (let i = 0; i < 3; i++) {
      Sketchy.line(ctx, hx, hy + i * 6, hx + 18, hy + i * 6, 0.5);
    }
  }

  function _card(ctx, x, y, w, h, color, lw, label) {
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.fillStyle = '#ffffff08';
    Sketchy.roundedRect(ctx, x, y, w, h, 10);
    ctx.fill();
    // Image area
    const imgH = h * 0.45;
    ctx.fillStyle = color + '10';
    ctx.fillRect(x + 4, y + 4, w - 8, imgH);
    Sketchy.line(ctx, x + 4, y + imgH + 4, x + w - 4, y + imgH + 4);
    // Title
    ctx.font = `bold 14px ${SKETCHY_FONT}`;
    ctx.fillStyle = color;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(label || 'Card Title', x + 12, y + imgH + 14);
    // Description lines
    ctx.strokeStyle = color + '40';
    ctx.lineWidth = 1;
    const descY = y + imgH + 38;
    Sketchy.line(ctx, x + 12, descY, x + w - 20, descY, 0.5);
    Sketchy.line(ctx, x + 12, descY + 12, x + w * 0.7, descY + 12, 0.5);
  }

  /* ── Public: render a single element ── */

  function renderElement(ctx, el) {
    ctx.save();
    // Jitter determinista: el mismo seed reproduce exactamente el mismo
    // trazo en cada redraw (sin seed, cae en Math.random y "tiembla")
    Sketchy.setSeed(el.seed);
    ctx.strokeStyle = el.color;
    ctx.lineWidth   = el.lineWidth;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';

    switch (el.type) {

      case 'pencil': {
        if (el.points.length < 2) break;
        ctx.beginPath();
        ctx.moveTo(el.points[0].x, el.points[0].y);
        for (let i = 1; i < el.points.length; i++) {
          ctx.lineTo(el.points[i].x, el.points[i].y);
        }
        ctx.stroke();
        break;
      }

      case 'line':
        if (el.dash) ctx.setLineDash([4 * el.lineWidth, 4 * el.lineWidth]);
        Sketchy.line(ctx, el.x1, el.y1, el.x2, el.y2);
        if (el.dash) ctx.setLineDash([]);
        break;

      case 'arrow': {
        // Cuerpo y puntas descompuestos (mismo orden de consumo del PRNG que
        // Sketchy.arrow) para que el dash aplique solo al cuerpo
        if (el.dash) ctx.setLineDash([4 * el.lineWidth, 4 * el.lineWidth]);
        Sketchy.line(ctx, el.x1, el.y1, el.x2, el.y2);
        if (el.dash) ctx.setLineDash([]);
        const headLen = 10 + 2 * el.lineWidth;
        const angle = Math.atan2(el.y2 - el.y1, el.x2 - el.x1);
        Sketchy.arrowHead(el.x2, el.y2, angle, headLen).forEach(sg => {
          Sketchy.line(ctx, sg.x1, sg.y1, sg.x2, sg.y2);
        });
        // Doble punta opcional (heads === 'both'): punta también en el inicio
        if (el.heads === 'both') {
          const backAngle = Math.atan2(el.y1 - el.y2, el.x1 - el.x2);
          Sketchy.arrowHead(el.x1, el.y1, backAngle, headLen).forEach(sg => {
            Sketchy.line(ctx, sg.x1, sg.y1, sg.x2, sg.y2);
          });
        }
        _arrowLabel(ctx, el);
        break;
      }

      case 'curveArrow': {
        if (el.dash) ctx.setLineDash([4 * el.lineWidth, 4 * el.lineWidth]);
        Sketchy.curve(ctx, el.x1, el.y1, el.cx, el.cy, el.x2, el.y2);
        if (el.dash) ctx.setLineDash([]);
        // Punta escalada con el grosor (10 + 2·lineWidth; 14px con el default)
        const headLen = 10 + 2 * el.lineWidth;
        // Punta orientada según la tangente en el extremo (control → fin)
        let dx = el.x2 - el.cx, dy = el.y2 - el.cy;
        if (!dx && !dy) { dx = el.x2 - el.x1; dy = el.y2 - el.y1; }
        Sketchy.arrowHead(el.x2, el.y2, Math.atan2(dy, dx), headLen).forEach(sg => {
          Sketchy.line(ctx, sg.x1, sg.y1, sg.x2, sg.y2);
        });
        // Doble punta opcional: tangente en el inicio (control → inicio)
        if (el.heads === 'both') {
          let sdx = el.x1 - el.cx, sdy = el.y1 - el.cy;
          if (!sdx && !sdy) { sdx = el.x1 - el.x2; sdy = el.y1 - el.y2; }
          Sketchy.arrowHead(el.x1, el.y1, Math.atan2(sdy, sdx), headLen).forEach(sg => {
            Sketchy.line(ctx, sg.x1, sg.y1, sg.x2, sg.y2);
          });
        }
        _arrowLabel(ctx, el);
        break;
      }

      case 'rect':
        if (el.fill) {
          ctx.fillStyle = el.color + '20';
          ctx.fillRect(el.x, el.y, el.w, el.h);
        }
        Sketchy.rect(ctx, el.x, el.y, el.w, el.h);
        break;

      case 'roundedRect':
        if (el.fill) {
          ctx.fillStyle = el.color + '20';
          ctx.beginPath();
          ctx.roundRect(el.x, el.y, el.w, el.h, 12);
          ctx.fill();
        }
        Sketchy.roundedRect(ctx, el.x, el.y, el.w, el.h, 12);
        break;

      case 'circle': {
        const rx = Math.abs(el.w) / 2;
        const ry = Math.abs(el.h) / 2;
        const cx = el.x + el.w / 2;
        const cy = el.y + el.h / 2;
        if (el.fill) {
          ctx.fillStyle = el.color + '20';
          ctx.beginPath();
          ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        Sketchy.ellipse(ctx, cx, cy, rx, ry);
        break;
      }

      case 'text':
        ctx.font = `${el.fontSize}px ${SKETCHY_FONT}`;
        ctx.fillStyle = el.color;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        el.value.split('\n').forEach((ln, i) => {
          ctx.fillText(ln, el.x, el.y + i * (el.fontSize + 4));
        });
        break;

      case 'eraser': {
        if (el.points.length < 2) break;
        ctx.globalCompositeOperation = 'destination-out';
        ctx.strokeStyle = 'rgba(0,0,0,1)';
        ctx.lineWidth = el.lineWidth * 4;
        ctx.beginPath();
        ctx.moveTo(el.points[0].x, el.points[0].y);
        for (let i = 1; i < el.points.length; i++) {
          ctx.lineTo(el.points[i].x, el.points[i].y);
        }
        ctx.stroke();
        break;
      }

      case 'button':           _button(ctx, el.x, el.y, el.w, el.h, el.color, el.lineWidth, el.label); break;
      case 'input':            _input(ctx, el.x, el.y, el.w, el.h, el.color, el.lineWidth, el.label); break;
      case 'imagePlaceholder': _imagePlaceholder(ctx, el.x, el.y, el.w, el.h, el.color, el.lineWidth); break;
      case 'image':            _image(ctx, el); break;
      case 'nav':              _nav(ctx, el.x, el.y, el.w, el.h, el.color, el.lineWidth, el.label); break;
      case 'card':             _card(ctx, el.x, el.y, el.w, el.h, el.color, el.lineWidth, el.label); break;
    }

    Sketchy.setSeed(null);
    ctx.restore();
  }

  /* ── Grid ── */

  function drawGrid(ctx, w, h) {
    ctx.save();
    const step = 20;
    // Minor grid
    ctx.strokeStyle = '#e0e4ea';
    ctx.lineWidth = 0.5;
    for (let x = 0; x < w; x += step) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }
    for (let y = 0; y < h; y += step) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
    // Major grid
    ctx.strokeStyle = '#cdd3de';
    ctx.lineWidth = 0.8;
    for (let x = 0; x < w; x += step * 5) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }
    for (let y = 0; y < h; y += step * 5) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
    ctx.restore();
  }

  /* ── Selection highlight ── */

  function drawSelection(ctx, bounds, withHandles = false) {
    ctx.save();
    ctx.strokeStyle = '#4ecdc4';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 5]);
    ctx.strokeRect(bounds.x - 4, bounds.y - 4, bounds.w + 8, bounds.h + 8);
    ctx.setLineDash([]);
    if (withHandles) {
      // Handles de resize en las esquinas del marco (mismas posiciones que
      // usa el hit-test de handles en app.js)
      const HS = 8;
      ctx.fillStyle = '#ffffff';
      [
        [bounds.x - 4, bounds.y - 4],
        [bounds.x + bounds.w + 4, bounds.y - 4],
        [bounds.x - 4, bounds.y + bounds.h + 4],
        [bounds.x + bounds.w + 4, bounds.y + bounds.h + 4],
      ].forEach(([cx, cy]) => {
        ctx.fillRect(cx - HS / 2, cy - HS / 2, HS, HS);
        ctx.strokeRect(cx - HS / 2, cy - HS / 2, HS, HS);
      });
    }
    ctx.restore();
  }

  return { renderElement, drawGrid, drawSelection, setImageLoadCallback };
})();
