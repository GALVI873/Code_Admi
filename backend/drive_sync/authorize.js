// Autorización OAuth de un solo uso: abre un navegador, el usuario autoriza
// con la cuenta dueña del Drive, y este script captura el código en un
// servidor local temporal y lo cambia por un refresh_token permanente.
const fs = require('fs');
const path = require('path');
const http = require('http');
const { google } = require('googleapis');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const PORT = 53682;
const REDIRECT_URI = `http://localhost:${PORT}`;
const ENV_PATH = path.join(__dirname, '.env');

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_OAUTH_CLIENT_ID,
  process.env.GOOGLE_OAUTH_CLIENT_SECRET,
  REDIRECT_URI,
);

// Antes era "drive.readonly" (todo lo que hacían los scripts era leer). Se
// amplía a acceso completo porque sync_all.js ahora también CREA carpetas
// ("Enviados" y "1.Organización/Valoración" para obras nuevas) dentro de
// carpetas de obra que no creó esta app — "drive.file" no alcanza para eso,
// ese scope solo da acceso a archivos que la app misma creó o que el
// usuario abrió a mano con un selector de archivos.
const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent',
  scope: ['https://www.googleapis.com/auth/drive'],
});

console.log('AUTH_URL:' + authUrl);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, REDIRECT_URI);
  const code = url.searchParams.get('code');
  if (!code) {
    res.writeHead(400).end('Falta el parámetro "code".');
    return;
  }

  try {
    const { tokens } = await oauth2Client.getToken(code);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<h2>Autorización completa.</h2><p>Ya puedes cerrar esta pestaña.</p>');

    let envContent = fs.readFileSync(ENV_PATH, 'utf8');
    if (envContent.includes('GOOGLE_OAUTH_REFRESH_TOKEN=')) {
      envContent = envContent.replace(
        /GOOGLE_OAUTH_REFRESH_TOKEN=.*/,
        `GOOGLE_OAUTH_REFRESH_TOKEN=${tokens.refresh_token}`,
      );
    } else {
      envContent += `\nGOOGLE_OAUTH_REFRESH_TOKEN=${tokens.refresh_token}\n`;
    }
    fs.writeFileSync(ENV_PATH, envContent);

    console.log('REFRESH_TOKEN_SAVED');
    server.close(() => process.exit(0));
  } catch (err) {
    res.writeHead(500).end('Error al intercambiar el código.');
    console.error('ERROR:', err.message);
    server.close(() => process.exit(1));
  }
});

server.listen(PORT, () => {
  console.log(`Esperando autorización en ${REDIRECT_URI} ...`);
});
