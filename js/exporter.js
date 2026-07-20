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

    elements.forEach(el => {
      const s = `stroke="${el.color}" stroke-width="${el.lineWidth}" fill="none" stroke-linecap="round"`;

      switch (el.type) {
        case 'pencil':
          if (el.points.length > 1) {
            const d = el.points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`).join(' ');
            out += `<path d="${d}" ${s}/>\n`;
          }
          break;

        case 'line':
          out += `<line x1="${el.x1}" y1="${el.y1}" x2="${el.x2}" y2="${el.y2}" ${s}/>\n`;
          break;

        case 'arrow': {
          out += `<line x1="${el.x1}" y1="${el.y1}" x2="${el.x2}" y2="${el.y2}" ${s}/>\n`;
          const a = Math.atan2(el.y2 - el.y1, el.x2 - el.x1);
          const hl = 14;
          out += `<line x1="${el.x2}" y1="${el.y2}" x2="${el.x2 - hl * Math.cos(a - 0.4)}" y2="${el.y2 - hl * Math.sin(a - 0.4)}" ${s}/>\n`;
          out += `<line x1="${el.x2}" y1="${el.y2}" x2="${el.x2 - hl * Math.cos(a + 0.4)}" y2="${el.y2 - hl * Math.sin(a + 0.4)}" ${s}/>\n`;
          break;
        }

        case 'rect':
          out += `<rect x="${el.x}" y="${el.y}" width="${el.w}" height="${el.h}" ${s}${el.fill ? ` fill="${el.color}20"` : ''}/>\n`;
          break;

        case 'roundedRect':
          out += `<rect x="${el.x}" y="${el.y}" width="${el.w}" height="${el.h}" rx="12" ${s}${el.fill ? ` fill="${el.color}20"` : ''}/>\n`;
          break;

        case 'circle':
          out += `<ellipse cx="${el.x + el.w / 2}" cy="${el.y + el.h / 2}" rx="${Math.abs(el.w) / 2}" ry="${Math.abs(el.h) / 2}" ${s}${el.fill ? ` fill="${el.color}20"` : ''}/>\n`;
          break;

        case 'text':
          out += `<text x="${el.x}" y="${el.y + el.fontSize}" fill="${el.color}" font-family="Architects Daughter, cursive" font-size="${el.fontSize}">${_escapeXml(el.value)}</text>\n`;
          break;

        // UI components → simple rects with labels in SVG
        case 'button':
          out += `<rect x="${el.x}" y="${el.y}" width="${el.w}" height="${el.h}" rx="8" ${s} fill="${el.color}15"/>\n`;
          out += `<text x="${el.x + el.w / 2}" y="${el.y + el.h / 2 + 5}" fill="${el.color}" font-family="Architects Daughter, cursive" font-size="14" text-anchor="middle">Button</text>\n`;
          break;

        case 'input':
          out += `<rect x="${el.x}" y="${el.y}" width="${el.w}" height="${el.h}" rx="4" stroke="${el.color}80" stroke-width="${el.lineWidth}" fill="none"/>\n`;
          out += `<text x="${el.x + 10}" y="${el.y + el.h / 2 + 4}" fill="${el.color}60" font-family="Architects Daughter, cursive" font-size="13">Type here...</text>\n`;
          break;

        case 'imagePlaceholder':
          out += `<rect x="${el.x}" y="${el.y}" width="${el.w}" height="${el.h}" ${s}/>\n`;
          out += `<line x1="${el.x}" y1="${el.y}" x2="${el.x + el.w}" y2="${el.y + el.h}" ${s} stroke-dasharray="6 4"/>\n`;
          out += `<line x1="${el.x + el.w}" y1="${el.y}" x2="${el.x}" y2="${el.y + el.h}" ${s} stroke-dasharray="6 4"/>\n`;
          break;

        case 'nav':
          out += `<rect x="${el.x}" y="${el.y}" width="${el.w}" height="${el.h}" ${s} fill="${el.color}0a"/>\n`;
          out += `<text x="${el.x + 20}" y="${el.y + el.h / 2 + 4}" fill="${el.color}" font-family="Architects Daughter, cursive" font-size="12">Logo</text>\n`;
          break;

        case 'card':
          out += `<rect x="${el.x}" y="${el.y}" width="${el.w}" height="${el.h}" rx="10" ${s}/>\n`;
          out += `<line x1="${el.x + 4}" y1="${el.y + el.h * 0.45 + 4}" x2="${el.x + el.w - 4}" y2="${el.y + el.h * 0.45 + 4}" ${s}/>\n`;
          out += `<text x="${el.x + 12}" y="${el.y + el.h * 0.45 + 24}" fill="${el.color}" font-family="Architects Daughter, cursive" font-size="14" font-weight="bold">Card Title</text>\n`;
          break;
      }
    });

    out += '</svg>';
    _downloadBlob('wireframe.svg', new Blob([out], { type: 'image/svg+xml' }));
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
body { font-family: 'Architects Daughter', cursive; background: #fff; }
.wireframe { position: relative; width: ${CANVAS_W}px; height: ${CANVAS_H}px; margin: 20px auto; border: 1px solid #ccc; }
.wireframe > * { position: absolute; }
</style>
</head>
<body>
<div class="wireframe">
`;

    elements.forEach(el => {
      switch (el.type) {
        case 'rect':
        case 'roundedRect':
          out += `  <div style="left:${el.x}px;top:${el.y}px;width:${el.w}px;height:${el.h}px;border:${el.lineWidth}px solid ${el.color};${el.type === 'roundedRect' ? 'border-radius:12px;' : ''}${el.fill ? `background:${el.color}20;` : ''}"></div>\n`;
          break;
        case 'text':
          out += `  <p style="left:${el.x}px;top:${el.y}px;color:${el.color};font-size:${el.fontSize}px;">${_escapeHtml(el.value)}</p>\n`;
          break;
        case 'button':
          out += `  <button style="left:${el.x}px;top:${el.y}px;width:${el.w}px;height:${el.h}px;border:${el.lineWidth}px solid ${el.color};border-radius:8px;background:${el.color}15;color:${el.color};font-family:inherit;cursor:pointer;">Button</button>\n`;
          break;
        case 'input':
          out += `  <input placeholder="Type here..." style="left:${el.x}px;top:${el.y}px;width:${el.w}px;height:${el.h}px;border:${el.lineWidth}px solid ${el.color}80;border-radius:4px;padding:0 10px;font-family:inherit;"/>\n`;
          break;
        case 'imagePlaceholder':
          out += `  <div style="left:${el.x}px;top:${el.y}px;width:${el.w}px;height:${el.h}px;border:${el.lineWidth}px solid ${el.color};display:flex;align-items:center;justify-content:center;color:${el.color}80;font-size:14px;">Image Placeholder</div>\n`;
          break;
        case 'nav':
          out += `  <nav style="left:${el.x}px;top:${el.y}px;width:${el.w}px;height:${el.h}px;border:${el.lineWidth}px solid ${el.color};display:flex;align-items:center;justify-content:space-between;padding:0 20px;"><span>Logo</span><div style="display:flex;gap:20px;"><a href="#">Home</a><a href="#">About</a><a href="#">Contact</a></div></nav>\n`;
          break;
        case 'card':
          out += `  <div style="left:${el.x}px;top:${el.y}px;width:${el.w}px;height:${el.h}px;border:${el.lineWidth}px solid ${el.color};border-radius:10px;overflow:hidden;"><div style="height:45%;background:${el.color}10;border-bottom:1px solid ${el.color}30;"></div><div style="padding:12px;"><h3 style="color:${el.color};">Card Title</h3><p style="color:${el.color}60;margin-top:6px;">Description text</p></div></div>\n`;
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

  /**
   * Import JSON — returns a Promise resolving to the element array, or null.
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
            resolve(data.elements || null);
          } catch {
            alert('Archivo JSON inválido');
            resolve(null);
          }
        };
        reader.readAsText(file);
      };
      input.click();
    });
  }

  /* ── Utilities ── */

  function _escapeXml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function _escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  return { png, jpg, svg, html, json, importJSON };
})();
