# ✎ SketchWire

**Wireframes y bocetos web con estética dibujada a mano — en tu navegador, sin instalar nada.**

![Vanilla JS](https://img.shields.io/badge/vanilla-JS-f7df1e?logo=javascript&logoColor=000)
![Sin dependencias](https://img.shields.io/badge/dependencias-0-brightgreen)
![Tests](https://img.shields.io/badge/tests-116%20%E2%9C%93-brightgreen)
![Licencia](https://img.shields.io/badge/licencia-MIT-blue)

SketchWire es una aplicación de wireframing sobre canvas escrita en JavaScript puro: **sin build, sin bundler, sin `node_modules`**. Abre `index.html` y dibuja.

---

## Características

### Dibujo
- ✏️ **Lápiz, líneas, flechas, formas** (rectángulo, redondeado, elipse) con trazo *sketchy* de aspecto manual — determinista: cada elemento guarda su semilla y no "tiembla" entre repintados.
- 🧩 **Componentes UI listos**: botón, input, imagen, navbar y tarjeta, con etiquetas editables (doble click).
- 🖼️ **Imágenes reales**: pega desde el portapapeles (`Ctrl/Cmd+V`) o arrastra archivos PNG/JPEG desde el escritorio.
- 📐 **Plantillas**: landing page, dashboard y formulario para empezar en un click.

### Flechas de nivel diagrama
- ↷ **Flechas curvas** con handle de curvatura: Shift al trazar la comba hacia el otro lado, `F` invierte el giro, `+`/`−` ajustan la intensidad, doble click en el handle la resetea.
- 🔀 **Curva en S** (`S`): cúbica con dos puntos de control.
- 🧲 **Conectores anclados**: suelta un extremo sobre un elemento y la flecha se pega a su borde — al mover o redimensionar el elemento, la flecha lo sigue.
- 🏷️ **Etiquetas sobre el trazo** (doble click), doble punta, trazo discontinuo, grosor por elemento y dirección invertible (`D`).

### Edición
- 👆 Selección múltiple (Shift+click, marquee, `Ctrl/Cmd+A`), mover, duplicar (`Ctrl/Cmd+D`), redimensionar con handles y nudge con flechas.
- ↩️ Undo/redo con historial de 50 pasos (`Ctrl+Z` / `Ctrl+Y` / `Cmd+Shift+Z`).
- 🧮 Cuadrícula con ajuste opcional (Alt lo desactiva al vuelo) y zoom 30–200%.
- 💾 **Autoguardado** en localStorage: tu trabajo sobrevive al refresco.

### Exportación
| Formato | Detalle |
|---------|---------|
| **PNG / JPG** | Imagen rasterizada del lienzo limpio |
| **SVG** | Vectorial escalable, fiel al render |
| **HTML** | Página editable con componentes reales + SVG incrustado para los trazos |
| **JSON** | Proyecto reutilizable — expórtalo e impórtalo después (con validación robusta) |

## Uso

No hay nada que instalar:

```bash
# Opción 1: abre index.html directamente en el navegador
open index.html

# Opción 2: sírvelo estáticamente
python3 -m http.server 8000   # → http://localhost:8000
```

## Atajos de teclado

| Atajo | Acción |
|-------|--------|
| `P` `L` `A` `U` `E` | Lápiz · Línea · Flecha · Flecha curva · Borrador |
| `R` `O` `C` | Rectángulo · Redondeado · Círculo |
| `T` `B` `I` `M` `N` `K` | Texto · Botón · Input · Imagen · Navbar · Tarjeta |
| `V` | Mover / seleccionar |
| `Ctrl+Z` / `Ctrl+Y` | Deshacer / rehacer |
| `Ctrl+D` / `Ctrl+A` | Duplicar / seleccionar todo |
| `Supr` / `Esc` | Borrar selección / deseleccionar |
| Flechas (+`Shift`) | Mover selección 1px (20px) |
| `F` / `D` / `S` | Invertir giro · invertir dirección · curva en S |
| `+` / `−` (+`Shift`) | Ajustar curvatura (fino) |
| `Ctrl+V` | Pegar imagen del portapapeles |

## Arquitectura

```
index.html          Shell de la app (scripts en orden de dependencia)
css/styles.css      Estilos (BEM, tema oscuro)
js/
├── config.js       Constantes: herramientas, colores, tamaños
├── sketchy.js      Primitivas de trazo manual (PRNG determinista por elemento)
├── renderer.js     Render por tipo de elemento + cuadrícula + selección
├── exporter.js     Export PNG/JPG/SVG/HTML/JSON + import validado
├── templates.js    Plantillas predefinidas
└── app.js          Controlador: estado, eventos, undo/redo, conectores
tests/              Suite con el runner nativo de Node (sin dependencias)
```

Principios de diseño:

- **Un solo estado fuente de verdad** (`state.elements`): objetos planos, serializables e inmutables — cada edición produce copias, lo que hace el undo trivial y el autoguardado gratuito.
- **Render determinista**: el jitter del estilo sketchy usa un PRNG sembrado por elemento; el mismo dibujo se repinta idéntico.
- **Import seguro**: todo JSON importado pasa por un validador por tipo de elemento (whitelists, colores hex, data-URLs de imagen restringidas) que además evita inyecciones en los archivos exportados.

## Tests

116 tests con el runner nativo de Node — sin ninguna dependencia:

```bash
node --test tests/                    # suite completa
node --test tests/exporter.test.js    # un archivo
```

Los módulos se cargan en un contexto `node:vm` con stubs de canvas/DOM (ver `tests/helpers/`). La hoja de ruta de mejoras vive en [`PLAN.md`](PLAN.md).

## Licencia

[MIT](LICENSE) © Javier Tamarit
