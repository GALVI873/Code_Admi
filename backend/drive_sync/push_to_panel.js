// Sube al panel (SQLite en producción) los campos ya extraídos de un Excel de
// obra. Uso: node push_to_panel.js <obra> <archivo.xlsx>
// Requiere SYNC_TOKEN y PANEL_API_URL en .env.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { extraerCampos } = require('./extract_fields.js');

async function main() {
  const obra = process.argv[2];
  const filePath = process.argv[3];
  if (!obra || !filePath) {
    console.error('Uso: node push_to_panel.js <obra> <archivo.xlsx>');
    process.exit(1);
  }

  const campos = extraerCampos(filePath);
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
