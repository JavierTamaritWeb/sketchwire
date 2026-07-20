/* ============================================================
   templates.js — Predefined wireframe templates
   ============================================================ */

const Templates = (() => {
  const C  = '#1a1a2e';
  const LW = 2;

  const all = {

    landing: [
      { type: 'nav', x: 0, y: 0, w: 1200, h: 50, color: C, lineWidth: LW },
      { type: 'text', x: 80, y: 120, value: 'Hero Headline', color: C, fontSize: 36, lineWidth: LW },
      { type: 'text', x: 80, y: 170, value: 'Subheading text goes here with a brief description', color: C + '80', fontSize: 16, lineWidth: LW },
      { type: 'button', x: 80, y: 210, w: 160, h: 44, color: C, lineWidth: LW },
      { type: 'imagePlaceholder', x: 600, y: 90, w: 500, h: 300, color: C, lineWidth: LW },
      { type: 'text', x: 80, y: 440, value: 'Features', color: C, fontSize: 24, lineWidth: LW },
      { type: 'card', x: 80, y: 480, w: 300, h: 280, color: C, lineWidth: LW },
      { type: 'card', x: 420, y: 480, w: 300, h: 280, color: C, lineWidth: LW },
      { type: 'card', x: 760, y: 480, w: 300, h: 280, color: C, lineWidth: LW },
    ],

    dashboard: [
      { type: 'nav', x: 0, y: 0, w: 1200, h: 50, color: C, lineWidth: LW },
      { type: 'rect', x: 0, y: 50, w: 220, h: 750, color: C, lineWidth: LW, fill: false },
      { type: 'text', x: 20, y: 70,  value: 'Menu Item 1', color: C, fontSize: 14, lineWidth: LW },
      { type: 'text', x: 20, y: 100, value: 'Menu Item 2', color: C, fontSize: 14, lineWidth: LW },
      { type: 'text', x: 20, y: 130, value: 'Menu Item 3', color: C, fontSize: 14, lineWidth: LW },
      { type: 'text', x: 20, y: 160, value: 'Menu Item 4', color: C, fontSize: 14, lineWidth: LW },
      { type: 'roundedRect', x: 250, y: 70,  w: 200, h: 100, color: '#2980b9', lineWidth: LW, fill: true },
      { type: 'roundedRect', x: 480, y: 70,  w: 200, h: 100, color: '#27ae60', lineWidth: LW, fill: true },
      { type: 'roundedRect', x: 710, y: 70,  w: 200, h: 100, color: '#e94560', lineWidth: LW, fill: true },
      { type: 'roundedRect', x: 940, y: 70,  w: 200, h: 100, color: '#f39c12', lineWidth: LW, fill: true },
      { type: 'rect', x: 250, y: 200, w: 560, h: 350, color: C, lineWidth: LW, fill: false },
      { type: 'text', x: 270, y: 210, value: 'Chart Area', color: C, fontSize: 16, lineWidth: LW },
      { type: 'rect', x: 840, y: 200, w: 300, h: 350, color: C, lineWidth: LW, fill: false },
      { type: 'text', x: 860, y: 210, value: 'Activity Feed', color: C, fontSize: 16, lineWidth: LW },
    ],

    form: [
      { type: 'text', x: 350, y: 40, value: 'Contact Form', color: C, fontSize: 28, lineWidth: LW },
      { type: 'roundedRect', x: 300, y: 90, w: 600, h: 650, color: C, lineWidth: LW, fill: false },
      { type: 'text',  x: 340, y: 120, value: 'Name',    color: C, fontSize: 14, lineWidth: LW },
      { type: 'input', x: 340, y: 142, w: 520, h: 36,    color: C, lineWidth: LW },
      { type: 'text',  x: 340, y: 200, value: 'Email',   color: C, fontSize: 14, lineWidth: LW },
      { type: 'input', x: 340, y: 222, w: 520, h: 36,    color: C, lineWidth: LW },
      { type: 'text',  x: 340, y: 280, value: 'Subject', color: C, fontSize: 14, lineWidth: LW },
      { type: 'input', x: 340, y: 302, w: 520, h: 36,    color: C, lineWidth: LW },
      { type: 'text',  x: 340, y: 360, value: 'Message', color: C, fontSize: 14, lineWidth: LW },
      { type: 'rect',  x: 340, y: 382, w: 520, h: 180,   color: C, lineWidth: LW, fill: false },
      { type: 'button', x: 340, y: 590, w: 520, h: 48,   color: C, lineWidth: LW },
    ],
  };

  function get(name) {
    return JSON.parse(JSON.stringify(all[name] || []));
  }

  return { get };
})();
