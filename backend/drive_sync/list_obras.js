const path = require('path');
const { getDrive } = require('./drive_client.js');
require('dotenv').config({ path: path.join(__dirname, '.env') });

async function main() {
  const drive = getDrive();
  const res = await drive.files.list({
    q: `'${process.env.GOOGLE_DRIVE_FOLDER_ID}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id, name)',
    pageSize: 500,
  });
  res.data.files.forEach((f) => console.log(f.name, '|', f.id));
  console.log(`\nTotal: ${res.data.files.length} carpetas de obra`);
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
