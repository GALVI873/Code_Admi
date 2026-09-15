// Sube al panel las ofertas de proveedor detectadas en la carpeta
// "Valoración" de cada obra en estudio — reemplaza a
// extraer_ofertas_proveedor.js para poder correr en el cron nocturno
// (ver .github/workflows/sync_drive.yml).
//
// OCR (2026-09-15, a pedido de Álvaro): varios proveedores mandan el
// presupuesto como PDF ESCANEADO (una imagen, sin texto real adentro) —
// pdf-parse en esos casos devuelve texto vacío o casi vacío, así que la
// oferta quedaba invisible aunque el archivo estuviera ahí (caso real:
// "Presupuesto Alumespa.pdf"). Cuando pasa eso, se cae a OCR: pdftoppm
// (poppler-utils) rasteriza cada página del PDF a PNG, y tesseract (con el
// paquete de idioma español) le saca el texto a esas imágenes — el
// resultado se le pasa a las mismas funciones de siempre
// (esDocumentoDeOferta/extraerValorTotal/etc, ver extract_ofertas_
// proveedor.js), que no saben ni les importa si el texto vino de pdf-parse
// o de OCR. Ambos binarios se instalan en el runner con apt-get (ver
// sync_drive.yml) — no dependen de nada de la máquina de Valentina, así que
// esto sigue corriendo solo en el cron igual que el resto.
//
// extraer_ofertas_proveedor.js leía los PDF directo del mount Z:\ de Drive
// Desktop (fs.readdirSync sobre "Z:/DRIVE GALVI/.../HOJAS DE CALCULO
// (PPTOS)/2026"), así que solo podía correrlo alguien a mano desde una
// máquina con esa unidad montada — nunca estuvo en el cron, y evidentemente
// nadie lo venía corriendo con regularidad (bug reportado: las ofertas no
// se cargaban solas). Este script hace exactamente lo mismo pero recorre
// Drive por su API (OAuth, mismo mecanismo que sync_all.js/
// sync_obras_aceptadas.js) y descarga cada PDF a un archivo temporal antes
// de parsearlo — la lógica de extracción en sí (detectar proveedor, total,
// fecha desde el texto ya leído) no cambió un carácter, sigue viviendo en
// extract_ofertas_proveedor.js y se reusa tal cual.
//
// Mismo criterio que extraer_ofertas_proveedor.js --todas: recorre TODAS
// las carpetas de obra bajo GOOGLE_DRIVE_FOLDER_ID (Categoría/[Contacto]/
// Obra, Particulares sin nivel de contacto) y sube lo que encuentre bajo el
// nombre de carpeta tal cual (sin sufijo "— Opción A/B" — ese sufijo solo
// existe en el panel, no como carpeta real de Drive). El panel empareja
// esto contra las solicitudes "Pendiente" que Geraldinne haya cargado a
// mano (accion:"sincronizar_ofertas_detectadas" en
// presupuestos_en_estudio.php), no reemplaza nada por las bravas.
//
// Uso:
//   node sync_ofertas_proveedor.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { getDrive, descargarComoBuffer } = require('./drive_client.js');
const {
  parsearPdfAislado,
  esDocumentoDeOferta,
  extraerValorTotal,
  extraerFecha,
  extraerProveedor,
} = require('./extract_ofertas_proveedor.js');

const CARPETA_FOLDER = 'application/vnd.google-apps.folder';

// Un PDF con texto real casi nunca tiene menos de esto por página — un
// resultado más corto que ${UMBRAL_TEXTO_VACIO} es la señal de que
// pdf-parse no sacó nada útil (PDF escaneado) y conviene probar con OCR.
const UMBRAL_TEXTO_VACIO = 30;

// Rasteriza cada página del PDF a PNG (pdftoppm, poppler-utils) y le saca
// el texto a cada imagen con tesseract (idioma español) — devuelve todo
// concatenado. Si cualquiera de los dos binarios no está instalado o el PDF
// falla, devuelve '' en vez de tirar error: OCR es un intento best-effort,
// no debe tumbar la sincronización de toda la obra por un PDF raro.
function ocrPdfComoTexto(rutaPdf) {
  const prefijo = path.join(os.tmpdir(), `ocr_${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2)}`);
  const nombreBase = path.basename(prefijo);
  let paginasGeneradas = [];
  try {
    execFileSync('pdftoppm', ['-png', '-r', '200', rutaPdf, prefijo], { stdio: 'pipe' });
    paginasGeneradas = fs.readdirSync(os.tmpdir())
      .filter((n) => n.startsWith(nombreBase) && n.endsWith('.png'))
      .sort((a, b) => {
        const na = parseInt(a.match(/-(\d+)\.png$/)?.[1] || '0', 10);
        const nb = parseInt(b.match(/-(\d+)\.png$/)?.[1] || '0', 10);
        return na - nb;
      })
      .map((n) => path.join(os.tmpdir(), n));

    let texto = '';
    for (const rutaPagina of paginasGeneradas) {
      texto += execFileSync('tesseract', [rutaPagina, 'stdout', '-l', 'spa'], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 }) + '\n';
    }
    return texto;
  } catch {
    return '';
  } finally {
    for (const rutaPagina of paginasGeneradas) fs.rmSync(rutaPagina, { force: true });
  }
}

async function listarHijos(drive, folderId, soloCarpetas) {
  const filtroTipo = soloCarpetas ? ` and mimeType = '${CARPETA_FOLDER}'` : '';
  const res = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false${filtroTipo}`,
    fields: 'files(id, name, mimeType, modifiedTime)',
    pageSize: 1000,
  });
  return res.data.files;
}

// Mismo recorrido que listarTodasLasObras() en extraer_ofertas_proveedor.js
// (Categoría/[Contacto]/Obra, Particulares sin nivel de contacto) pero por
// la API de Drive en vez de fs.readdirSync sobre Z:\.
async function listarTodasLasObras(drive) {
  const rootId = process.env.GOOGLE_DRIVE_FOLDER_ID;
  const categorias = await listarHijos(drive, rootId, true);
  const obras = [];
  for (const cat of categorias) {
    if (cat.name === 'Particulares') {
      for (const obra of await listarHijos(drive, cat.id, true)) {
        obras.push({ nombre: obra.name, folderId: obra.id });
      }
      continue;
    }
    for (const contacto of await listarHijos(drive, cat.id, true)) {
      for (const obra of await listarHijos(drive, contacto.id, true)) {
        obras.push({ nombre: obra.name, folderId: obra.id });
      }
    }
  }
  return obras;
}

// Igual que carpetaValoracion() en extract_ofertas_proveedor.js: no está
// siempre en el mismo lugar (a veces cuelga directo de la obra, a veces
// dentro de "1.Organización", a veces dentro de "Doc") — se busca
// recursivamente (acotado a 3 niveles) cualquier carpeta cuyo nombre
// contenga "valoraci", saltando "Enviados" (fuente de datos distinta).
async function carpetaValoracion(drive, obraFolderId, profundidad = 0) {
  if (profundidad > 3) return null;
  const subdirs = await listarHijos(drive, obraFolderId, true);
  const directa = subdirs.find((d) => /valoraci/i.test(d.name));
  if (directa) return directa;
  for (const dir of subdirs) {
    if (/^enviad/i.test(dir.name)) continue;
    const encontrada = await carpetaValoracion(drive, dir.id, profundidad + 1);
    if (encontrada) return encontrada;
  }
  return null;
}

async function extraerOfertasDeObra(drive, obraFolderId) {
  const carpetaVal = await carpetaValoracion(drive, obraFolderId);
  if (!carpetaVal) return [];

  const archivos = await listarHijos(drive, carpetaVal.id, false);
  const pdfs = archivos.filter((f) => f.mimeType !== CARPETA_FOLDER && /\.pdf$/i.test(f.name) && !f.name.startsWith('~$'));

  const ofertas = [];
  for (const archivo of pdfs) {
    const tmpPath = path.join(__dirname, `tmp_oferta_${archivo.id}.pdf`);
    try {
      const buffer = await descargarComoBuffer(drive, archivo.id);
      fs.writeFileSync(tmpPath, buffer);

      let text;
      try {
        text = parsearPdfAislado(tmpPath);
      } catch {
        text = '';
      }
      // pdf-parse casi no sacó nada -> probablemente un PDF escaneado, se
      // intenta con OCR antes de descartarlo (ver ocrPdfComoTexto).
      if (!text || text.trim().length < UMBRAL_TEXTO_VACIO) {
        const textoOcr = ocrPdfComoTexto(tmpPath);
        if (textoOcr && textoOcr.trim().length >= UMBRAL_TEXTO_VACIO) text = textoOcr;
      }
      if (!text || !esDocumentoDeOferta(text)) continue;

      ofertas.push({
        proveedor: extraerProveedor(text),
        valor: extraerValorTotal(text),
        fecha: extraerFecha(text),
        archivo: archivo.name,
        // "fecha_llegada" es cuándo el archivo apareció en "Valoración" —
        // antes era el mtime del archivo local, acá es modifiedTime de
        // Drive (mismo significado).
        fecha_llegada: archivo.modifiedTime ? archivo.modifiedTime.slice(0, 10) : null,
      });
    } finally {
      fs.rmSync(tmpPath, { force: true });
    }
  }
  return ofertas;
}

async function subirOfertas(nombreObra, ofertas) {
  const url = `${process.env.PANEL_API_URL}/presupuestos_en_estudio.php?token=${process.env.SYNC_TOKEN}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accion: 'sincronizar_ofertas_detectadas', obra: nombreObra, ofertas }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data));
  return data;
}

async function main() {
  const drive = getDrive();
  const obras = await listarTodasLasObras(drive);
  console.log(`Carpetas de obra encontradas: ${obras.length}`);

  const resumen = { obras: 0, ofertas: 0, sinOfertas: 0, errores: 0 };

  for (const { nombre, folderId } of obras) {
    try {
      const ofertas = await extraerOfertasDeObra(drive, folderId);
      await subirOfertas(nombre, ofertas);
      resumen.obras++;
      if (ofertas.length === 0) {
        resumen.sinOfertas++;
      } else {
        resumen.ofertas += ofertas.length;
        console.log(`OK (${ofertas.length}): ${nombre}`);
      }
    } catch (err) {
      resumen.errores++;
      console.error(`ERROR en "${nombre}": ${err.message}`);
    }
  }

  console.log('\n=== Resumen ===');
  console.log(`Obras procesadas: ${resumen.obras}`);
  console.log(`Ofertas encontradas: ${resumen.ofertas}`);
  console.log(`Obras sin ofertas detectadas: ${resumen.sinOfertas}`);
  console.log(`Errores: ${resumen.errores}`);
}

main().catch((err) => {
  console.error('ERROR FATAL:', err.message);
  process.exit(1);
});
