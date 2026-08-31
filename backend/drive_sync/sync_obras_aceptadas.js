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
// Lee por la API de Drive (no por el mount Z:\ de Drive Desktop, como antes)
// para poder correr como tarea programada de GitHub Actions, igual que
// sync_all.js: baja cada Excel a un archivo temporal (las funciones de
// extracción usan XLSX.readFile con una ruta local) y lo borra al terminar.
// GOOGLE_DRIVE_OBRAS_ACEPTADAS_FOLDER_ID es el id de
// ".../SEGUIMIENTO DE OBRAS (Aceptadas)/2026", resuelto una sola vez con
// resolver_ids_migracion.js.
//
// Uso:
//   node sync_obras_aceptadas.js
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { extraerCampos } = require('./extract_fields.js');
const { leerFichaConfirmable } = require('./extract_ficha_aceptada.js');
const { extraerMateriales } = require('./extract_seguimiento_materiales.js');
const { getDrive, descargarComoBuffer } = require('./drive_client.js');

// Mismo criterio de singularización que sync_all.js, para que "categoria"
// se vea igual en las dos vistas del panel.
const CATEGORIA_SINGULAR = {
  Arquitectos: 'Arquitecto',
  Constructores: 'Constructor',
  Particulares: 'Particular',
  Proveedores: 'Proveedor',
  Reformistas: 'Reformista',
};

async function listarHijos(drive, folderId, soloCarpetas) {
  const filtroTipo = soloCarpetas
    ? " and mimeType = 'application/vnd.google-apps.folder'"
    : " and mimeType != 'application/vnd.google-apps.folder'";
  const res = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false${filtroTipo}`,
    fields: 'files(id, name, modifiedTime)',
    pageSize: 1000,
  });
  return res.data.files;
}

async function listarTodasLasObras(drive) {
  const obras = [];
  const categorias = await listarHijos(drive, process.env.GOOGLE_DRIVE_OBRAS_ACEPTADAS_FOLDER_ID, true);
  for (const cat of categorias) {
    const categoria = CATEGORIA_SINGULAR[cat.name] || cat.name;
    if (cat.name === 'Particulares') {
      for (const obraFolder of await listarHijos(drive, cat.id, true)) {
        obras.push({ nombre: obraFolder.name, folderId: obraFolder.id, categoria, contacto: null });
      }
      continue;
    }
    for (const contacto of await listarHijos(drive, cat.id, true)) {
      for (const obraFolder of await listarHijos(drive, contacto.id, true)) {
        obras.push({ nombre: obraFolder.name, folderId: obraFolder.id, categoria, contacto: contacto.name });
      }
    }
  }
  return obras;
}

// El Excel de cálculo puede tener versiones numeradas ("2.Obra.CALCULO...",
// "4.Obra.CALCULO..."); se prefiere el prefijo más alto y, si empatan o no
// hay prefijo, el modificado más reciente — mismo criterio que
// llenar_ficha_obras.js. El archivo vive directo en la carpeta de la obra,
// no hace falta bajar a subcarpetas.
function extraerPrefijoNumerico(nombreArchivo) {
  const m = nombreArchivo.match(/^(\d+)\./);
  return m ? parseInt(m[1], 10) : null;
}

async function archivoCalculo(drive, folderId) {
  const archivos = await listarHijos(drive, folderId, false);
  const candidatos = archivos.filter((f) => /CALCULO.*\.xlsx$/i.test(f.name) && !f.name.startsWith('~$'));
  if (candidatos.length === 0) return null;
  candidatos.sort((a, b) => {
    const prefA = extraerPrefijoNumerico(a.name) ?? -1;
    const prefB = extraerPrefijoNumerico(b.name) ?? -1;
    if (prefA !== prefB) return prefB - prefA;
    return b.modifiedTime.localeCompare(a.modifiedTime); // ISO 8601, ordena bien como texto
  });
  return candidatos[0];
}

// El nombre trae un prefijo numérico variable ("2.", "3."...) y puntuación
// inconsistente ("Obra MEDYSEG.xlsx" vs "Obra.MEDYSEG.xlsx") — se busca por
// contener "medyseg" en vez de un patrón exacto.
async function archivoMedyseg(drive, folderId) {
  const archivos = await listarHijos(drive, folderId, false);
  return archivos.find((f) => /medyseg/i.test(f.name) && /\.xlsx$/i.test(f.name) && !f.name.startsWith('~$')) || null;
}

async function descargarATemporal(drive, archivo) {
  const tmpPath = path.join(__dirname, `tmp_${archivo.id}.xlsx`);
  const buffer = await descargarComoBuffer(drive, archivo.id);
  fs.writeFileSync(tmpPath, buffer);
  return tmpPath;
}

function borrarSiExiste(rutaTmp) {
  if (rutaTmp && fs.existsSync(rutaTmp)) fs.unlinkSync(rutaTmp);
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

function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const drive = getDrive();
  const obras = await listarTodasLasObras(drive);
  const resumen = { obras: 0, materiales: 0, sinCalculo: 0, sinMedyseg: 0, errores: 0 };
  const nombresActivos = [];

  for (const info of obras) {
    const archivoCalc = await archivoCalculo(drive, info.folderId);
    if (!archivoCalc) {
      resumen.sinCalculo++;
      console.log(`SIN EXCEL DE CÁLCULO: ${info.nombre}`);
      continue;
    }

    let tmpCalculo;
    try {
      tmpCalculo = await descargarATemporal(drive, archivoCalc);
      const campos = extraerCampos(tmpCalculo);
      const confirmables = leerFichaConfirmable(tmpCalculo);
      await subirObra(info, campos, confirmables);
      nombresActivos.push(info.nombre);
      resumen.obras++;

      const archivoMed = await archivoMedyseg(drive, info.folderId);
      if (!archivoMed) {
        resumen.sinMedyseg++;
        console.log(`OK sin MEDYSEG: ${info.nombre}`);
        continue;
      }
      let tmpMedyseg;
      try {
        tmpMedyseg = await descargarATemporal(drive, archivoMed);
        const materiales = extraerMateriales(tmpMedyseg);
        await subirMateriales(info.nombre, materiales);
        resumen.materiales += materiales.length;
        console.log(`OK (${materiales.length} líneas de material): ${info.nombre}`);
      } finally {
        borrarSiExiste(tmpMedyseg);
      }
    } catch (err) {
      resumen.errores++;
      console.error(`ERROR en "${info.nombre}": ${err.message}`);
    } finally {
      borrarSiExiste(tmpCalculo);
    }
    await esperar(250);
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
