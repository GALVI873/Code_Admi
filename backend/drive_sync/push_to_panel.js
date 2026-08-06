// Sube al panel (SQLite en producción) los campos ya extraídos de un Excel de
// obra. Si Cliente/RAL/Vidrio/Persiana vienen vacíos del Excel (obra todavía
// sin completar la hoja "Ficha"), busca el presupuesto enviado más reciente
// con ese nombre de obra y completa desde ahí.
// Uso: node push_to_panel.js <obra> <archivo.xlsx>
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { extraerCampos } = require('./extract_fields.js');
const { completarDesdeEnviado } = require('./extract_from_sent_pdf.js');

const CAMPOS_RESPALDABLES = ['cliente', 'ral', 'persiana', 'vidrio'];

async function main() {
  const obra = process.argv[2];
  const filePath = process.argv[3];
  if (!obra || !filePath) {
    console.error('Uso: node push_to_panel.js <obra> <archivo.xlsx>');
    process.exit(1);
  }

  const campos = extraerCampos(filePath);

  // Siempre se busca el presupuesto enviado, no solo cuando faltan campos:
  // la fecha de envío se necesita en todos los casos para saber la antigüedad.
  const faltantes = CAMPOS_RESPALDABLES.filter((c) => campos[c] === null || campos[c] === undefined);
  console.log('Buscando presupuesto enviado (fecha + respaldo de campos faltantes)...');
  try {
    const relleno = await completarDesdeEnviado(obra, faltantes);
    Object.assign(campos, relleno);
    if (Object.keys(relleno).length > 0) {
      console.log('Completado desde presupuesto enviado:', JSON.stringify(relleno));
    } else {
      console.log('No se encontró un presupuesto enviado para esta obra.');
    }
  } catch (err) {
    console.warn('No se pudo buscar en presupuestos enviados:', err.message);
  }

  const url = `${process.env.PANEL_API_URL}/presupuestos_en_estudio.php?token=${process.env.SYNC_TOKEN}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ obra, ...campos }),
  });
  const data = await res.json();
  if (!res.ok) {
    console.error('ERROR:', JSON.stringify(data));
    process.exit(1);
  }
  console.log('OK:', JSON.stringify(data));
}

main();
