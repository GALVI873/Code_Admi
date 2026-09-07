// Traspaso de Drive al aceptar un presupuesto: mueve la carpeta de la obra
// desde "HOJAS DE CALCULO (PPTOS)" (en estudio) a "SEGUIMIENTO DE OBRAS
// (Aceptadas)", dejando en la carpeta nueva solo el Excel de cálculo, el
// PDF más reciente de "Enviados" (el presupuesto aprobado) y la carpeta
// "1.Organización" completa (con "Valoración" adentro) — el resto de lo
// que había en el origen (versiones viejas, otros PDFs) se archiva en una
// subcarpeta "_Archivo" DENTRO del origen, nunca se borra. También copia
// la plantilla MEDYSEG.xlsx a la carpeta nueva.
//
// Qué obra está pendiente lo decide el panel: presupuestos_en_estudio con
// estatus "Aceptado" y traspaso_estado "pendiente" (se pone solo al marcar
// Aceptado desde el panel — ver presupuestos_en_estudio.php). Al terminar
// cada obra, este script avisa al panel (marcar_traspaso_procesado) — la
// próxima corrida de sync_obras_aceptadas.js ya la encuentra en su nueva
// carpeta y la sube a obras_aceptadas.php con la insignia "Nueva" para
// Alfredo.
//
// Uso:
//   node traspasar_obras_aceptadas.js            (simula, no toca nada)
//   node traspasar_obras_aceptadas.js --aplicar   (ejecuta el traspaso real)
//
// Mismo criterio que limpiar_obras_viejas.js: sin --aplicar es un dry-run
// completo (imprime qué haría con cada obra), así se puede revisar antes
// de tocar carpetas reales.
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const BASE_ORIGEN = 'Z:/DRIVE GALVI/1. GALVI/1.OBRAS/1. ESTUDIOS Y SEGUIMIENTO/HOJAS DE CALCULO (PPTOS)/2026';
const BASE_DESTINO = 'Z:/DRIVE GALVI/1. GALVI/1.OBRAS/1. ESTUDIOS Y SEGUIMIENTO/SEGUIMIENTO DE OBRAS (Aceptadas)/2026';
const PLANTILLA_MEDYSEG = 'Z:/DRIVE GALVI/1. GALVI/1.OBRAS/1. ESTUDIOS Y SEGUIMIENTO/SEGUIMIENTO DE OBRAS (Aceptadas)/2026/MEDYSEG.xlsx';

const APLICAR = process.argv.includes('--aplicar');

// La obra guarda la categoría en singular ("Arquitecto"), la carpeta de
// Drive existe en plural ("Arquitectos") — mismo mapeo que sync_all.js /
// sync_obras_aceptadas.js, invertido.
const CATEGORIA_A_CARPETA = {
  Arquitecto: 'Arquitectos',
  Constructor: 'Constructores',
  Particular: 'Particulares',
  Proveedor: 'Proveedores',
  Reformista: 'Reformistas',
};

function normalizar(s) {
  return String(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function listarDirs(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory());
  } catch {
    return [];
  }
}

function listarArchivos(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isFile());
  } catch {
    return [];
  }
}

// Busca la subcarpeta/archivo hijo de `dir` cuyo nombre normalizado matchea
// exacto, o si se pasa un regex, el primero que matchee ese patrón (mismo
// criterio de "carpeta tolerante a variaciones" que ya usan
// crear_carpetas_enviados.js y sync_all.js).
function resolverCarpeta(dir, nombreOPatron) {
  if (typeof nombreOPatron === 'string') {
    const directo = path.join(dir, nombreOPatron);
    if (fs.existsSync(directo)) return directo;
    const objetivo = normalizar(nombreOPatron);
    const match = listarDirs(dir).find((d) => normalizar(d.name) === objetivo);
    return match ? path.join(dir, match.name) : null;
  }
  const match = listarDirs(dir).find((d) => nombreOPatron.test(d.name));
  return match ? path.join(dir, match.name) : null;
}

function localizarCarpetaObra(categoria, contacto, obra) {
  const dirCategoria = resolverCarpeta(BASE_ORIGEN, CATEGORIA_A_CARPETA[categoria] || categoria);
  if (!dirCategoria) return { error: `categoría "${categoria}" no encontrada en el origen` };

  let dirContacto = dirCategoria;
  if (categoria !== 'Particular') {
    dirContacto = resolverCarpeta(dirCategoria, contacto);
    if (!dirContacto) return { error: `contacto "${contacto}" no encontrado` };
  }

  const dirObra = resolverCarpeta(dirContacto, obra);
  if (!dirObra) return { error: `carpeta de la obra no encontrada` };

  return { dir: dirObra, dirCategoria: path.basename(dirCategoria), dirContacto: categoria !== 'Particular' ? path.basename(dirContacto) : null };
}

// Excel de cálculo suelto en la raíz de la carpeta de obra — mismo filtro
// que esArchivoValido() de sync_all.js (ignora temporales de Excel abiertos
// y el "calculo composite"). Si hay más de uno, se toma el modificado más
// reciente y se avisa — no debería pasar en una obra normal.
function localizarExcelCalculo(dirObra) {
  const candidatos = listarArchivos(dirObra).filter((f) => {
    if (!/\.xlsx?$/i.test(f.name)) return false;
    if (f.name.startsWith('~$')) return false;
    if (/calculo\s*composite/i.test(f.name)) return false;
    return true;
  });
  if (candidatos.length === 0) return { error: 'no se encontró ningún Excel suelto en la carpeta de la obra' };
  const conFecha = candidatos.map((f) => ({
    nombre: f.name,
    ruta: path.join(dirObra, f.name),
    mtime: fs.statSync(path.join(dirObra, f.name)).mtimeMs,
  }));
  conFecha.sort((a, b) => b.mtime - a.mtime);
  return { archivo: conFecha[0], avisoVariosCandidatos: conFecha.length > 1 ? conFecha.map((c) => c.nombre) : null };
}

// PDF más reciente de la carpeta "Enviados" (o variante de nombre) — el que
// se toma como presupuesto aprobado.
function localizarPdfEnviado(dirObra) {
  const dirEnviados = resolverCarpeta(dirObra, /envia/i);
  if (!dirEnviados) return { error: 'no se encontró la carpeta "Enviados"' };
  const pdfs = listarArchivos(dirEnviados).filter((f) => /\.pdf$/i.test(f.name));
  if (pdfs.length === 0) return { error: 'la carpeta "Enviados" no tiene ningún PDF' };
  const conFecha = pdfs.map((f) => ({
    nombre: f.name,
    ruta: path.join(dirEnviados, f.name),
    mtime: fs.statSync(path.join(dirEnviados, f.name)).mtimeMs,
  }));
  conFecha.sort((a, b) => b.mtime - a.mtime);
  return { archivo: conFecha[0], dirEnviados };
}

function localizarOrganizacion(dirObra) {
  const dir = resolverCarpeta(dirObra, /^\d*\.?\s*organizaci[oó]n/i);
  if (!dir) return { error: 'no se encontró la carpeta "1.Organización"' };
  return { dir };
}

async function pedirPendientes() {
  const url = `${process.env.PANEL_API_URL}/presupuestos_en_estudio.php?token=${process.env.SYNC_TOKEN}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accion: 'listar_pendientes_traspaso' }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data));
  return data.presupuestos;
}

async function marcarProcesado(obra) {
  const url = `${process.env.PANEL_API_URL}/presupuestos_en_estudio.php?token=${process.env.SYNC_TOKEN}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ obra, accion: 'marcar_traspaso_procesado' }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data));
}

function moverArchivo(origen, destino, resultados) {
  if (APLICAR) fs.renameSync(origen, destino);
  resultados.push(`  mover archivo: "${origen}" -> "${destino}"`);
}

function moverCarpeta(origen, destino, resultados) {
  if (APLICAR) {
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    try {
      fs.renameSync(origen, destino);
    } catch (err) {
      // Z:\ es un mount de Drive Desktop — si el rename directo falla
      // (puede pasar con archivos "solo en la nube"), se copia y se borra
      // el original como alternativa.
      fs.cpSync(origen, destino, { recursive: true });
      fs.rmSync(origen, { recursive: true, force: true });
    }
  }
  resultados.push(`  mover carpeta: "${origen}" -> "${destino}"`);
}

async function procesarObra(p) {
  const resultados = [];
  console.log(`\n=== ${p.obra} ===`);

  const carpeta = localizarCarpetaObra(p.categoria, p.contacto, p.obra);
  if (carpeta.error) {
    console.log(`  OMITIDA: ${carpeta.error}`);
    return { ok: false };
  }
  const dirObraOrigen = carpeta.dir;

  const excel = localizarExcelCalculo(dirObraOrigen);
  if (excel.error) {
    console.log(`  OMITIDA: ${excel.error}`);
    return { ok: false };
  }
  if (excel.avisoVariosCandidatos) {
    console.log(`  AVISO: hay ${excel.avisoVariosCandidatos.length} Excel en la carpeta, se toma el más reciente: ${excel.avisoVariosCandidatos.join(', ')}`);
  }

  const pdf = localizarPdfEnviado(dirObraOrigen);
  if (pdf.error) {
    console.log(`  OMITIDA: ${pdf.error}`);
    return { ok: false };
  }

  const organizacion = localizarOrganizacion(dirObraOrigen);
  if (organizacion.error) {
    console.log(`  AVISO: ${organizacion.error} — se traspasa igual sin ella`);
  }

  const dirDestinoCategoria = path.join(BASE_DESTINO, carpeta.dirCategoria);
  const dirDestinoObra = carpeta.dirContacto
    ? path.join(dirDestinoCategoria, carpeta.dirContacto, p.obra)
    : path.join(dirDestinoCategoria, p.obra);

  if (fs.existsSync(dirDestinoObra) && listarArchivos(dirDestinoObra).length + listarDirs(dirDestinoObra).length > 0) {
    console.log(`  OMITIDA: ya existe una carpeta con contenido en el destino (${dirDestinoObra}) — revisar a mano`);
    return { ok: false };
  }

  console.log(`  Origen: ${dirObraOrigen}`);
  console.log(`  Destino: ${dirDestinoObra}`);

  if (APLICAR) fs.mkdirSync(dirDestinoObra, { recursive: true });

  moverArchivo(excel.archivo.ruta, path.join(dirDestinoObra, excel.archivo.nombre), resultados);
  moverArchivo(pdf.archivo.ruta, path.join(dirDestinoObra, pdf.archivo.nombre), resultados);
  if (!organizacion.error) {
    moverCarpeta(organizacion.dir, path.join(dirDestinoObra, path.basename(organizacion.dir)), resultados);
  }

  // Lo que sobra en el origen (otras versiones de Excel, otros PDFs de
  // Enviados, carpetas viejas) se archiva junto, no se borra nada.
  const dirArchivo = path.join(dirObraOrigen, '_Archivo');
  const sobrantes = [
    ...listarArchivos(dirObraOrigen).filter((f) => f.name !== excel.archivo.nombre && f.name !== '_Archivo'),
    ...listarDirs(dirObraOrigen).filter((d) => d.name !== '_Archivo' && (!organizacion.dir || d.name !== path.basename(organizacion.dir))),
  ];
  if (sobrantes.length > 0) {
    if (APLICAR) fs.mkdirSync(dirArchivo, { recursive: true });
    for (const item of sobrantes) {
      const origenItem = path.join(dirObraOrigen, item.name);
      const destinoItem = path.join(dirArchivo, item.name);
      if (item.isDirectory()) moverCarpeta(origenItem, destinoItem, resultados);
      else moverArchivo(origenItem, destinoItem, resultados);
    }
  }

  const medysegDestino = path.join(dirDestinoObra, `${p.obra} MEDYSEG.xlsx`);
  if (APLICAR) fs.copyFileSync(PLANTILLA_MEDYSEG, medysegDestino);
  resultados.push(`  copiar plantilla MEDYSEG: "${PLANTILLA_MEDYSEG}" -> "${medysegDestino}"`);

  resultados.forEach((r) => console.log(r));

  if (APLICAR) {
    await marcarProcesado(p.obra);
    console.log('  OK — avisado al panel.');
  } else {
    console.log('  (simulado, nada se movió — correr con --aplicar para ejecutar)');
  }

  return { ok: true };
}

async function main() {
  console.log(APLICAR ? 'MODO REAL: se van a mover archivos de verdad.' : 'MODO SIMULACIÓN (sin --aplicar) — no se toca nada.');

  const pendientes = await pedirPendientes();
  console.log(`Obras pendientes de traspaso: ${pendientes.length}`);
  if (pendientes.length === 0) return;

  let ok = 0;
  let omitidas = 0;
  for (const p of pendientes) {
    const resultado = await procesarObra(p);
    if (resultado.ok) ok++;
    else omitidas++;
  }

  console.log(`\n=== Resumen ===`);
  console.log(`Procesadas: ${ok}`);
  console.log(`Omitidas (revisar a mano): ${omitidas}`);
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
