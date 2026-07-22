/* ============================================================
   exporter.js — Multi-format export & JSON import
   ============================================================ */

const Exporter = (() => {

  /** Helper: trigger a file download */
  function _download(filename, url) {
    const a = document.createElement('a');
    a.download = filename;
    a.href = url;
    a.click();
    URL.revokeObjectURL(url);
  }

  function _downloadBlob(filename, blob) {
    _download(filename, URL.createObjectURL(blob));
  }

  /**
   * Render elements to a temp canvas (no grid) and return its data URL.
   */
  function _renderClean(elements, format, quality) {
    const c = document.createElement('canvas');
    c.width = CANVAS_W;
    c.height = CANVAS_H;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    elements.forEach(el => Renderer.renderElement(ctx, el));
    // El borrador (destination-out) perfora el fondo: repintar blanco por
    // detrás para que el PNG no salga transparente ni el JPG negro
    ctx.globalCompositeOperation = 'destination-over';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.globalCompositeOperation = 'source-over';
    return c.toDataURL(format, quality);
  }

  /* ── Public exports ── */

  function png(elements) {
    const url = _renderClean(elements, 'image/png');
    const a = document.createElement('a');
    a.download = 'wireframe.png';
    a.href = url;
    a.click();
  }

  function jpg(elements) {
    const url = _renderClean(elements, 'image/jpeg', 0.95);
    const a = document.createElement('a');
    a.download = 'wireframe.jpg';
    a.href = url;
    a.click();
  }

  function svg(elements) {
    let out = `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS_W}" height="${CANVAS_H}" viewBox="0 0 ${CANVAS_W} ${CANVAS_H}">\n`;
    out += `<rect width="100%" height="100%" fill="white"/>\n`;
    out += `<style>@import url('https://fonts.googleapis.com/css2?family=Architects+Daughter&amp;display=swap');</style>\n`;

    elements.forEach(el => { out += _svgElement(el); });

    out += '</svg>';
    _downloadBlob('wireframe.svg', new Blob([out], { type: 'image/svg+xml' }));
  }

  const FONT_FALLBACK = 'Architects Daughter, Segoe Print, Comic Neue, cursive';

  /** Tipos sin representación HTML propia: van en un <svg> incrustado */
  const VECTOR_TYPES = ['pencil', 'eraser', 'line', 'arrow', 'curveArrow', 'circle'];

  /**
   * Etiqueta de flecha en SVG: <text> centrado en el punto medio del trazo
   * con halo blanco (paint-order:stroke), misma técnica que el canvas.
   */
  function _svgArrowLabel(el, color) {
    if (!el.label) return '';
    let mx, my;
    if (el.type === 'curveArrow') {
      if (el.cx2 !== undefined) {
        mx = 0.125 * el.x1 + 0.375 * el.cx + 0.375 * el.cx2 + 0.125 * el.x2;
        my = 0.125 * el.y1 + 0.375 * el.cy + 0.375 * el.cy2 + 0.125 * el.y2;
      } else {
        mx = 0.25 * el.x1 + 0.5 * el.cx + 0.25 * el.x2;
        my = 0.25 * el.y1 + 0.5 * el.cy + 0.25 * el.y2;
      }
    } else {
      mx = (el.x1 + el.x2) / 2;
      my = (el.y1 + el.y2) / 2;
    }
    return `<text x="${mx}" y="${my}" fill="${color}" stroke="#ffffff" stroke-width="4" paint-order="stroke" font-family="${FONT_FALLBACK}" font-size="13" text-anchor="middle" dominant-baseline="middle">${_escapeXml(el.label)}</text>\n`;
  }

  /**
   * Las 2 <line> de una punta de flecha (solo valores numéricos calculados;
   * `s` ya viene con color/grosor escapados). Geometría de Sketchy.arrowHead.
   */
  function _svgArrowHead(x, y, angle, len, s) {
    return Sketchy.arrowHead(x, y, angle, len)
      .map(sg => `<line x1="${sg.x1}" y1="${sg.y1}" x2="${sg.x2}" y2="${sg.y2}" ${s}/>\n`)
      .join('');
  }

  /**
   * Markup SVG de un elemento. Compartido por el export SVG y el
   * <svg> incrustado del export HTML (tipos vectoriales).
   */
  function _svgElement(el) {
    const color = _escapeXml(String(el.color));
    const lw = _escapeXml(String(el.lineWidth));
    const s = `stroke="${color}" stroke-width="${lw}" fill="none" stroke-linecap="round"`;
    const sf = `stroke="${color}" stroke-width="${lw}" stroke-linecap="round" fill="${el.fill ? color + '20' : 'none'}"`;
    // Cuerpo con trazo discontinuo opcional (las puntas siempre usan `s`, sólidas)
    const sBody = el.dash ? `${s} stroke-dasharray="${4 * el.lineWidth} ${4 * el.lineWidth}"` : s;
    let out = '';

    switch (el.type) {
        case 'pencil':
          if (el.points.length > 1) {
            const d = el.points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`).join(' ');
            out += `<path d="${d}" ${s}/>\n`;
          }
          break;

        case 'eraser':
          // SVG no tiene destination-out: se aproxima con trazo blanco
          if (el.points.length > 1) {
            const d = el.points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`).join(' ');
            out += `<path d="${d}" stroke="#ffffff" stroke-width="${el.lineWidth * 4}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>\n`;
          }
          break;

        case 'line':
          out += `<line x1="${el.x1}" y1="${el.y1}" x2="${el.x2}" y2="${el.y2}" ${sBody}/>\n`;
          break;

        case 'arrow': {
          out += `<line x1="${el.x1}" y1="${el.y1}" x2="${el.x2}" y2="${el.y2}" ${sBody}/>\n`;
          // Punta escalada con el grosor (10 + 2·lineWidth; 14 con el default)
          const hl = 10 + 2 * el.lineWidth;
          const a = Math.atan2(el.y2 - el.y1, el.x2 - el.x1);
          out += _svgArrowHead(el.x2, el.y2, a, hl, s);
          if (el.heads === 'both') {
            out += _svgArrowHead(el.x1, el.y1, Math.atan2(el.y1 - el.y2, el.x1 - el.x2), hl, s);
          }
          out += _svgArrowLabel(el, color);
          break;
        }

        case 'curveArrow': {
          out += `<path d="M${el.x1} ${el.y1} Q${el.cx} ${el.cy} ${el.x2} ${el.y2}" ${sBody}/>\n`;
          const chl = 10 + 2 * el.lineWidth;
          // Punta según la tangente en el extremo (control → fin)
          let tdx = el.x2 - el.cx, tdy = el.y2 - el.cy;
          if (!tdx && !tdy) { tdx = el.x2 - el.x1; tdy = el.y2 - el.y1; }
          out += _svgArrowHead(el.x2, el.y2, Math.atan2(tdy, tdx), chl, s);
          // Doble punta opcional: tangente en el inicio (control → inicio)
          if (el.heads === 'both') {
            let sdx = el.x1 - el.cx, sdy = el.y1 - el.cy;
            if (!sdx && !sdy) { sdx = el.x1 - el.x2; sdy = el.y1 - el.y2; }
            out += _svgArrowHead(el.x1, el.y1, Math.atan2(sdy, sdx), chl, s);
          }
          out += _svgArrowLabel(el, color);
          break;
        }

        case 'image':
          out += `<image x="${el.x}" y="${el.y}" width="${el.w}" height="${el.h}" href="${_escapeXml(el.src)}" preserveAspectRatio="none"/>\n`;
          break;

        case 'rect':
          out += `<rect x="${el.x}" y="${el.y}" width="${el.w}" height="${el.h}" ${sf}/>\n`;
          break;

        case 'roundedRect':
          out += `<rect x="${el.x}" y="${el.y}" width="${el.w}" height="${el.h}" rx="12" ${sf}/>\n`;
          break;

        case 'circle':
          out += `<ellipse cx="${el.x + el.w / 2}" cy="${el.y + el.h / 2}" rx="${Math.abs(el.w) / 2}" ry="${Math.abs(el.h) / 2}" ${sf}/>\n`;
          break;

        case 'text': {
          // Multilínea: un <tspan> por línea con el mismo interlineado que el canvas
          const lines = String(el.value).split('\n');
          out += `<text x="${el.x}" y="${el.y + el.fontSize}" fill="${color}" font-family="${FONT_FALLBACK}" font-size="${el.fontSize}">`;
          lines.forEach((ln, i) => {
            out += `<tspan x="${el.x}" dy="${i === 0 ? 0 : el.fontSize + 4}">${_escapeXml(ln)}</tspan>`;
          });
          out += `</text>\n`;
          break;
        }

        // UI components → simple rects with labels in SVG
        case 'button':
          out += `<rect x="${el.x}" y="${el.y}" width="${el.w}" height="${el.h}" rx="8" stroke="${color}" stroke-width="${lw}" stroke-linecap="round" fill="${color}15"/>\n`;
          out += `<text x="${el.x + el.w / 2}" y="${el.y + el.h / 2 + 5}" fill="${color}" font-family="${FONT_FALLBACK}" font-size="14" text-anchor="middle">${_escapeXml(el.label || 'Button')}</text>\n`;
          break;

        case 'input':
          out += `<rect x="${el.x}" y="${el.y}" width="${el.w}" height="${el.h}" rx="4" stroke="${color}80" stroke-width="${lw}" fill="none"/>\n`;
          out += `<text x="${el.x + 10}" y="${el.y + el.h / 2 + 4}" fill="${color}60" font-family="${FONT_FALLBACK}" font-size="13">${_escapeXml(el.label || 'Type here...')}</text>\n`;
          break;

        case 'imagePlaceholder':
          out += `<rect x="${el.x}" y="${el.y}" width="${el.w}" height="${el.h}" ${s}/>\n`;
          out += `<line x1="${el.x}" y1="${el.y}" x2="${el.x + el.w}" y2="${el.y + el.h}" ${s} stroke-dasharray="6 4"/>\n`;
          out += `<line x1="${el.x + el.w}" y1="${el.y}" x2="${el.x}" y2="${el.y + el.h}" ${s} stroke-dasharray="6 4"/>\n`;
          break;

        case 'nav':
          out += `<rect x="${el.x}" y="${el.y}" width="${el.w}" height="${el.h}" stroke="${color}" stroke-width="${lw}" stroke-linecap="round" fill="${color}0a"/>\n`;
          out += `<text x="${el.x + 20}" y="${el.y + el.h / 2 + 4}" fill="${color}" font-family="${FONT_FALLBACK}" font-size="12">${_escapeXml(el.label || 'Logo')}</text>\n`;
          break;

        case 'card':
          out += `<rect x="${el.x}" y="${el.y}" width="${el.w}" height="${el.h}" rx="10" ${s}/>\n`;
          out += `<line x1="${el.x + 4}" y1="${el.y + el.h * 0.45 + 4}" x2="${el.x + el.w - 4}" y2="${el.y + el.h * 0.45 + 4}" ${s}/>\n`;
          out += `<text x="${el.x + 12}" y="${el.y + el.h * 0.45 + 24}" fill="${color}" font-family="${FONT_FALLBACK}" font-size="14" font-weight="bold">${_escapeXml(el.label || 'Card Title')}</text>\n`;
          break;
    }

    return out;
  }

  function html(elements) {
    let out = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Wireframe Export</title>
<link href="https://fonts.googleapis.com/css2?family=Architects+Daughter&display=swap" rel="stylesheet">
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: ${SKETCHY_FONT}; background: #fff; }
.wireframe { position: relative; width: ${CANVAS_W}px; height: ${CANVAS_H}px; margin: 20px auto; border: 1px solid #ccc; }
.wireframe > * { position: absolute; }
</style>
</head>
<body>
<div class="wireframe">
`;

    // Tipos sin representación HTML (lápiz, líneas, flechas, círculos,
    // borrador): se incrustan como un <svg> superpuesto del mismo tamaño
    const vectors = elements.filter(el => VECTOR_TYPES.includes(el.type));
    if (vectors.length) {
      out += `  <svg width="${CANVAS_W}" height="${CANVAS_H}" viewBox="0 0 ${CANVAS_W} ${CANVAS_H}" style="left:0;top:0;pointer-events:none;">\n`;
      vectors.forEach(el => { out += '    ' + _svgElement(el); });
      out += `  </svg>\n`;
    }

    elements.forEach(el => {
      const color = _escapeHtml(String(el.color));
      const lw = _escapeHtml(String(el.lineWidth));
      switch (el.type) {
        case 'rect':
        case 'roundedRect':
          out += `  <div style="left:${el.x}px;top:${el.y}px;width:${el.w}px;height:${el.h}px;border:${lw}px solid ${color};${el.type === 'roundedRect' ? 'border-radius:12px;' : ''}${el.fill ? `background:${color}20;` : ''}"></div>\n`;
          break;
        case 'text':
          out += `  <p style="left:${el.x}px;top:${el.y}px;color:${color};font-size:${el.fontSize}px;white-space:pre-wrap;line-height:${el.fontSize + 4}px;">${_escapeHtml(el.value)}</p>\n`;
          break;
        case 'button':
          out += `  <button style="left:${el.x}px;top:${el.y}px;width:${el.w}px;height:${el.h}px;border:${lw}px solid ${color};border-radius:8px;background:${color}15;color:${color};font-family:inherit;cursor:pointer;">${_escapeHtml(el.label || 'Button')}</button>\n`;
          break;
        case 'input':
          out += `  <input placeholder="${_escapeHtml(el.label || 'Type here...')}" style="left:${el.x}px;top:${el.y}px;width:${el.w}px;height:${el.h}px;border:${lw}px solid ${color}80;border-radius:4px;padding:0 10px;font-family:inherit;"/>\n`;
          break;
        case 'imagePlaceholder':
          out += `  <div style="left:${el.x}px;top:${el.y}px;width:${el.w}px;height:${el.h}px;border:${lw}px solid ${color};display:flex;align-items:center;justify-content:center;color:${color}80;font-size:14px;">Image Placeholder</div>\n`;
          break;
        case 'image':
          out += `  <img src="${_escapeHtml(el.src)}" alt="" style="left:${el.x}px;top:${el.y}px;width:${el.w}px;height:${el.h}px;object-fit:fill;"/>\n`;
          break;
        case 'nav':
          out += `  <nav style="left:${el.x}px;top:${el.y}px;width:${el.w}px;height:${el.h}px;border:${lw}px solid ${color};display:flex;align-items:center;justify-content:space-between;padding:0 20px;"><span>${_escapeHtml(el.label || 'Logo')}</span><div style="display:flex;gap:20px;"><a href="#">Home</a><a href="#">About</a><a href="#">Contact</a></div></nav>\n`;
          break;
        case 'card':
          out += `  <div style="left:${el.x}px;top:${el.y}px;width:${el.w}px;height:${el.h}px;border:${lw}px solid ${color};border-radius:10px;overflow:hidden;"><div style="height:45%;background:${color}10;border-bottom:1px solid ${color}30;"></div><div style="padding:12px;"><h3 style="color:${color};">${_escapeHtml(el.label || 'Card Title')}</h3><p style="color:${color}60;margin-top:6px;">Description text</p></div></div>\n`;
          break;
      }
    });

    out += `</div>\n</body>\n</html>`;
    _downloadBlob('wireframe.html', new Blob([out], { type: 'text/html' }));
  }

  function json(elements) {
    const data = {
      version: 1,
      canvasSize: { w: CANVAS_W, h: CANVAS_H },
      elements,
    };
    _downloadBlob('wireframe.json', new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  }

  /* ── Validación de import ── */

  const HEX_COLOR = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i;
  // Solo data-URLs base64 de PNG/JPEG: evita javascript:/http: inyectados
  // por un JSON manipulado en los exports SVG/HTML
  const IMAGE_SRC = /^data:image\/(png|jpeg);base64,[a-z0-9+/=]+$/i;
  const ELEMENT_TYPES = Object.values(TOOLS).filter(t => t !== TOOLS.SELECT);

  function _isNum(v) {
    return typeof v === 'number' && isFinite(v);
  }

  /**
   * Valida un elemento importado: type conocido, color hex y campos
   * numéricos requeridos según el tipo. Un elemento inválido rompería
   * redraw() y con ello toda la app.
   */
  function isValidElement(el) {
    if (!el || typeof el !== 'object') return false;
    if (!ELEMENT_TYPES.includes(el.type)) return false;
    if (typeof el.color !== 'string' || !HEX_COLOR.test(el.color)) return false;
    if (!_isNum(el.lineWidth)) return false;
    // Campos opcionales comunes: DEBEN validarse aquí, antes de los return
    // tempranos por tipo (colocarlos más abajo los deja en zona muerta)
    // heads (doble punta): whitelist estricta; undefined ≡ 'end'
    if (el.heads !== undefined && el.heads !== 'end' && el.heads !== 'both') return false;
    // dash (trazo discontinuo): solo se serializa `true`
    if (el.dash !== undefined && el.dash !== true) return false;
    // label (etiqueta de componentes y flechas)
    if (el.label !== undefined && typeof el.label !== 'string') return false;
    if (el.type === 'pencil' || el.type === 'eraser') {
      return Array.isArray(el.points) && el.points.length > 0 &&
             el.points.every(p => p && _isNum(p.x) && _isNum(p.y));
    }
    if (el.type === 'line' || el.type === 'arrow') {
      return _isNum(el.x1) && _isNum(el.y1) && _isNum(el.x2) && _isNum(el.y2);
    }
    if (el.type === 'curveArrow') {
      return _isNum(el.x1) && _isNum(el.y1) && _isNum(el.x2) && _isNum(el.y2) &&
             _isNum(el.cx) && _isNum(el.cy);
    }
    if (el.type === 'image') {
      return _isNum(el.x) && _isNum(el.y) && _isNum(el.w) && _isNum(el.h) &&
             typeof el.src === 'string' && IMAGE_SRC.test(el.src);
    }
    if (el.type === 'text') {
      return _isNum(el.x) && _isNum(el.y) && typeof el.value === 'string' && _isNum(el.fontSize);
    }
    return _isNum(el.x) && _isNum(el.y) && _isNum(el.w) && _isNum(el.h);
  }

  /**
   * Import JSON — returns a Promise resolving to the element array, or null.
   * Los elementos inválidos se descartan avisando al usuario.
   */
  function importJSON() {
    return new Promise(resolve => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json';
      input.onchange = e => {
        const file = e.target.files[0];
        if (!file) return resolve(null);
        const reader = new FileReader();
        reader.onload = ev => {
          try {
            const data = JSON.parse(ev.target.result);
            if (!data || !Array.isArray(data.elements)) {
              alert('Archivo JSON inválido: falta el array "elements"');
              return resolve(null);
            }
            const valid = data.elements.filter(isValidElement);
            const discarded = data.elements.length - valid.length;
            if (discarded > 0) {
              alert(`Se descartaron ${discarded} elemento(s) inválido(s) del archivo`);
            }
            resolve(valid);
          } catch {
            alert('Archivo JSON inválido');
            resolve(null);
          }
        };
        reader.readAsText(file);
      };
      if (input.addEventListener) {
        input.addEventListener('cancel', () => resolve(null));
      }
      input.click();
    });
  }

  /* ── Utilities ── */

  function _escapeXml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function _escapeHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  return { png, jpg, svg, html, json, importJSON, isValidElement };
})();
