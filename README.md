# ✎ Pizarra

**Crea wireframes, diagramas y bocetos con estilo dibujado a mano, directamente en tu navegador.**

![Versión](https://img.shields.io/badge/versi%C3%B3n-1.2.0-blueviolet)
![Vanilla JS](https://img.shields.io/badge/vanilla-JS-f7df1e?logo=javascript&logoColor=000)
![Sin dependencias](https://img.shields.io/badge/dependencias-0-brightgreen)
![Tests](https://img.shields.io/badge/tests-133%20%E2%9C%93-brightgreen)
![Licencia](https://img.shields.io/badge/licencia-MIT-blue)

Pizarra es una aplicación de wireframing sobre canvas escrita en JavaScript puro: **sin build, sin bundler y sin `node_modules`**. Permite crear bocetos, diagramas y prototipos rápidos directamente en el navegador.

---

## Características

### Dibujo
- ✏️ **Lápiz, líneas, flechas, formas** (rectángulo, redondeado, elipse) con trazo *sketchy* de aspecto manual — determinista: cada elemento guarda su semilla y no "tiembla" entre repintados.
- ◠ **Semicírculos** de 180° exactos y sin puntas: el arrastre fija el diámetro (y con él el radio); después `+`/`−` o su handle ajustan el radio manteniendo la media circunferencia perfecta. `Q` convierte una flecha curva existente en semicírculo y viceversa.
- 🧩 **Componentes UI listos**: botón, input, imagen, navbar y tarjeta, con etiquetas editables (doble click).
- 🖼️ **Imágenes reales**: pega desde el portapapeles (`Ctrl/Cmd+V`) o arrastra archivos PNG/JPEG desde el escritorio.
- 📐 **Plantillas**: landing page, dashboard y formulario para empezar en un click.

### Flechas de nivel diagrama
- ↷ **Flechas curvas** con handle de curvatura: Shift al trazar la comba hacia el otro lado, `F` invierte el giro, `+`/`−` ajustan la intensidad, doble click en el handle la resetea.
- 🔀 **Curva en S** (`S`): cúbica con dos puntos de control.
- 🧲 **Conectores anclados**: suelta un extremo sobre un elemento y la flecha se pega a su borde — al mover o redimensionar el elemento, la flecha lo sigue conservando su curvatura.
- 🏷️ **Etiquetas sobre el trazo** (doble click), desplazables a lo largo del trazo (arrastra su handle; doble click en él la re-centra), doble punta, trazo discontinuo, grosor por elemento y dirección invertible (`D`).

### Edición
- 👆 Selección múltiple (Shift+click, marquee, `Ctrl/Cmd+A`), mover, duplicar (`Ctrl/Cmd+D`), redimensionar con handles y nudge con flechas.
- 📋 **Copiar y pegar** la selección con `Ctrl/Cmd+C` / `Ctrl/Cmd+V` — también entre pestañas. Lo pegado aparece desplazado, queda seleccionado y las flechas ancladas se re-vinculan a sus clones.
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

## Inicio rápido

Puedes clonar el repositorio y abrir la aplicación directamente:

```bash
git clone https://github.com/JavierTamaritWeb/pizarra.git
cd pizarra
open index.html
```

También puedes servirla localmente para acceder desde `http://localhost:8000`:

```bash
python3 -m http.server 8000
```

No es necesario instalar dependencias ni ejecutar un proceso de compilación.

## Cómo usar Pizarra

1. Elige una herramienta en la barra lateral o usa su atajo de teclado.
2. Dibuja sobre el lienzo; con **Mover** (`V`) puedes seleccionar, desplazar, redimensionar y duplicar elementos.
3. Personaliza el color, grosor, relleno, cuadrícula y zoom desde el panel derecho.
4. Exporta el resultado como PNG, JPG, SVG o HTML, o guarda el proyecto como JSON para continuar más tarde.

Pizarra guarda automáticamente el lienzo en `localStorage`. Para crear una copia portátil o trabajar en otro navegador, exporta el proyecto como JSON y vuelve a importarlo cuando lo necesites.

## Atajos de teclado

| Atajo | Acción |
|-------|--------|
| `P` `L` `A` `U` `G` `E` | Lápiz · Línea · Flecha · Flecha curva · Semicírculo · Borrador |
| `R` `O` `C` | Rectángulo · Redondeado · Círculo |
| `T` `B` `I` `M` `N` `K` | Texto · Botón · Input · Imagen · Navbar · Tarjeta |
| `V` | Mover / seleccionar |
| `Ctrl/Cmd+Z` / `Ctrl+Y` o `Cmd+Shift+Z` | Deshacer / rehacer |
| `Ctrl/Cmd+D` / `Ctrl/Cmd+A` | Duplicar / seleccionar todo |
| `Supr` / `Esc` | Borrar selección / deseleccionar |
| Flechas (+`Shift`) | Mover selección 1px (20px) |
| `F` / `D` / `S` | Invertir giro · invertir dirección · curva en S |
| `Q` | Convertir flecha curva ↔ semicírculo |
| `+` / `−` (+`Shift`) | Ajustar curvatura — en semicírculos, el radio (fino) |
| `Ctrl/Cmd+C` / `Ctrl/Cmd+V` | Copiar selección / pegarla (o pegar imagen del portapapeles) |

## Arquitectura

```
index.html          Shell de la app (scripts en orden de dependencia)
css/styles.css      Estilos (BEM, tema oscuro)
js/
├── config.js       Constantes: herramientas, colores, tamaños
├── sketchy.js      Primitivas de trazo manual (PRNG determinista por elemento)
├── arc.js          Geometría de arcos circulares (ajuste de cúbica a semicírculo)
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

133 tests con el runner nativo de Node — sin ninguna dependencia:

```bash
node --test tests/                    # suite completa
node --test tests/exporter.test.js    # un archivo
```

Los módulos se cargan en un contexto `node:vm` con stubs de canvas/DOM (ver `tests/helpers/`). La hoja de ruta de mejoras vive en [`PLAN.md`](PLAN.md) y el historial de versiones en [`CHANGELOG.md`](CHANGELOG.md).

## Licencia

[MIT](LICENSE) © Javier Tamarit
