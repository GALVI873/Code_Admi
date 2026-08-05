const path = require('path');
const { google } = require('googleapis');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const folderId = process.argv[2] || process.env.GOOGLE_DRIVE_FOLDER_ID;

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_OAUTH_CLIENT_ID,
  process.env.GOOGLE_OAUTH_CLIENT_SECRET,
);
oauth2Client.setCredentials({ refresh_token: process.env.GOOGLE_OAUTH_REFRESH_TOKEN });

const drive = google.drive({ version: 'v3', auth: oauth2Client });

async function listRecursive(id, prefix = '') {
  const res = await drive.files.list({
    q: `'${id}' in parents and trashed = false`,
    fields: 'files(id, name, mimeType, size, modifiedTime)',
    pageSize: 200,
  });

  for (const file of res.data.files) {
    console.log(`${prefix}${file.name}  [${file.mimeType}]  id=${file.id}  size=${file.size || '-'}`);
    if (file.mimeType === 'application/vnd.google-apps.folder') {
      await listRecursive(file.id, prefix + '  ');
    }
  }
}

listRecursive(folderId)
  .then(() => console.log('DONE'))
  .catch((err) => {
    console.error('ERROR:', err.message);
    process.exit(1);
  });
