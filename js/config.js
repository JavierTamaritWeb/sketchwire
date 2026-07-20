/* ============================================================
   config.js — Constants & tool definitions
   ============================================================ */

const TOOLS = Object.freeze({
  PENCIL:           'pencil',
  LINE:             'line',
  RECT:             'rect',
  ROUNDED_RECT:     'roundedRect',
  CIRCLE:           'circle',
  ARROW:            'arrow',
  TEXT:             'text',
  ERASER:           'eraser',
  SELECT:           'select',
  IMAGE_PLACEHOLDER:'imagePlaceholder',
  BUTTON:           'button',
  INPUT:            'input',
  NAV:              'nav',
  CARD:             'card',
});

const TOOL_GROUPS = [
  {
    label: 'Draw',
    tools: [
      { id: TOOLS.PENCIL, icon: '✏️', name: 'Lápiz' },
      { id: TOOLS.LINE,   icon: '📏', name: 'Línea' },
      { id: TOOLS.ARROW,  icon: '➡️', name: 'Flecha' },
      { id: TOOLS.ERASER, icon: '🧽', name: 'Borrador' },
    ],
  },
  {
    label: 'Shapes',
    tools: [
      { id: TOOLS.RECT,         icon: '◻️', name: 'Rectángulo' },
      { id: TOOLS.ROUNDED_RECT, icon: '▢',  name: 'Rounded' },
      { id: TOOLS.CIRCLE,       icon: '⬭',  name: 'Círculo' },
    ],
  },
  {
    label: 'UI',
    tools: [
      { id: TOOLS.TEXT,              icon: 'T',  name: 'Texto' },
      { id: TOOLS.BUTTON,           icon: '🔘', name: 'Botón' },
      { id: TOOLS.INPUT,            icon: '▭',  name: 'Input' },
      { id: TOOLS.IMAGE_PLACEHOLDER,icon: '🖼️', name: 'Imagen' },
      { id: TOOLS.NAV,              icon: '☰',  name: 'Navbar' },
      { id: TOOLS.CARD,             icon: '🃏', name: 'Card' },
    ],
  },
  {
    label: 'Edit',
    tools: [
      { id: TOOLS.SELECT, icon: '👆', name: 'Mover' },
    ],
  },
];

const COLORS = [
  '#1a1a2e', '#16213e', '#0f3460', '#533483',
  '#e94560', '#f39c12', '#27ae60', '#2980b9',
  '#8e44ad', '#c0392b', '#1abc9c', '#e74c3c',
  '#3498db', '#2ecc71', '#f1c40f', '#95a5a6',
  '#ecf0f1', '#ffffff',
];

const CANVAS_W = 1200;
const CANVAS_H = 800;

const SKETCHY_FONT = "'Architects Daughter', 'Segoe Print', 'Comic Neue', cursive";

/** Default dimensions when a UI component is placed with a tiny drag */
const UI_DEFAULTS = {
  [TOOLS.BUTTON]:            { w: 120, h: 40 },
  [TOOLS.INPUT]:             { w: 220, h: 36 },
  [TOOLS.IMAGE_PLACEHOLDER]: { w: 200, h: 150 },
  [TOOLS.NAV]:               { w: 600, h: 50 },
  [TOOLS.CARD]:              { w: 220, h: 280 },
};
