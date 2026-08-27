// Recorre "SEGUIMIENTO DE OBRAS (Aceptadas)" (mismo criterio de carpeta
// Categoría/[Contacto]/Obra que llenar_ficha_obras.js) y sube al panel el
// seguimiento de pedidos de material de cada obra, leído de su
// "...MEDYSEG.xlsx" — ver extract_seguimiento_materiales.js para el detalle
// de qué se extrae. El nombre de obra debe coincidir con el que ya usa
// presupuestos_en_estudio (mismo nombre de carpeta) para que el panel pueda
// cruzar la ficha con su seguimiento de materiales.
//
// Uso:
//   node sync_obras_aceptadas.js
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { listarDirs, archivoMedyseg, extraerMateriales } = require('./extract_seguimiento_materiales.js');

const BASE = 'Z:/DRIVE GALVI/1. GALVI/1.OBRAS/1. ESTUDIOS Y SEGUIMIENTO/SEGUIMIENTO DE OBRAS (Aceptadas)/2026';

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

async function subirMateriales(nombreObra, materiales) {
  const url = `${process.env.PANEL_API_URL}/seguimiento_materiales.php?token=${process.env.SYNC_TOKEN}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accion: 'reemplazar_materiales', obra: nombreObra, materiales }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data));
  return data;
}

async function main() {
  const obras = listarTodasLasObras();
  const resumen = { obras: 0, materiales: 0, sinArchivo: 0, errores: 0 };

  for (const { nombre, rutaObra } of obras) {
    const rutaMedyseg = archivoMedyseg(rutaObra);
    if (!rutaMedyseg) {
      resumen.sinArchivo++;
      console.log(`SIN MEDYSEG: ${nombre}`);
      continue;
    }
    try {
      const materiales = extraerMateriales(rutaMedyseg);
      await subirMateriales(nombre, materiales);
      resumen.obras++;
      resumen.materiales += materiales.length;
      console.log(`OK (${materiales.length} líneas de material): ${nombre}`);
    } catch (err) {
      resumen.errores++;
      console.error(`ERROR en "${nombre}": ${err.message}`);
    }
  }

  console.log('\n=== Resumen ===');
  console.log(`Obras procesadas: ${resumen.obras}`);
  console.log(`Líneas de material subidas: ${resumen.materiales}`);
  console.log(`Sin archivo MEDYSEG: ${resumen.sinArchivo}`);
  console.log(`Errores: ${resumen.errores}`);
}

main().catch((err) => {
  console.error('ERROR FATAL:', err.message);
  process.exit(1);
});
