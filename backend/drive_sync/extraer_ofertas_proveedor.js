// Recorre las obras (mismo criterio de carpeta que llenar_ficha_obras.js) y
// sube al panel las ofertas de proveedor detectadas en la carpeta
// "Valoración" de cada una — ver extract_ofertas_proveedor.js para el
// detalle de qué se considera una oferta y sus límites conocidos. El panel
// empareja esto contra las solicitudes "Pendiente" que Geraldinne haya
// cargado a mano (accion:"sincronizar_ofertas_detectadas"), no reemplaza
// nada por las bravas.
//
// Uso:
//   node extraer_ofertas_proveedor.js "Prado Jerez" "Cascanueces,18"
//   node extraer_ofertas_proveedor.js --todas
//   node extraer_ofertas_proveedor.js --lista archivo.json
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { extraerOfertasDeObra } = require('./extract_ofertas_proveedor.js');

const BASE = 'Z:/DRIVE GALVI/1. GALVI/1.OBRAS/1. ESTUDIOS Y SEGUIMIENTO/HOJAS DE CALCULO (PPTOS)/2026';

function normalizar(s) {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
}

// El panel guarda "Obra \u2014 Opci\u00f3n A"/"\u2014 Opci\u00f3n B" como filas separadas
// cuando la carpeta de la obra tiene varias ofertas alternativas (ver
// sync_all.js), pero es la MISMA carpeta f\u00edsica en Drive -- no hay dos
// carpetas, as\u00ed que hay que quitar el sufijo antes de buscarla.
function nombreCarpeta(nombreObra) {
  return nombreObra.replace(/\s*\u2014\s*Opci[o\u00f3]n\s+\w+\s*$/i, '');
}

function listarDirs(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory());
  } catch {
    return [];
  }
}

function buscarObra(nombreObjetivo) {
  const objetivo = normalizar(nombreObjetivo);
  for (const cat of listarDirs(BASE)) {
    if (cat.name === 'Particulares') {
      for (const obra of listarDirs(path.join(BASE, cat.name))) {
        if (normalizar(obra.name) === objetivo) return path.join(BASE, cat.name, obra.name);
      }
      continue;
    }
    for (const contacto of listarDirs(path.join(BASE, cat.name))) {
      for (const obra of listarDirs(path.join(BASE, cat.name, contacto.name))) {
        if (normalizar(obra.name) === objetivo) return path.join(BASE, cat.name, contacto.name, obra.name);
      }
    }
  }
  return null;
}

function listarTodasLasObras() {
  const obras = [];
  for (const cat of listarDirs(BASE)) {
    if (cat.name === 'Particulares') {
      for (const obra of listarDirs(path.join(BASE, cat.name))) {
        obras.push({ nombre: obra.name, rutaObra: path.join(BASE, cat.name, obra.name) });
      }
      continue;
    }
    for (const contacto of listarDirs(path.join(BASE, cat.name))) {
      for (const obra of listarDirs(path.join(BASE, cat.name, contacto.name))) {
        obras.push({ nombre: obra.name, rutaObra: path.join(BASE, cat.name, contacto.name, obra.name) });
      }
    }
  }
  return obras;
}

async function subirOfertas(nombreObra, ofertas) {
  const url = `${process.env.PANEL_API_URL}/presupuestos_en_estudio.php?token=${process.env.SYNC_TOKEN}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accion: 'sincronizar_ofertas_detectadas', obra: nombreObra, ofertas }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data));
  return data;
}

async function procesarObra(nombreObra, rutaObra) {
  const ofertas = await extraerOfertasDeObra(rutaObra);
  await subirOfertas(nombreObra, ofertas);
  return ofertas;
}

async function main() {
  let args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('Uso: node extraer_ofertas_proveedor.js "Obra 1" ...  (o --todas, o --lista archivo.json)');
    process.exit(1);
  }

  if (args[0] === '--lista') {
    args = JSON.parse(fs.readFileSync(args[1], 'utf8'));
  }

  const resumen = { obras: 0, ofertas: 0, sinOfertas: 0, errores: 0 };

  const objetivos = args[0] === '--todas'
    ? listarTodasLasObras()
    : args.map((nombre) => ({ nombre, rutaObra: buscarObra(nombreCarpeta(nombre)) }));

  for (const { nombre, rutaObra } of objetivos) {
    if (!rutaObra) {
      console.log(`OMITIDA (obra no encontrada): ${nombre}`);
      resumen.errores++;
      continue;
    }
    try {
      const ofertas = await procesarObra(nombre, rutaObra);
      resumen.obras++;
      if (ofertas.length === 0) {
        resumen.sinOfertas++;
        console.log(`SIN OFERTAS: ${nombre}`);
      } else {
        resumen.ofertas += ofertas.length;
        console.log(`OK (${ofertas.length}): ${nombre}`);
        ofertas.forEach((o) => console.log(`   - ${o.proveedor || '(proveedor sin detectar)'} — ${o.valor ?? '(sin valor)'} — ${o.fecha || '(sin fecha)'} — ${o.archivo}`));
      }
    } catch (err) {
      resumen.errores++;
      console.error(`ERROR en "${nombre}": ${err.message}`);
    }
  }

  console.log('\n=== Resumen ===');
  console.log(`Obras procesadas: ${resumen.obras}`);
  console.log(`Ofertas encontradas: ${resumen.ofertas}`);
  console.log(`Obras sin ofertas detectadas: ${resumen.sinOfertas}`);
  console.log(`Errores: ${resumen.errores}`);
}

main().catch((err) => {
  console.error('ERROR FATAL:', err.message);
  process.exit(1);
});
