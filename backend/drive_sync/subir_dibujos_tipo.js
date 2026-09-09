// Carga única (a mano, no forma parte de ningún cron) de los dibujos por
// Tipo recortados de la memoria de carpintería de una obra puntual — ver
// medidas_obra.php. Hoy solo existe el recorte para "8 Viv. Jose Abascal, 57"
// (memoria _CARPINTERÍAS-3.pdf, ver conversación) — cada memoria de
// carpintería trae un diseño de plancha distinto según el arquitecto, así
// que no hay una forma automática de repetir esto para cualquier obra nueva;
// hay que rehacer el recorte a mano por PDF y volver a correr este script
// con la carpeta de imágenes correspondiente.
//
// Uso:
//   node subir_dibujos_tipo.js "<obra>" "<carpeta con V1-1.png .. V21-1.png>"
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

async function main() {
  const obra = process.argv[2];
  const carpeta = process.argv[3];
  if (!obra || !carpeta) {
    console.error('Uso: node subir_dibujos_tipo.js "<obra>" "<carpeta>"');
    process.exit(1);
  }

  const archivos = fs.readdirSync(carpeta).filter((n) => /^V\d+-1\.png$/i.test(n));
  if (archivos.length === 0) {
    console.error(`No se encontraron archivos "V<n>-1.png" en ${carpeta}`);
    process.exit(1);
  }

  const url = `${process.env.PANEL_API_URL}/medidas_obra.php?token=${process.env.SYNC_TOKEN}`;
  let subidos = 0;
  for (const archivo of archivos) {
    const tipo = archivo.match(/^(V\d+)-1\.png$/i)[1];
    const buffer = fs.readFileSync(path.join(carpeta, archivo));
    const imagenBase64 = `data:image/png;base64,${buffer.toString('base64')}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accion: 'guardar_dibujo_tipo', obra, tipo, imagen_base64: imagenBase64 }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`${tipo}: ${JSON.stringify(data)}`);
    subidos += 1;
    console.log(`${tipo} OK`);
  }
  console.log(`Listo: ${subidos} dibujos subidos para "${obra}".`);
}

main().catch((err) => {
  console.error('ERROR FATAL:', err.message);
  process.exit(1);
});
