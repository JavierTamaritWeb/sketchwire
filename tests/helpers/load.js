'use strict';
/* ============================================================
   load.js — Carga los scripts globales del proyecto (sin módulos)
   en un contexto node:vm compartido, con stubs de DOM mínimos.

   API:
     load(...files)            -> context   (crea contexto, antepone
                                            'js/config.js' si falta, carga
                                            en orden y devuelve el contexto)
     loadAll()                 -> context   (config, sketchy, renderer,
                                            exporter, templates — en orden)
     createContext()           -> context   (contexto vacío solo con stubs)
     loadScript(context, file) -> context   (carga un archivo más en el
                                            mismo contexto; file relativo a
                                            la raíz del proyecto o absoluto)
     getGlobal(context, name)  -> any       (lee cualquier binding global
                                            del contexto, incluidos const)
     createCtxStub()           -> ctx       (re-export de ctx-stub.js)

   El contexto devuelto expone como propiedades: TOOLS, TOOL_GROUPS,
   COLORS, CANVAS_W, CANVAS_H, SKETCHY_FONT, UI_DEFAULTS, Sketchy,
   Renderer, Exporter, Templates (según qué archivos se hayan cargado),
   más los stubs: document, Blob, URL, alert, FileReader, createCtxStub,
   y los registros: context.alerts (mensajes de alert),
   context.document.created (elementos creados por createElement),
   context.URL.blobs (blobs pasados a createObjectURL).
   ============================================================ */

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createCtxStub } = require('./ctx-stub.js');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

/** Globals conocidos que se copian a globalThis tras cada carga
    (los `const` top-level de un script vm no cuelgan de globalThis solos). */
const KNOWN_GLOBALS = [
  'TOOLS', 'TOOL_GROUPS', 'COLORS', 'CANVAS_W', 'CANVAS_H',
  'SKETCHY_FONT', 'UI_DEFAULTS',
  'Sketchy', 'Renderer', 'Exporter', 'Templates',
];

/** Orden completo de dependencias del proyecto (app.js excluido: requiere DOM real). */
const ALL_FILES = [
  'js/config.js',
  'js/sketchy.js',
  'js/renderer.js',
  'js/exporter.js',
  'js/templates.js',
];

function createContext() {
  const created = [];
  const blobs = [];
  const alerts = [];

  const documentStub = {
    created,
    createElement(tag) {
      tag = String(tag).toLowerCase();
      let el;
      if (tag === 'canvas') {
        const ctx = createCtxStub();
        el = {
          tagName: 'CANVAS',
          width: 0,
          height: 0,
          _ctx: ctx,
          getContext: () => ctx,
          toDataURL: () => 'data:fake',
        };
      } else if (tag === 'a') {
        el = { tagName: 'A', download: '', href: '', click() { el.clicked = true; } };
      } else if (tag === 'input') {
        el = {
          tagName: 'INPUT', type: '', accept: '', onchange: null,
          click() { el.clicked = true; },
        };
      } else {
        el = { tagName: tag.toUpperCase(), style: {}, click() {} };
      }
      created.push(el);
      return el;
    },
  };

  class BlobStub {
    constructor(parts = [], options = {}) {
      this.parts = parts;
      this.type = options.type || '';
    }
    /** Contenido concatenado (síncrono), útil para asserts. */
    get content() { return this.parts.map(String).join(''); }
    /** Compatible con la API real Blob.text(). */
    async text() { return this.content; }
  }

  const URLStub = {
    blobs,
    createObjectURL(blob) {
      blobs.push(blob);
      return `blob:stub-${blobs.length}`;
    },
    revokeObjectURL() {},
  };

  /** FileReader síncrono: readAsText dispara onload inmediatamente.
      El "file" puede ser cualquier objeto con propiedad string `text`
      (p.ej. { text: '{"elements":[]}' }) o algo convertible a String. */
  class FileReaderStub {
    readAsText(file) {
      const result =
        file && typeof file === 'object' && typeof file.text === 'string'
          ? file.text
          : String(file);
      if (typeof this.onload === 'function') {
        this.onload({ target: { result } });
      }
    }
  }

  const sandbox = {
    console,
    document: documentStub,
    Blob: BlobStub,
    URL: URLStub,
    FileReader: FileReaderStub,
    alerts,
    alert: msg => { alerts.push(String(msg)); },
    createCtxStub,
    setTimeout, clearTimeout,
  };
  sandbox.window = sandbox;

  return vm.createContext(sandbox);
}

function _captureGlobals(context) {
  const code = KNOWN_GLOBALS
    .map(n => `if (typeof ${n} !== 'undefined') globalThis.${n} = ${n};`)
    .join('\n');
  vm.runInContext(code, context, { filename: 'capture-globals.vm' });
}

/**
 * Carga un archivo (ruta relativa a la raíz del proyecto, o absoluta)
 * en el contexto dado. Devuelve el mismo contexto.
 */
function loadScript(context, file) {
  const abs = path.isAbsolute(file) ? file : path.join(PROJECT_ROOT, file);
  const code = fs.readFileSync(abs, 'utf8');
  vm.runInContext(code, context, { filename: abs });
  _captureGlobals(context);
  return context;
}

/**
 * Lee cualquier binding global del contexto por nombre (incluye `const`
 * top-level que no aparecen como propiedades del contexto).
 */
function getGlobal(context, name) {
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) {
    throw new Error(`Nombre de global inválido: ${name}`);
  }
  return vm.runInContext(
    `typeof ${name} === 'undefined' ? undefined : ${name}`,
    context,
  );
}

/**
 * Crea un contexto nuevo y carga los archivos dados en orden.
 * Si 'js/config.js' no está en la lista, se antepone automáticamente
 * (todos los demás scripts dependen de sus constantes).
 *
 *   const ctx = load('js/sketchy.js', 'js/renderer.js');
 *   ctx.Renderer.renderElement(createCtxStub(), el);
 */
function load(...files) {
  const list = files.flat();
  if (list.length === 0) list.push('js/config.js');
  if (!list.some(f => f.endsWith('config.js'))) list.unshift('js/config.js');
  const context = createContext();
  for (const f of list) loadScript(context, f);
  return context;
}

/** Carga todos los scripts del proyecto (menos app.js) en orden de dependencia. */
function loadAll() {
  return load(...ALL_FILES);
}

module.exports = {
  load,
  loadAll,
  createContext,
  loadScript,
  getGlobal,
  createCtxStub,
  PROJECT_ROOT,
  ALL_FILES,
  KNOWN_GLOBALS,
};
