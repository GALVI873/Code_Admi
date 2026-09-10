// Procesa los pedidos de "Enviar medidas" hechos desde el panel (botón en
// Planos, ver medidas_obra.php) — arma un Excel con las medidas confirmadas
// en obra y lo sube a la carpeta "medición" de esa obra en Drive, para que
// Alfredo lo revise y se mande al taller. A diferencia de
// escribir_confirmaciones_aceptadas.js / escribir_ubicacion_diario_general.js,
// este SÍ corre en el cron de la nube: no edita un Excel existente con
// fórmulas, arma uno nuevo desde cero, así que no hace falta Excel
// instalado ni el mount Z:\ de Drive Desktop — solo la API de Drive.
//
// Uso:
//   node enviar_medidas_taller.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const XLSX = require('xlsx');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { getDrive } = require('./drive_client.js');
const { Readable } = require('stream');

const CARPETA_FOLDER = 'application/vnd.google-apps.folder';
const CATEGORIA_SINGULAR = {
  Arquitectos: 'Arquitecto',
  Constructores: 'Constructor',
  Particulares: 'Particular',
  Proveedores: 'Proveedor',
  Reformistas: 'Reformista',
};

async function listarHijos(drive, folderId, soloCarpetas) {
  const filtroTipo = soloCarpetas ? ` and mimeType = '${CARPETA_FOLDER}'` : '';
  const res = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false${filtroTipo}`,
    fields: 'files(id, name, mimeType)',
    pageSize: 1000,
  });
  return res.data.files;
}

async function buscarObra(drive, nombreObra) {
  const categorias = await listarHijos(drive, process.env.GOOGLE_DRIVE_OBRAS_ACEPTADAS_FOLDER_ID, true);
  for (const cat of categorias) {
    const categoria = CATEGORIA_SINGULAR[cat.name] || cat.name;
    const nivelesAExplorar = cat.name === 'Particulares' ? [cat] : await listarHijos(drive, cat.id, true);
    for (const nivel of nivelesAExplorar) {
      const candidatos = cat.name === 'Particulares' ? await listarHijos(drive, cat.id, true) : await listarHijos(drive, nivel.id, true);
      const obraFolder = candidatos.find((f) => f.name === nombreObra);
      if (obraFolder) return { folderId: obraFolder.id, categoria };
    }
  }
  return null;
}

// Mismo typo tolerado que sync_planos.js ("1.Orgazanización" real en Drive).
async function buscarOCrearCarpetaMedicion(drive, obraFolderId) {
  const hijos = await listarHijos(drive, obraFolderId, true);
  const directa = hijos.find((f) => /medici[oó]n/i.test(f.name));
  if (directa) return directa;

  let organizacion = hijos.find((f) => /orga.{0,3}ni/i.test(f.name));
  if (!organizacion) {
    const creada = await drive.files.create({
      resource: { name: '1.Organización', mimeType: CARPETA_FOLDER, parents: [obraFolderId] },
      fields: 'id, name',
    });
    organizacion = creada.data;
  }

  const nietos = await listarHijos(drive, organizacion.id, true);
  const medicion = nietos.find((f) => /medici[oó]n/i.test(f.name));
  if (medicion) return medicion;

  const creada = await drive.files.create({
    resource: { name: 'medición', mimeType: CARPETA_FOLDER, parents: [organizacion.id] },
    fields: 'id, name',
  });
  return creada.data;
}

function ordenarPosiciones(a, b) {
  return String(a.posicion).localeCompare(String(b.posicion), 'es', { numeric: true });
}

function armarExcel(obra, medidas) {
  const filas = [...medidas].sort(ordenarPosiciones).map((m) => ({
    Posición: m.posicion,
    Tipo: m.tipo || '',
    'Ancho real (m)': m.ancho_real ?? '',
    'Alto real (m)': m.alto_real ?? '',
    Comentario: m.comentario || '',
    'Confirmado por': m.confirmado_por || '',
    'Confirmado el': m.actualizado_en || '',
  }));
  const ws = XLSX.utils.json_to_sheet(filas);
  ws['!cols'] = [{ wch: 10 }, { wch: 8 }, { wch: 13 }, { wch: 12 }, { wch: 40 }, { wch: 16 }, { wch: 18 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Medidas confirmadas');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

async function subirExcel(drive, carpetaId, nombreArchivo, buffer) {
  await drive.files.create({
    resource: { name: nombreArchivo, parents: [carpetaId] },
    media: {
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      body: Readable.from(buffer),
    },
    fields: 'id',
  });
}

async function listarPendientes() {
  const url = `${process.env.PANEL_API_URL}/medidas_obra.php?token=${process.env.SYNC_TOKEN}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accion: 'listar_pendientes_envio' }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data));
  return data.pendientes;
}

async function listarMedidas(obra) {
  const url = `${process.env.PANEL_API_URL}/medidas_obra.php?token=${process.env.SYNC_TOKEN}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accion: 'listar_medidas_para_envio', obra }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data));
  return data.medidas;
}

async function marcarEnviado(obra) {
  const url = `${process.env.PANEL_API_URL}/medidas_obra.php?token=${process.env.SYNC_TOKEN}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accion: 'marcar_envio_hecho', obra }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data));
}

function fechaHoyDDMMYYYY() {
  const hoy = new Date();
  const d = String(hoy.getDate()).padStart(2, '0');
  const m = String(hoy.getMonth() + 1).padStart(2, '0');
  return `${d}-${m}-${hoy.getFullYear()}`;
}

async function main() {
  const pendientes = await listarPendientes();
  if (pendientes.length === 0) {
    console.log('No hay pedidos de "Enviar medidas" pendientes.');
    return;
  }

  const drive = getDrive();
  for (const pedido of pendientes) {
    const obra = pedido.obra;
    console.log(`--- ${obra} (pedido por ${pedido.solicitado_por}) ---`);
    try {
      const medidas = await listarMedidas(obra);
      if (medidas.length === 0) {
        console.log('  Sin medidas confirmadas todavía — se envía igual (planilla vacía) para no dejar el pedido trabado.');
      }

      const info = await buscarObra(drive, obra);
      if (!info) {
        console.error(`  No se encontró la carpeta de "${obra}" en Drive — se deja el pedido pendiente para reintentar.`);
        continue;
      }

      const carpetaMedicion = await buscarOCrearCarpetaMedicion(drive, info.folderId);
      const buffer = armarExcel(obra, medidas);
      const nombreArchivo = `Medidas confirmadas - ${obra} - ${fechaHoyDDMMYYYY()}.xlsx`;
      await subirExcel(drive, carpetaMedicion.id, nombreArchivo, buffer);
      await marcarEnviado(obra);
      console.log(`  OK: subido "${nombreArchivo}" (${medidas.length} posiciones).`);
    } catch (err) {
      console.error(`  ERROR con "${obra}":`, err.message);
    }
  }
}

main().catch((err) => {
  console.error('ERROR FATAL:', err.message);
  process.exit(1);
});
