'use strict';
/* ============================================================
   index.js — Punto de entrada del directorio tests/.

   En esta versión de Node (v22.13.0), `node --test tests/` trata el
   argumento como un archivo literal y ejecuta `node tests`, por lo que
   el directorio necesita un index.js que cargue todos los tests.
   Este archivo no coincide con el patrón *.test.js, así que no
   interfiere si el runner descubre los tests por glob o por
   búsqueda de directorio en otras versiones de Node.
   ============================================================ */

require('./smoke.test.js');
require('./config-templates.test.js');
require('./exporter.test.js');
require('./sketchy-renderer.test.js');
