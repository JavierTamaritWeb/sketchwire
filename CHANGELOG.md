# Changelog

Los cambios notables de SketchWire se documentan en este archivo.
El formato sigue [Keep a Changelog](https://keepachangelog.com/es/1.1.0/) y el
versionado es [SemVer](https://semver.org/lang/es/).

## [1.1.0] — 2026-07-23

### Añadido
- **Herramienta Semicírculo** (`◠`, tecla `G`): dibuja arcos de 180° exactos
  y sin puntas de flecha. El arrastre fija el diámetro, así que cada trazo
  puede tener un radio distinto.
- Ajuste de **radio** de un semicírculo seleccionado con `+`/`−` (paso de
  5 px; `Shift`: 1 px) o arrastrando su handle turquesa — siempre conservando
  la media circunferencia perfecta (el centro del diámetro no se mueve).
- Tecla **`Q`**: convierte una flecha curva seleccionada en semicírculo
  (pierde la punta) y viceversa (la recupera).
- `js/arc.js` (`ArcMath`): geometría pura de arcos circulares — ajusta una
  Bézier cúbica al arco (error radial ≤ 1,7 % del radio, invisible bajo el
  trazo sketchy). Los semicírculos son elementos `curveArrow` normales con
  `arc: true`, por lo que exportación (PNG/JPG/SVG/HTML/JSON), selección,
  undo y conectores funcionan sin código específico.
- `heads: 'none'` en flechas: trazo sin punta en ningún extremo (usado por
  los semicírculos y validado en el import JSON).
- 10 tests nuevos (geometría de arcos, validación y export sin puntas):
  la suite pasa de 123 a 133.

### Cambiado
- La punta de las flechas curvas al desactivar un semicírculo con `Q` se
  restaura al valor por defecto (una punta).
- El checkbox "Doble punta" ignora los semicírculos (nunca llevan punta).

## [1.0.0] — 2026-07-22

Estado inicial versionado: dibujo sketchy determinista, componentes UI,
flechas curvas (cuadráticas y en S) con conectores anclados, etiquetas sobre
el trazo, plantillas, undo/redo, autoguardado, exportación PNG/JPG/SVG/HTML/
JSON con import validado y suite de 123 tests sin dependencias.
