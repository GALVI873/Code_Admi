const path = require('path');
const { getDrive } = require('./drive_client.js');
require('dotenv').config({ path: path.join(__dirname, '.env') });

async function listarCarpetas(drive, parentId) {
  const res = await drive.files.list({
    q: `'${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id, name)',
    pageSize: 1000,
  });
  return res.data.files;
}

async function main() {
  const drive = getDrive();
  const categorias = await listarCarpetas(drive, process.env.GOOGLE_DRIVE_FOLDER_ID);

  let total = 0;
  const todas = [];
  for (const cat of categorias) {
    const obras = await listarCarpetas(drive, cat.id);
    console.log(`\n=== ${cat.name} (${obras.length}) ===`);
    obras.forEach((o) => {
      console.log(` - ${o.name} | ${o.id}`);
      todas.push({ categoria: cat.name, nombre: o.name, id: o.id });
    });
    total += obras.length;
  }
  console.log(`\nTotal de obras: ${total}`);
  require('fs').writeFileSync('obras.json', JSON.stringify(todas, null, 2));
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
