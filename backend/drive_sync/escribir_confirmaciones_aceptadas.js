// Escribe en la columna "CONFIRMACIÓN" (columna C) de la hoja "Ficha" de
// cada obra en "SEGUIMIENTO DE OBRAS (Aceptadas)" los campos que Alfredo
// confirmó/corrigió desde el panel — mismo script de automatización COM que
// ya usa llenar_ficha_obras.js (llenar_ficha_com.ps1), solo cambia la
// columna de destino (3 en vez de 2) y la fuente de los valores (el panel,
// no un PDF). Ver obras_aceptadas.php para el PATCH que guarda cada
// confirmación en obra_aceptada_confirmaciones.
//
// Uso:
//   node escribir_confirmaciones_aceptadas.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { CAMPOS_CONFIRMABLES } = require('./extract_ficha_aceptada.js');

const BASE = 'Z:/DRIVE GALVI/1. GALVI/1.OBRAS/1. ESTUDIOS Y SEGUIMIENTO/SEGUIMIENTO DE OBRAS (Aceptadas)/2026';
const PS_SCRIPT = path.join(__dirname, 'llenar_ficha_com.ps1');

// Mismo nombre de etiqueta que llenar_ficha_obras.js usa para escribir
// estos mismos campos en la columna "Presupuesto" — acá van a la columna
// "Confirmación". CAMPOS_CONFIRMABLES (de extract_ficha_aceptada.js) trae
// la regex de cada campo; llenar_ficha_com.ps1 espera un string de regex,
// no un objeto RegExp, así que se convierte con .source.
const NOMBRE_CAMPO = {
  proveedor: 'Proveedores',
  color_carpinteria: 'Color Carpinteria',
  correderas: 'Correderas',
  abatibles: 'Abatibles',
  vidrio: 'Vidrio',
  ral: 'RAL Silicona',
  persiana: 'Persianas',
  color_persiana: 'Color Persianas',
  modelo_lamas: 'Modelo de Lamas',
  motor_radio: 'Motor Radio',
  motor_mecanico: 'Motor mecanico',
};

function listarDirs(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory());
  } catch {
    return [];
  }
}

function buscarCarpetaObra(nombreObra) {
  for (const cat of listarDirs(BASE)) {
    if (cat.name === 'Particulares') {
      for (const obra of listarDirs(path.join(BASE, cat.name))) {
        if (obra.name === nombreObra) return path.join(BASE, cat.name, obra.name);
      }
      continue;
    }
    for (const contacto of listarDirs(path.join(BASE, cat.name))) {
      for (const obra of listarDirs(path.join(BASE, cat.name, contacto.name))) {
        if (obra.name === nombreObra) return path.join(BASE, cat.name, contacto.name, obra.name);
      }
    }
  }
  return null;
}

function extraerPrefijoNumerico(nombreArchivo) {
  const m = nombreArchivo.match(/^(\d+)\./);
  return m ? parseInt(m[1], 10) : null;
}

function archivoCalculo(rutaObra) {
  let archivos;
  try {
    archivos = fs.readdirSync(rutaObra);
  } catch {
    return null;
  }
  const candidatos = archivos.filter((n) => /CALCULO.*\.xlsx$/i.test(n) && !n.startsWith('~$'));
  if (candidatos.length === 0) return null;
  candidatos.sort((a, b) => {
    const prefA = extraerPrefijoNumerico(a) ?? -1;
    const prefB = extraerPrefijoNumerico(b) ?? -1;
    if (prefA !== prefB) return prefB - prefA;
    return fs.statSync(path.join(rutaObra, b)).mtimeMs - fs.statSync(path.join(rutaObra, a)).mtimeMs;
  });
  return path.join(rutaObra, candidatos[0]);
}

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

async function listarConfirmaciones() {
  const url = `${process.env.PANEL_API_URL}/obras_aceptadas.php?token=${process.env.SYNC_TOKEN}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accion: 'listar' }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data));
  return data.confirmaciones || [];
}

// Agrupa las confirmaciones (filas sueltas, una por campo) por obra, para
// escribir todos los campos confirmados de una misma obra en una sola
// apertura de Excel.
function agruparPorObra(confirmaciones) {
  const mapa = new Map();
  for (const c of confirmaciones) {
    if (!mapa.has(c.obra)) mapa.set(c.obra, []);
    mapa.get(c.obra).push(c);
  }
  return mapa;
}

function construirCamposParaEscribir(confirmacionesDeLaObra) {
  return confirmacionesDeLaObra
    .filter((c) => CAMPOS_CONFIRMABLES[c.campo])
    .map((c) => ({
      nombre: NOMBRE_CAMPO[c.campo] || c.campo,
      etiqueta: CAMPOS_CONFIRMABLES[c.campo].source,
      columna: 3,
      valor: c.valor,
    }));
}

function escribirEnExcel(rutaCalculo, campos) {
  const jsonPath = path.join(os.tmpdir(), `confirmacion_${Date.now()}_${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(campos), 'utf8');
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
}

async function main() {
  const confirmaciones = await listarConfirmaciones();
  if (confirmaciones.length === 0) {
    console.log('No hay confirmaciones pendientes de escribir.');
    return;
  }

  const porObra = agruparPorObra(confirmaciones);
  const resumen = { ok: 0, omitidas: 0, errores: 0 };

  for (const [nombreObra, confirmacionesDeLaObra] of porObra) {
    const rutaObra = buscarCarpetaObra(nombreObra);
    if (!rutaObra) {
      console.log(`OMITIDA (carpeta no encontrada): ${nombreObra}`);
      resumen.omitidas++;
      continue;
    }
    const rutaCalculo = archivoCalculo(rutaObra);
    if (!rutaCalculo) {
      console.log(`OMITIDA (sin Excel de cálculo): ${nombreObra}`);
      resumen.omitidas++;
      continue;
    }
    try {
      const campos = construirCamposParaEscribir(confirmacionesDeLaObra);
      escribirEnExcel(rutaCalculo, campos);
      console.log(`OK (${campos.length} campo(s)): ${nombreObra}`);
      resumen.ok++;
    } catch (err) {
      console.error(`ERROR en "${nombreObra}": ${err.message}`);
      resumen.errores++;
    }
  }

  console.log('\n=== Resumen ===');
  console.log(`OK: ${resumen.ok}`);
  console.log(`Omitidas: ${resumen.omitidas}`);
  console.log(`Errores: ${resumen.errores}`);
}

main().catch((err) => {
  console.error('ERROR FATAL:', err.message);
  process.exit(1);
});
