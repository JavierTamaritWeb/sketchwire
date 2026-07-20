# PLAN.md — Plan de mejora de SketchWire

> Síntesis de 6 revisiones por dimensión (bugs, arquitectura, UX, exportación, accesibilidad, rendimiento), deduplicada y priorizada. Fecha: 2026-07-20.

## 1. Resumen ejecutivo

SketchWire es una app de wireframing en canvas, vanilla JS sin build ni dependencias, con una arquitectura sana en su núcleo (estado serializable único en `state.elements` + redraw completo) pero con varios bugs funcionales serios: el undo de un arrastre no revierte nada, el borrador corrompe los exports, el import JSON puede dejar la app inutilizable y el jitter aleatorio hace "temblar" todo el lienzo en cada redraw. Además carece de las capacidades básicas que un usuario de wireframing espera (autoguardado, redimensionar, duplicar, editar texto existente). El plan se organiza en tres fases: primero corregir lo roto (mayoría de fixes de bajo esfuerzo y muy localizados), después las mejoras de mayor valor por esfuerzo (persistencia, seed determinista, duplicar, atajos), y por último mejoras deseables (resize, selección múltiple, accesibilidad ampliada). Varios hallazgos de las revisiones se han rebajado o descartado por desproporcionados para una app de este tamaño (ver sección 5).

---

## 2. Fase 1 — Bugs y correcciones críticas

Objetivo: que lo que ya existe funcione correctamente. Todos los ítems son independientes entre sí y de riesgo bajo.

### 1.1 Arreglar el undo del arrastre y los snapshots fantasma
- **Prioridad:** alta · **Esfuerzo:** bajo · **Archivos:** `js/app.js`
- Reportado por 4 de 6 revisores. El snapshot se guarda en `onMouseUp` (app.js:221-231) DESPUÉS de que `onMouseMove` ya mutó `state.elements`: Ctrl+Z tras mover no revierte nada y la posición original se pierde. Además `saveUndo()` se llama en cada click de selección y en drags que no crean elemento (guard `w>3 && h>3`), llenando el stack de snapshots duplicados y destruyendo `redoStack`.
- Fix: capturar snapshot en `onMouseDown` al iniciar un drag sobre un elemento (con flag `didDrag` para confirmarlo solo si hubo movimiento real); mover el `saveUndo()` de creación a justo antes de cada `push` efectivo; descartar line/arrow con `hypot < ~4px` (hoy un click crea líneas de longitud 0 invisibles pero seleccionables).
- Incluir aquí dos mejoras triviales del mismo código: cap del stack (`if (undoStack.length > 50) undoStack.shift()`) y sustituir `clone()` (JSON round-trip, app.js:49-51) por `state.elements.slice()` — el código ya trata los elementos como inmutables (`moveElement` devuelve objeto nuevo), documentar esa disciplina en CLAUDE.md.

### 1.2 Borrador: excluirlo de la interacción y arreglar los exports
- **Prioridad:** alta · **Esfuerzo:** medio · **Archivos:** `js/app.js`, `js/exporter.js`, `js/renderer.js`
- El eraser con `destination-out` (renderer.js:181-193) produce: agujeros transparentes en PNG, manchas negras en JPG (transparencia sobre negro en `toDataURL('image/jpeg')`), reaparición de lo borrado en SVG/HTML (no hay case `eraser`), agujeros en la cuadrícula en pantalla, y trazos de borrador seleccionables/arrastrables con Select (mueven el "agujero": efecto absurdo).
- Fix por partes:
  - `hitTest`: saltar `type === 'eraser'` (1 línea).
  - PNG: en `_renderClean` el fondo blanco ya se pinta primero; el problema es que el eraser lo perfora. Pintar el fondo blanco en una segunda pasada final con `destination-over`, o repintar blanco tras renderizar (solución de ~3 líneas que arregla PNG y JPG a la vez).
  - SVG/HTML: emitir los trazos de eraser como paths blancos con `stroke-width = lineWidth*4` y `linecap round`. Es infiel en solapes sobre fills, pero aceptable; la `<mask>` SVG fiel se descarta por desproporcionada (ver §5).
  - Pantalla: en `redraw()` dibujar la cuadrícula DESPUÉS de los elementos con baja opacidad, o aceptar el agujero en grid como limitación conocida (decisión menor).

### 1.3 Validar el import JSON
- **Prioridad:** alta · **Esfuerzo:** medio · **Archivos:** `js/exporter.js`, `js/app.js`
- Reportado por 3 revisores. `importJSON` hace `resolve(data.elements || null)` sin validar (exporter.js:204-205): un JSON malformado (`elements` no-array, pencil sin `points`, coordenadas string) rompe `redraw()` y con ello TODA la app, porque todo pasa por redraw.
- Fix: validar `Array.isArray(data.elements)`; filtrar por elemento: `type` en `Object.values(TOOLS)`, `points` array de `{x,y}` numéricos para pencil/eraser, `x1/y1/x2/y2` numéricos para line/arrow, `x/y/w/h` numéricos para el resto, `color` con `/^#[0-9a-f]{6}$/i` (esto además resuelve el bug del alfa por concatenación `color+'20'` con colores no-#rrggbb), `value` string para text. Descartar inválidos y avisar cuántos. Como red de seguridad, envolver el `forEach` de `redraw()` (app.js:114) en try/catch por elemento.
- Incluir el fix menor de la Promise colgada al cancelar el picker: escuchar el evento `cancel` del input resolviendo `null`.

### 1.4 Escapar valores interpolados en los exports SVG/HTML
- **Prioridad:** alta · **Esfuerzo:** bajo · **Archivos:** `js/exporter.js`
- `el.color` y `el.lineWidth` se interpolan crudos en atributos (exporter.js:58, 154-172); un JSON importado malicioso inyecta markup ejecutable en el archivo exportado. `_escapeHtml` además no escapa comillas.
- Fix: pasar todo valor interpolado por `_escapeXml`/`_escapeHtml` (añadiendo `"` y `'` a `_escapeHtml`). La validación de color de 1.3 es la defensa principal; esto es defensa en profundidad y cuesta minutos.

### 1.5 Hit-test de líneas y flechas por distancia al segmento
- **Prioridad:** alta · **Esfuerzo:** bajo · **Archivos:** `js/app.js`
- Una diagonal larga tiene un bbox de media pantalla y roba todos los clicks de esa zona (app.js:69-92). Fix: distancia punto-segmento (proyección escalar clampada) con umbral `lineWidth/2 + 6`; bbox solo para el resto de tipos.

### 1.6 Posición del textarea de texto con zoom ≠ 100%
- **Prioridad:** alta · **Esfuerzo:** bajo · **Archivos:** `js/app.js`
- `showTextInput` multiplica por zoom dentro de un wrapper ya escalado por `transform: scale` (app.js:293-294): el textarea aparece lejos del click. Fix: `left = pos.x`, `top = pos.y` sin multiplicar, y quitar la división compensatoria en `commitText` (app.js:307-308).

### 1.7 Bounds reales para texto multilínea
- **Prioridad:** media · **Esfuerzo:** bajo · **Archivos:** `js/app.js`
- El bbox estimado (`value.length * fontSize * 0.55`, app.js:78) ignora los `\n`: altura de 1 línea y ancho absurdo para textos multilínea, imposibles de seleccionar bien. Fix (~6 líneas): split por `\n`, ancho = `measureText` de la línea más larga con el ctx ya disponible, alto = `nLineas * (fontSize + 4)`.

---

## 3. Fase 2 — Mejoras de alto valor

Ordenadas por ratio valor/esfuerzo.

### 2.1 Autoguardado en localStorage
- **Prioridad:** alta · **Esfuerzo:** bajo · **Archivos:** `js/app.js`
- Hoy un refresh pierde todo. `state.elements` ya es 100% serializable y el formato de proyecto existe (exporter.js:181-188). Fix (~20 líneas): `localStorage.setItem('sketchwire.autosave', ...)` con debounce ~500ms desde `saveUndo()`/`redraw()`, restauración en `init()` (pasando por el validador de 1.3), el botón Limpiar borra la clave. Es la mejora con mejor ratio valor/esfuerzo de todo el plan. **Depende de 1.3** (no perpetuar estado corrupto).

### 2.2 Jitter determinista con seed por elemento
- **Prioridad:** alta · **Esfuerzo:** medio · **Archivos:** `js/sketchy.js`, `js/renderer.js`, `js/app.js`
- Reportado por 2 revisores como el defecto perceptible nº 1: `Math.random()` en cada trazo + redraw completo por mousemove = todo el lienzo vibra al arrastrar un solo elemento. Fix: `el.seed = (Math.random()*2**31)|0` al crear (serializable, sobrevive al JSON), PRNG mulberry32 (~4 líneas) resembrado al inicio de `renderElement`, y las primitivas de Sketchy reciben la función `rand`. Bonus: geometría reproducible que abre la puerta a un SVG con la misma estética sketchy en el futuro.

### 2.3 Coalescer redraws con requestAnimationFrame
- **Prioridad:** alta · **Esfuerzo:** bajo · **Archivos:** `js/app.js`
- Los mousemove llegan a más frecuencia que el refresco; hoy cada uno redibuja 1200×800 completo. Fix: flag dirty + `requestAnimationFrame` (~6 líneas), aplicado al drag y al preview del overlay. Junto con 2.2 hace el arrastre fluido y estable.

### 2.4 Duplicar elemento (Ctrl/Cmd+D, Ctrl+C/V, botón)
- **Prioridad:** alta · **Esfuerzo:** bajo · **Archivos:** `js/app.js`, `index.html`
- Los wireframes son estructuras repetitivas y hoy hay que dibujar cada card a mano. Las piezas existen: `clone()` + `moveElement()`. Push del clon desplazado +15,+15, seleccionarlo, botón junto a `#btn-delete-sel`.

### 2.5 Atajos de teclado completos
- **Prioridad:** media · **Esfuerzo:** bajo · **Archivos:** `js/app.js`, `js/config.js`
- Ampliar el listener (app.js:486-500): tecla por herramienta (V/P/R/O/L/A/T/E, mostrada en el `title` del botón vía `TOOL_GROUPS`), flechas para nudge de 1px (20 con Shift), Escape para deseleccionar/cerrar modal, `Cmd+Shift+Z` como redo (en macOS Ctrl+Y no es estándar: hoy el redo es casi inaccesible), y comparar `e.key` en minúscula.

### 2.6 Editar texto existente y etiquetas de componentes
- **Prioridad:** alta · **Esfuerzo:** medio · **Archivos:** `js/app.js`, `js/renderer.js`, `js/exporter.js`
- No se puede rotular un botón como "Enviar" (etiquetas hardcodeadas en renderer.js: 'Button', 'Card Title', 'Logo/Home/About/Contact') ni editar un texto ya creado. Fix: doble click con Select sobre un `text` reabre `#text-input` prellenado; propiedad opcional `label` en button/input/card con fallback a la etiqueta actual, reflejada en canvas y en SVG/HTML.

### 2.7 Snap a la cuadrícula
- **Prioridad:** media · **Esfuerzo:** bajo · **Archivos:** `js/app.js`, `index.html`
- La rejilla de 20px es solo decorativa. Fix: `snap(v) = Math.round(v/20)*20` al crear shapes/componentes y al soltar un drag, checkbox 'Snap' junto a `#check-grid`, Alt lo desactiva temporalmente. No aplicar a pencil/eraser.

### 2.8 Pointer events + soporte táctil
- **Prioridad:** media · **Esfuerzo:** bajo-medio · **Archivos:** `js/app.js`, `css/styles.css`
- Sustituir mousedown/mousemove/mouseup/mouseleave por pointerdown/move/up con `setPointerCapture` (elimina el hack de `mouseleave` y de `e.buttons`), y `touch-action: none` en el canvas. `getPos()` funciona sin cambios. Habilita tablet/stylus con un diff pequeño.

### 2.9 Exports SVG/HTML: multilínea y tipos omitidos
- **Prioridad:** media · **Esfuerzo:** medio · **Archivos:** `js/exporter.js`
- (a) Texto multilínea colapsa a una línea: emitir un `<tspan>` por línea en SVG y `white-space:pre-wrap; line-height` en HTML. (b) El export HTML omite en silencio pencil/line/arrow/circle: incrustar un `<svg>` absoluto de 1200×800 dentro de `.wireframe` reutilizando la generación de paths del export SVG (o, como mínimo provisional, avisar al usuario de los tipos no exportados). (c) Añadir fallbacks de fuente (`SKETCHY_FONT` de config.js) al `@import` de Google Fonts en SVG/HTML.

### 2.10 Accesibilidad básica de controles
- **Prioridad:** media · **Esfuerzo:** bajo · **Archivos:** `js/app.js`, `index.html`, `css/styles.css`
- Lo barato y de impacto real: swatches de color como `<button>` con `aria-label` y `aria-pressed` (hoy son `<div>` invisibles al teclado); `aria-pressed` en los botones de herramienta + `role="toolbar"`; reemplazar `outline: none` por `:focus-visible`; migrar los dos modales a `<dialog>` nativo con `showModal()` (da foco, trampa de Tab y Escape gratis, y encaja con el enfoque sin dependencias); aclarar `--text-muted`/`--text-dim` para pasar AA y subir las etiquetas de 8-9px a ≥11px.

---

## 4. Fase 3 — Mejoras deseables

### 3.1 Redimensionar elementos con handles
- **Prioridad:** alta (en valor) · **Esfuerzo:** alto · **Archivos:** `js/app.js`, `js/renderer.js`
- El gap funcional más grande de la app: ajustar un botón obliga a borrar y redibujar. Dibujar handles (mínimo 4 esquinas) en `drawSelection`, detectarlos en `onMouseDown` antes del hitTest, escalar `x/y/w/h` (line/arrow: mover extremos; pencil: escalar points). `getElementBounds` ya normaliza los bounds de todos los tipos. Va en Fase 3 solo por esfuerzo; si se prioriza valor puro, puede adelantarse.

### 3.2 Registro central de tipos de elemento
- **Prioridad:** media · **Esfuerzo:** alto · **Archivos:** nuevo `js/element-types.js`, `js/renderer.js`, `js/exporter.js`, `js/app.js`
- Añadir un tipo hoy exige tocar 5 sitios en sincronía (fricción documentada en CLAUDE.md:34) y olvidar uno falla en silencio. Un registro `ElementTypes = { rect: { bounds, render, toSVG, toHTML, defaults } }` cargado entre sketchy y renderer reduce eso a 1 entrada + su botón. Hacerlo DESPUÉS de la Fase 1-2: refactorizar antes de arreglar los cases existentes duplicaría trabajo. Es la inversión correcta si se planea añadir tipos; si el catálogo va a quedarse como está, es opcional.

### 3.3 Selección múltiple (marquee + Shift+click)
- **Prioridad:** media · **Esfuerzo:** alto · **Archivos:** `js/app.js`
- Cambiar `selectedIdx` por un Set, marquee en el overlay, mover/borrar/duplicar iterando la selección. Toca los ~8 puntos que hoy asignan `selectedIdx`; conviene hacer antes el helper `setSelection()` (3.5) para reducir la superficie del cambio.

### 3.4 Decimación del trazo de lápiz
- **Prioridad:** media · **Esfuerzo:** bajo · **Archivos:** `js/app.js`
- Descartar puntos a <2px del anterior al capturar (reduce el path 3-5x sin cambio visual) y preview incremental (dibujar solo el último segmento en vez de limpiar y repintar todo el path). Abarata redraw, hitTest y undo de golpe.

### 3.5 Centralizar la sincronización de selección y unificar idioma
- **Prioridad:** baja · **Esfuerzo:** bajo · **Archivos:** `js/app.js`, `js/config.js`, `index.html`
- (a) El trío `selectedIdx = null; hidden = true; redraw()` está repetido en 7 sitios: mover `$('btn-delete-sel').hidden = state.selectedIdx === null` dentro de `redraw()` y borrar las copias (redraw ya actualiza `el-count`, es la vía establecida). (b) La UI mezcla español e inglés pese a `lang="es"` ('Draw/Shapes/Undo/Redo' vs 'Lápiz/Borrador/Importar'): unificar a español; un objeto `STRINGS` en config.js es suficiente, i18n real sería sobre-ingeniería.

### 3.6 Estado observable para tecnología asistiva
- **Prioridad:** baja · **Esfuerzo:** bajo · **Archivos:** `index.html`, `js/app.js`
- `aria-label` en `#main-canvas`, `aria-hidden` en el overlay, y un `aria-live="polite"` en la sección de Elementos que anuncie recuentos y acciones. El dibujo por teclado no es viable a corto plazo; al menos el estado debe ser observable.

### 3.7 Media query mínima y scroll del canvas
- **Prioridad:** baja · **Esfuerzo:** medio · **Archivos:** `css/styles.css`
- Con sidebar 72px + panel 220px + canvas 1200px hay overflow en portátiles de 1280px, y el centrado flex + `overflow:auto` deja la esquina superior-izquierda inalcanzable por scroll. Fix: `margin: auto` en el wrapper (respeta el scroll) y una `@media (max-width: ~1100px)` que colapse el panel derecho.

---

## 5. Hallazgos descartados o rebajados (y por qué)

- **Migración a ES modules / namespace `window.SW`** (arquitectura): descartado. Son 6 archivos con orden documentado en CLAUDE.md que no ha causado bugs reales; migrar rompería el doble-click sobre `index.html` (file://) a cambio de un beneficio teórico. Reconsiderar solo si el proyecto crece en archivos.
- **`<mask>` SVG fiel para el eraser** (exportación, esfuerzo alto): rebajado a trazos blancos (§1.2). La máscara es la traducción correcta pero desproporcionada; si la fidelidad del eraser importa tanto, la solución de fondo es cambiar la semántica del borrador (borrar objetos, no píxeles), que sería otro proyecto.
- **Incrustar la fuente como data: URI en SVG** (exportación): descartado; los fallbacks de `SKETCHY_FONT` (§2.9c) resuelven el 90% del problema sin engordar cada export en cientos de KB.
- **Optimizar `moveElement` acumulando dx/dy** (rendimiento, el propio revisor la marca de bajo impacto): descartado como ítem propio; el rAF (§2.3) y la decimación (§3.4) atacan el mismo síntoma con mejor ratio.
- **Grid pre-renderizado a canvas offscreen / background CSS** (rendimiento): rebajado. Tras el rAF de §2.3 el coste del grid por frame deja de ser relevante; si aún se quisiera, la versión mínima (agrupar líneas en 2 strokes) son 5 minutos, pero no es prioritaria.
- **Cachear bounds en el elemento** (rendimiento): descartado; especulativo sin evidencia de coste real en documentos típicos, y añade estado derivado que puede desincronizarse.

---

## 6. Estrategia de tests

La app no tiene tests ni build. Sin introducir bundler se puede montar un runner mínimo con Node (`node --test`) cargando los archivos fuente con stubs de globals, porque casi todo el código es lógica pura sobre objetos planos.

### Testeable sin navegador (Node + stubs)

- **`config.js` y `templates.js`** — sin stub alguno: cargar y verificar invariantes. Cada entrada de `TOOL_GROUPS` referencia un id de `TOOLS`; cada elemento de cada template tiene `type` válido y campos requeridos por tipo, y cae dentro de `CANVAS_W×CANVAS_H`. Estos tests actúan además de contrato para el validador de import (§1.3): validador y templates deben aceptar/producir lo mismo.
- **Validador de import JSON** (§1.3) — la pieza más rentable de testear: es función pura entrada→salida. Casos: `elements` no-array, pencil sin points, coordenadas string, color inválido, elemento con type desconocido, JSON válido intacto, y round-trip `Exporter.json` → validador → mismos elementos.
- **`exporter.js` SVG/HTML** — con un stub de DOM de ~15 líneas (`document.createElement` que devuelva `{click(){}, set href/download}`) o testeando directamente las funciones internas de generación de markup si se exponen. Verificar: cada `type` de `TOOLS` produce salida (hoy el HTML omite 5 tipos en silencio: el test lo habría cazado), escapado de `value`/`color` con payloads de inyección, multilínea genera N `<tspan>`, salida estable dado un seed fijo (tras §2.2).
- **`sketchy.js`** — con un ctx stub que grabe llamadas (`{moveTo(), lineTo(), stroke(), ...}` acumulando en un array). Verificar: número de llamadas esperado por primitiva, coordenadas dentro de bounds ± jitter máximo, y —tras §2.2— determinismo: mismo seed ⇒ misma secuencia exacta de llamadas. Ese test de determinismo es el guardián de la reproducibilidad del render.
- **Lógica de `app.js` hoy encerrada en el IIFE** — `getElementBounds`, `hitTest` (incluida la nueva distancia punto-segmento con casos: click sobre el segmento, click dentro del bbox pero lejos de la diagonal), `moveElement`, `snap`, y la disciplina de undo (secuencia crear→mover→undo→estado original). Requiere exponer estas funciones (p. ej. `window.__test` condicional o extraerlas a un `js/geometry.js` cargado antes de app.js, que es la opción limpia).

### Requiere pruebas manuales (navegador)

- Interacción de ratón/puntero real: drag, preview en overlay, doble click de edición, handles de resize, snap con Alt.
- Zoom por CSS transform y posicionamiento del textarea (§1.6) — depende de layout real.
- Render visual: estética sketchy, composición `destination-out` del eraser, grid. Un smoke test razonable es comparar hashes de `canvas.toDataURL()` con seed fijo (posible con Playwright si algún día se quiere automatizar; manual mientras tanto).
- Export PNG/JPG (canvas → toDataURL con fuentes cargadas), descarga de archivos, picker de import y su cancelación.
- localStorage/autosave entre recargas, atajos de teclado por SO (Cmd vs Ctrl), lector de pantalla y navegación por teclado.

**Checklist manual mínima post-cambio** (mientras no haya automatización): dibujar uno de cada tipo → mover → undo ×2 → redo → borrar con eraser → exportar PNG/JPG/SVG/HTML/JSON → importar el JSON → verificar que el lienzo es idéntico y el contador coincide.
