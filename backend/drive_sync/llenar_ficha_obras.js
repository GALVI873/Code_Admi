// Llena la hoja "Ficha" del Excel de cálculo de una obra a partir del PDF
// más reciente en su carpeta "Enviados" (fabricante, serie, colores, tipo de
// apertura, motor, etc. — ver extraerCamposFicha en extract_from_sent_pdf.js)
// más la Dirección/Cliente que ya se derivan de la carpeta de Drive.
//
// Escribe con automatización COM de Excel real (llenar_ficha_com.ps1), NO
// con la librería xlsx: un ida-y-vuelta de xlsx sin ningún cambio ya infló
// este mismo tipo de archivo de 149 KB a 5.4 MB (rompe formato/fórmulas).
//
// Uso:
//   node llenar_ficha_obras.js "Prado Jerez" "Sauceda,8"   (obras puntuales, para pilotear)
//   node llenar_ficha_obras.js --todas                      (todas las que tengan Enviados con PDF;
//                                                             deja resultado_llenar_ficha.json con el detalle)
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const pdfParse = require('pdf-parse');
const { extraerCamposFicha, extraerNumeroPpto, esPdfDeCarpinteria } = require('./extract_from_sent_pdf.js');

const BASE = 'Z:/DRIVE GALVI/1. GALVI/1.OBRAS/1. ESTUDIOS Y SEGUIMIENTO/HOJAS DE CALCULO (PPTOS)/2026';
const PS_SCRIPT = path.join(__dirname, 'llenar_ficha_com.ps1');

function normalizar(s) {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
}

function listarDirs(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory());
  } catch {
    return [];
  }
}

// Busca recursivamente (sin bajar a subcarpetas de organización) una
// carpeta cuyo nombre coincida con `nombreObjetivo`, en cualquier categoría/
// contacto. Devuelve { rutaObra, categoria, contacto } o null.
function buscarObra(nombreObjetivo) {
  const objetivo = normalizar(nombreObjetivo);
  for (const cat of listarDirs(BASE)) {
    if (cat.name === 'Particulares') {
      for (const obra of listarDirs(path.join(BASE, cat.name))) {
        if (normalizar(obra.name) === objetivo) {
          return { rutaObra: path.join(BASE, cat.name, obra.name), categoria: cat.name, contacto: null };
        }
      }
      continue;
    }
    for (const contacto of listarDirs(path.join(BASE, cat.name))) {
      for (const obra of listarDirs(path.join(BASE, cat.name, contacto.name))) {
        if (normalizar(obra.name) === objetivo) {
          return {
            rutaObra: path.join(BASE, cat.name, contacto.name, obra.name),
            categoria: cat.name,
            contacto: contacto.name,
          };
        }
      }
    }
  }
  return null;
}

function archivosRecursivo(dir, filtro, profundidad = 0) {
  if (profundidad > 5) return [];
  let encontrados = [];
  for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
    const rutaCompleta = path.join(dir, entrada.name);
    if (entrada.isDirectory()) {
      encontrados = encontrados.concat(archivosRecursivo(rutaCompleta, filtro, profundidad + 1));
    } else if (filtro(entrada.name)) {
      encontrados.push(rutaCompleta);
    }
  }
  return encontrados;
}

function extraerPrefijoNumerico(nombreArchivo) {
  const m = path.basename(nombreArchivo).match(/^(\d+)\./);
  return m ? parseInt(m[1], 10) : -1;
}

// El mismo criterio que sync_all.js: el Excel de cálculo vigente es el de
// mayor prefijo numérico y, si empatan, el modificado más reciente.
function elegirCalculoVigente(rutaObra) {
  const candidatos = archivosRecursivo(rutaObra, (n) => /CALCULO.*\.xlsx$/i.test(n) && !n.startsWith('~$'));
  if (candidatos.length === 0) return null;
  candidatos.sort((a, b) => {
    const prefA = extraerPrefijoNumerico(a);
    const prefB = extraerPrefijoNumerico(b);
    if (prefA !== prefB) return prefB - prefA;
    return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs;
  });
  return candidatos[0];
}

function listarPdfsEnviados(rutaObra) {
  const subcarpetasEnviados = listarDirs(rutaObra).filter((d) => /envia/i.test(d.name));
  let pdfs = [];
  for (const carpeta of subcarpetasEnviados) {
    pdfs = pdfs.concat(archivosRecursivo(path.join(rutaObra, carpeta.name), (n) => /\.pdf$/i.test(n) && !n.startsWith('~$')));
  }
  return pdfs;
}

// Clasifica los PDF de Enviados en "principal" (el de carpintería más
// reciente — entre varias opciones "Opción A/Op.1" vs "Opción B/Op.2", gana
// la más reciente, ya que la Ficha es un solo Excel y no hay dónde poner
// dos) y "complementarios" (presupuestos de otro producto que acompañan a
// la obra, ej. motorización de persianas existentes — no tienen la
// estructura de un presupuesto de carpintería). Si no hay ningún PDF de
// carpintería, la obra queda para llenado manual (motivo específico, no se
// escribe nada).
async function elegirPdfPrincipalYComplementarios(rutaObra) {
  const pdfs = listarPdfsEnviados(rutaObra);
  if (pdfs.length === 0) return { principal: null, complementarios: [], motivo: 'sin PDF en Enviados' };

  const clasificados = [];
  for (const rutaPdf of pdfs) {
    const buffer = fs.readFileSync(rutaPdf);
    const { text } = await pdfParse(buffer);
    clasificados.push({ ruta: rutaPdf, text, esCarpinteria: esPdfDeCarpinteria(text), mtime: fs.statSync(rutaPdf).mtimeMs });
  }

  const deCarpinteria = clasificados.filter((c) => c.esCarpinteria).sort((a, b) => b.mtime - a.mtime);
  if (deCarpinteria.length === 0) {
    return { principal: null, complementarios: [], motivo: 'ningún PDF con formato de carpintería reconocido (revisar a mano)' };
  }
  const complementarios = clasificados.filter((c) => !c.esCarpinteria);
  return { principal: deCarpinteria[0], complementarios, motivo: null };
}

// Red de seguridad: la automatización COM de Excel desde PowerShell deja
// procesos zombie con bastante facilidad (ya pasó varias veces durante las
// pruebas) si queda alguna referencia COM intermedia sin liberar. Un Excel
// lanzado por automatización siempre corre con el argumento "-Embedding" —
// una sesión real de alguien abriendo el archivo a mano nunca muestra eso —
// así que es seguro cerrar cualquiera que quede así después de cada corrida.
function cerrarExcelHuerfano() {
  try {
    execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        "Get-CimInstance Win32_Process -Filter \"Name='EXCEL.EXE'\" | Where-Object { $_.CommandLine -like '*-Embedding*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }",
      ],
      { encoding: 'utf8' },
    );
  } catch {
    // no hay nada que cerrar, o powershell no tenía permiso — no es fatal
  }
}

function fechaASerialExcel(fecha) {
  const epoch = Date.UTC(1899, 11, 30);
  return Math.round((Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate()) - epoch) / 86400000);
}

// Recorre toda la carpeta de "en estudio" y devuelve una entrada por cada
// carpeta de obra (Categoria/[Contacto]/Obra), sin bajar a subcarpetas de
// organización. No filtra por si tiene Enviados o no — eso lo decide
// procesarObraInfo, para poder reportar el motivo de cada omisión.
function listarTodasLasObras() {
  const obras = [];
  for (const cat of listarDirs(BASE)) {
    if (cat.name === 'Particulares') {
      for (const obra of listarDirs(path.join(BASE, cat.name))) {
        obras.push({ nombre: obra.name, rutaObra: path.join(BASE, cat.name, obra.name), categoria: cat.name, contacto: null });
      }
      continue;
    }
    for (const contacto of listarDirs(path.join(BASE, cat.name))) {
      for (const obra of listarDirs(path.join(BASE, cat.name, contacto.name))) {
        obras.push({
          nombre: obra.name,
          rutaObra: path.join(BASE, cat.name, contacto.name, obra.name),
          categoria: cat.name,
          contacto: contacto.name,
        });
      }
    }
  }
  return obras;
}

async function procesarObraInfo(nombreObra, info) {
  const rutaCalculo = elegirCalculoVigente(info.rutaObra);
  if (!rutaCalculo) return { obra: nombreObra, ok: false, motivo: 'sin Excel de cálculo' };

  const { principal, complementarios, motivo } = await elegirPdfPrincipalYComplementarios(info.rutaObra);
  if (!principal) return { obra: nombreObra, ok: false, motivo };

  const campos = extraerCamposFicha(principal.text);
  const fechaPdf = fs.statSync(principal.ruta).mtime;

  // Los números de presupuestos complementarios (ej. motorización de
  // persianas) se agregan al Nº Ppto para que quede visible que la obra se
  // compone de varios presupuestos ligados — la Fecha sigue siendo la del
  // presupuesto principal (de carpintería) únicamente.
  const numerosComplementarios = complementarios
    .map((c) => extraerNumeroPpto(c.text))
    .filter((n) => n && n !== campos.numeroPpto);
  const numeroPptoCompleto = [campos.numeroPpto, ...numerosComplementarios].filter(Boolean).join(', ') || null;

  const celdas = {
    C6: path.basename(info.rutaObra),
    B8: info.contacto || info.categoria,
    B11: numeroPptoCompleto,
    B12: fechaASerialExcel(fechaPdf),
    B13: campos.carpinteria,
    B14: campos.proveedor,
    B15: campos.colorCarpinteria,
    // B16 (Series) queda sin tocar a propósito: la serie ahora va desglosada
    // por tipo de apertura en Correderas/Abatibles (pueden ser distintas).
    B17: campos.correderas,
    B18: campos.abatibles,
    B19: campos.vidrio,
    B20: campos.persianas,
    B21: campos.colorPersianas,
    B22: campos.modeloLamas,
    B23: campos.motorRadio,
    B24: campos.motorMecanico,
    B25: campos.composite,
    B26: campos.ralSilicona,
  };

  const jsonPath = path.join(os.tmpdir(), `ficha_${Date.now()}_${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(celdas), 'utf8');
  try {
    execFileSync(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', PS_SCRIPT, '-RutaExcel', rutaCalculo, '-RutaJson', jsonPath],
      { encoding: 'utf8' },
    );
  } finally {
    fs.unlinkSync(jsonPath);
    cerrarExcelHuerfano();
  }

  return {
    obra: nombreObra,
    ok: true,
    rutaCalculo,
    rutaPdf: principal.ruta,
    complementarios: complementarios.map((c) => path.basename(c.ruta)),
    celdas,
  };
}

async function procesarObra(nombreObra) {
  const info = buscarObra(nombreObra);
  if (!info) return { obra: nombreObra, ok: false, motivo: 'obra no encontrada' };
  return procesarObraInfo(nombreObra, info);
}

async function main() {
  let args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('Uso: node llenar_ficha_obras.js "Obra 1" "Obra 2" ...  (o --todas, o --lista archivo.json)');
    process.exit(1);
  }

  // --lista evita problemas de escapado de acentos/comas por consola: el
  // archivo es un array JSON de nombres de obra, ej. ["Prado Jerez", ...].
  if (args[0] === '--lista') {
    const nombres = JSON.parse(fs.readFileSync(args[1], 'utf8'));
    args = nombres;
  }

  const resultados = { ok: [], omitidas: [] };

  if (args[0] === '--todas') {
    const todas = listarTodasLasObras();
    console.log(`Recorriendo ${todas.length} obras...\n`);
    for (const info of todas) {
      const resultado = await procesarObraInfo(info.nombre, info);
      if (!resultado.ok) {
        console.log(`OMITIDA (${resultado.motivo}): ${info.nombre}`);
        resultados.omitidas.push({ obra: info.nombre, motivo: resultado.motivo });
        continue;
      }
      console.log(`OK: ${info.nombre}`);
      resultados.ok.push({ obra: info.nombre, rutaCalculo: resultado.rutaCalculo, rutaPdf: resultado.rutaPdf, celdas: resultado.celdas });
    }
  } else {
    for (const nombreObra of args) {
      console.log(`\n=== ${nombreObra} ===`);
      const resultado = await procesarObra(nombreObra);
      if (!resultado.ok) {
        console.log(`OMITIDA: ${resultado.motivo}`);
        resultados.omitidas.push({ obra: nombreObra, motivo: resultado.motivo });
        continue;
      }
      console.log(`Excel: ${resultado.rutaCalculo}`);
      console.log(`PDF:   ${resultado.rutaPdf}`);
      console.log('Celdas escritas:', JSON.stringify(resultado.celdas, null, 2));
      resultados.ok.push({ obra: nombreObra, rutaCalculo: resultado.rutaCalculo, rutaPdf: resultado.rutaPdf, celdas: resultado.celdas });
    }
  }

  console.log(`\n=== Resumen ===`);
  console.log(`OK: ${resultados.ok.length}`);
  console.log(`Omitidas: ${resultados.omitidas.length}`);
  const resumenPorMotivo = {};
  for (const o of resultados.omitidas) resumenPorMotivo[o.motivo] = (resumenPorMotivo[o.motivo] || 0) + 1;
  console.log('Motivos:', JSON.stringify(resumenPorMotivo, null, 2));

  fs.writeFileSync(path.join(__dirname, 'resultado_llenar_ficha.json'), JSON.stringify(resultados, null, 2), 'utf8');
  console.log('\nDetalle completo guardado en resultado_llenar_ficha.json');
}

main().catch((err) => {
  console.error('ERROR FATAL:', err.message);
  process.exit(1);
});
