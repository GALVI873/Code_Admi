// Sube al panel el Diario General completo — ver extract_diario_general.js
// para el detalle de qué se extrae y por qué se dejan fuera las hojas
// "Gestión"/"Estatus Categoria" (copias no siempre al día de esta misma
// tabla) y las categorías administrativas/de facturación.
//
// Lee por la API de Drive (no por el mount Z:\ de Drive Desktop) para poder
// correr como tarea programada de GitHub Actions, sin depender de esta
// máquina. GOOGLE_DRIVE_DIARIO_GENERAL_FILE_ID es el id de archivo fijo de
// "1. Diario General Galvi.xlsx" (no una carpeta, es un único Excel) — se
// resolvió una sola vez con resolver_ids_migracion.js y no debería cambiar
// salvo que alguien mueva/recree el archivo en Drive.
//
// Uso:
//   node sync_diario_general.js
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { extraerDiarioGeneral } = require('./extract_diario_general.js');
const { getDrive, descargarComoBuffer } = require('./drive_client.js');

async function main() {
  const drive = getDrive();
  const fileId = process.env.GOOGLE_DRIVE_DIARIO_GENERAL_FILE_ID;
  const tmpPath = path.join(__dirname, `tmp_${fileId}.xlsx`);

  let items;
  try {
    const buffer = await descargarComoBuffer(drive, fileId);
    fs.writeFileSync(tmpPath, buffer);
    items = extraerDiarioGeneral(tmpPath);
  } finally {
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
  }

  if (items.length === 0) {
    console.error('ADVERTENCIA: 0 ítems extraídos — no se sube nada por seguridad (posible fallo de lectura, no se vacía la tabla).');
    return;
  }

  const url = `${process.env.PANEL_API_URL}/diario_general.php?token=${process.env.SYNC_TOKEN}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accion: 'reemplazar_todo', items }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data));

  const porCategoria = {};
  for (const it of items) porCategoria[it.categoria] = (porCategoria[it.categoria] || 0) + 1;

  console.log(`OK: ${data.guardados} ítems subidos.`);
  console.log('Por categoría:', JSON.stringify(porCategoria, null, 2));
}

main().catch((err) => {
  console.error('ERROR FATAL:', err.message);
  process.exit(1);
});
