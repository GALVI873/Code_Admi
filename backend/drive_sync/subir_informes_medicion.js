// Sube a Drive los informes de medición (PDF) que se pidieron con "Subir
// informe a Drive" en la pestaña Planos del panel. Pedido de Álvaro el
// 2026-10-02 (ver public/api/medicion_obra.php). El panel no tiene acceso
// directo a Drive: el PDF se genera en el navegador, queda pendiente en el
// panel y este script lo sube en la próxima sincronización, igual que
// enviar_documentos_montaje.js.
//
// Destino (elegido por Álvaro): "Mi unidad/DRIVE ALVARO/3. Obras (Alfredo)/
// 1.Mediciones de obras/Panel/" en la cuenta galviadmi@gmail.com (en el
// ordenador se ve como "DRIVE GALVI\DRIVE ALVARO\..."). Todos los informes
// van sueltos en "Panel", sin subcarpetas por obra, y solo el informe (no
// las fotos sueltas). Un archivo por obra, "Informe de medición - <Obra>.pdf":
// si ya existe se reemplaza su contenido (Drive guarda las versiones
// anteriores). "Panel" se crea solo si no existe.
//
// Uso:
//   node subir_informes_medicion.js
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { Readable } = require('stream');
const { getDrive } = require('./drive_client.js');

// "1.Mediciones de obras" (no es un dato secreto, es el id de la carpeta).
const CARPETA_MEDICIONES_ID = '1Fzo0YX-el4kvgT07IPTXHQti-61C5Pol';
const NOMBRE_CARPETA_PANEL = 'Panel';
const CARPETA_FOLDER = 'application/vnd.google-apps.folder';

function escaparConsulta(texto) {
  return String(texto).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function buscarHijo(drive, padreId, nombre, condicionExtra = '') {
  const res = await drive.files.list({
    q: `'${padreId}' in parents and name = '${escaparConsulta(nombre)}' and trashed = false${condicionExtra}`,
    fields: 'files(id, name)',
    pageSize: 5,
  });
  return res.data.files[0]?.id || null;
}

async function buscarOCrearPanel(drive) {
  const existente = await buscarHijo(drive, CARPETA_MEDICIONES_ID, NOMBRE_CARPETA_PANEL, ` and mimeType = '${CARPETA_FOLDER}'`);
  if (existente) return existente;
  const creada = await drive.files.create({
    resource: { name: NOMBRE_CARPETA_PANEL, mimeType: CARPETA_FOLDER, parents: [CARPETA_MEDICIONES_ID] },
    fields: 'id',
  });
  return creada.data.id;
}

function nombreArchivo(obra) {
  return `Informe de medición - ${String(obra).replace(/[\\/:*?"<>|]/g, ' ').trim()}.pdf`;
}

async function llamarPanel(cuerpo) {
  const res = await fetch(`${process.env.PANEL_API_URL}/medicion_obra.php?token=${process.env.SYNC_TOKEN}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpo),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function main() {
  const { informes } = await llamarPanel({ accion: 'listar_informes_pendientes_drive' });
  if (!informes || informes.length === 0) {
    console.log('No hay informes de medición pendientes de subir a Drive.');
    return;
  }

  const drive = getDrive();
  const panelId = await buscarOCrearPanel(drive);
  let subidos = 0;
  let errores = 0;

  for (const informe of informes) {
    const nombre = nombreArchivo(informe.obra);
    try {
      const media = { mimeType: 'application/pdf', body: Readable.from(Buffer.from(informe.pdf_base64, 'base64')) };
      const existente = await buscarHijo(drive, panelId, nombre);
      if (existente) {
        await drive.files.update({ fileId: existente, media, fields: 'id' });
      } else {
        await drive.files.create({ resource: { name: nombre, parents: [panelId] }, media, fields: 'id' });
      }
      await llamarPanel({ accion: 'marcar_informe_subido', obra: informe.obra, solicitado_en: informe.solicitado_en });
      subidos++;
      console.log(`OK: Panel/${nombre}${existente ? ' (reemplazado)' : ''}`);
    } catch (err) {
      errores++;
      console.error(`ERROR en ${nombre}: ${err.message}`);
    }
  }

  console.log(`\nInformes subidos: ${subidos} · Errores: ${errores}`);
}

main().catch((err) => {
  console.error('ERROR FATAL:', err.message);
  process.exit(1);
});
