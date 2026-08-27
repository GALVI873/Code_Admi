// Recorre "SEGUIMIENTO DE OBRAS (Aceptadas)" (mismo criterio de carpeta
// Categoría/[Contacto]/Obra que sync_all.js) y sube al panel, por cada
// obra: una ficha operativa básica (Cliente/Nº Ventanas/Nº Ppto, leída de
// su Excel "...CALCULO...xlsx" igual que extract_fields.js), los campos
// confirmables de la sección "CONFIRMACION DETALLES DE PROYECTO" de la
// misma Ficha (ver extract_ficha_aceptada.js) y el seguimiento de pedidos
// de material (leído de su "...MEDYSEG.xlsx" — ver
// extract_seguimiento_materiales.js).
//
// Independiente de presupuestos_en_estudio a propósito: se confirmó que esa
// tabla no sigue a la obra una vez que sale de "en estudio" (la
// reconciliación de sync_all.js la borra apenas deja de aparecer en esa
// carpeta) — acá se sube a su propia tabla (obras_aceptadas.php), sin
// depender de que nadie haya marcado "Aceptado" a mano en el panel de
// Álvaro.
//
// Uso:
//   node sync_obras_aceptadas.js
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { extraerCampos } = require('./extract_fields.js');
const { leerFichaConfirmable } = require('./extract_ficha_aceptada.js');
const { listarDirs, archivoMedyseg, extraerMateriales } = require('./extract_seguimiento_materiales.js');

const BASE = 'Z:/DRIVE GALVI/1. GALVI/1.OBRAS/1. ESTUDIOS Y SEGUIMIENTO/SEGUIMIENTO DE OBRAS (Aceptadas)/2026';

// Mismo criterio de singularización que sync_all.js, para que "categoria"
// se vea igual en las dos vistas del panel.
const CATEGORIA_SINGULAR = {
  Arquitectos: 'Arquitecto',
  Constructores: 'Constructor',
  Particulares: 'Particular',
  Proveedores: 'Proveedor',
  Reformistas: 'Reformista',
};

function listarTodasLasObras() {
  const obras = [];
  for (const cat of listarDirs(BASE)) {
    const categoria = CATEGORIA_SINGULAR[cat.name] || cat.name;
    if (cat.name === 'Particulares') {
      for (const obra of listarDirs(path.join(BASE, cat.name))) {
        obras.push({ nombre: obra.name, rutaObra: path.join(BASE, cat.name, obra.name), categoria, contacto: null });
      }
      continue;
    }
    for (const contacto of listarDirs(path.join(BASE, cat.name))) {
      for (const obra of listarDirs(path.join(BASE, cat.name, contacto.name))) {
        obras.push({
          nombre: obra.name,
          rutaObra: path.join(BASE, cat.name, contacto.name, obra.name),
          categoria,
          contacto: contacto.name,
        });
      }
    }
  }
  return obras;
}

// El Excel de cálculo puede tener versiones numeradas ("2.Obra.CALCULO...",
// "4.Obra.CALCULO..."); se prefiere el prefijo más alto y, si empatan o no
// hay prefijo, el modificado más reciente — mismo criterio que
// llenar_ficha_obras.js. A diferencia de "en estudio", en esta carpeta el
// archivo vive directo en la carpeta de la obra, no hace falta bajar a
// subcarpetas.
function extraerPrefijoNumerico(nombreArchivo) {
  const m = nombreArchivo.match(/^(\d+)\./);
  return m ? parseInt(m[1], 10) : null;
}

function archivoCalculo(rutaObra) {
  let archivos;
  try {
    archivos = fs.readdirSync(rutaObra);
  } catch {
    return null;
  }
  const candidatos = archivos.filter((n) => /CALCULO.*\.xlsx$/i.test(n) && !n.startsWith('~$'));
  if (candidatos.length === 0) return null;
  candidatos.sort((a, b) => {
    const prefA = extraerPrefijoNumerico(a) ?? -1;
    const prefB = extraerPrefijoNumerico(b) ?? -1;
    if (prefA !== prefB) return prefB - prefA;
    return fs.statSync(path.join(rutaObra, b)).mtimeMs - fs.statSync(path.join(rutaObra, a)).mtimeMs;
  });
  return path.join(rutaObra, candidatos[0]);
}

async function subirObra(info, campos, confirmables) {
  const url = `${process.env.PANEL_API_URL}/obras_aceptadas.php?token=${process.env.SYNC_TOKEN}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      obra: info.nombre,
      categoria: info.categoria,
      contacto: info.contacto,
      cliente: campos.cliente,
      no_ventanas: campos.no_ventanas,
      numero_ppto: campos.numero_ppto,
      fecha_ppto: confirmables.fecha_ppto,
      proveedor: confirmables.proveedor,
      color_carpinteria: confirmables.color_carpinteria,
      correderas: confirmables.correderas,
      abatibles: confirmables.abatibles,
      vidrio: confirmables.vidrio,
      ral: confirmables.ral,
      persiana: confirmables.persiana,
      color_persiana: confirmables.color_persiana,
      modelo_lamas: confirmables.modelo_lamas,
      motor_radio: confirmables.motor_radio,
      motor_mecanico: confirmables.motor_mecanico,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data));
  return data;
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

async function reconciliar(nombresActivos) {
  const url = `${process.env.PANEL_API_URL}/obras_aceptadas.php?token=${process.env.SYNC_TOKEN}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accion: 'reconciliar', obras: nombresActivos }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data));
  return data;
}

async function main() {
  const obras = listarTodasLasObras();
  const resumen = { obras: 0, materiales: 0, sinCalculo: 0, sinMedyseg: 0, errores: 0 };
  const nombresActivos = [];

  for (const info of obras) {
    const rutaCalculo = archivoCalculo(info.rutaObra);
    if (!rutaCalculo) {
      resumen.sinCalculo++;
      console.log(`SIN EXCEL DE CÁLCULO: ${info.nombre}`);
      continue;
    }

    try {
      const campos = extraerCampos(rutaCalculo);
      const confirmables = leerFichaConfirmable(rutaCalculo);
      await subirObra(info, campos, confirmables);
      nombresActivos.push(info.nombre);
      resumen.obras++;

      const rutaMedyseg = archivoMedyseg(info.rutaObra);
      if (!rutaMedyseg) {
        resumen.sinMedyseg++;
        console.log(`OK sin MEDYSEG: ${info.nombre}`);
        continue;
      }
      const materiales = extraerMateriales(rutaMedyseg);
      await subirMateriales(info.nombre, materiales);
      resumen.materiales += materiales.length;
      console.log(`OK (${materiales.length} líneas de material): ${info.nombre}`);
    } catch (err) {
      resumen.errores++;
      console.error(`ERROR en "${info.nombre}": ${err.message}`);
    }
  }

  if (nombresActivos.length > 0) {
    const resultado = await reconciliar(nombresActivos);
    console.log(`\nReconciliación: ${resultado.eliminadas} obra(s) obsoleta(s) eliminadas.`);
  } else {
    console.log('\nReconciliación omitida: 0 obras encontradas (posible fallo de lectura, no se borra nada por seguridad).');
  }

  console.log('\n=== Resumen ===');
  console.log(`Obras procesadas: ${resumen.obras}`);
  console.log(`Líneas de material subidas: ${resumen.materiales}`);
  console.log(`Sin Excel de cálculo: ${resumen.sinCalculo}`);
  console.log(`Sin MEDYSEG: ${resumen.sinMedyseg}`);
  console.log(`Errores: ${resumen.errores}`);
}

main().catch((err) => {
  console.error('ERROR FATAL:', err.message);
  process.exit(1);
});
