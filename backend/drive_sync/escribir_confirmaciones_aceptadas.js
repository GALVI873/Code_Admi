// Escribe en la columna "CONFIRMACIÓN" (columna C) de la hoja "Ficha" de
// cada obra en "SEGUIMIENTO DE OBRAS (Aceptadas)" los 5 campos que Alfredo
// confirmó/corrigió desde el panel (carpintería, proveedor, RAL, persiana,
// vidrio) — mismo script de automatización COM que ya usa
// llenar_ficha_obras.js (llenar_ficha_com.ps1), solo cambia la columna de
// destino (3 en vez de 2) y la fuente de los valores (el panel, no un PDF).
// Ver obras_aceptadas.php para el PATCH que guarda la confirmación y marca
// confirmado_en.
//
// Uso:
//   node escribir_confirmaciones_aceptadas.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const BASE = 'Z:/DRIVE GALVI/1. GALVI/1.OBRAS/1. ESTUDIOS Y SEGUIMIENTO/SEGUIMIENTO DE OBRAS (Aceptadas)/2026';
const PS_SCRIPT = path.join(__dirname, 'llenar_ficha_com.ps1');

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

// Mismo criterio que sync_obras_aceptadas.js: prefijo numérico más alto y,
// si empatan o no hay prefijo, el modificado más reciente.
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

// Mismas etiquetas que ya usa llenar_ficha_obras.js para escribir la Ficha
// "en estudio" (ahí van a la columna 2, Presupuesto) — acá van a la
// columna 3 (Confirmación).
function construirCamposConfirmacion(obra) {
  return [
    { nombre: 'Carpinteria', etiqueta: '^\\s*Carpinteria', columna: 3, valor: obra.carpinteria },
    { nombre: 'Proveedores', etiqueta: 'Proveedor', columna: 3, valor: obra.proveedor },
    { nombre: 'RAL Silicona', etiqueta: 'RAL Silicona', columna: 3, valor: obra.ral },
    { nombre: 'Persianas', etiqueta: '^Persianas?\\s*:?\\s*$', columna: 3, valor: obra.persiana },
    { nombre: 'Vidrio', etiqueta: '^Vidrio', columna: 3, valor: obra.vidrio },
  ];
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

async function listarObrasConfirmadas() {
  const url = `${process.env.PANEL_API_URL}/obras_aceptadas.php?token=${process.env.SYNC_TOKEN}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accion: 'listar' }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data));
  return data.obras.filter((o) => o.confirmado_en);
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
  const obras = await listarObrasConfirmadas();
  if (obras.length === 0) {
    console.log('No hay obras confirmadas pendientes de escribir.');
    return;
  }

  const resumen = { ok: 0, omitidas: 0, errores: 0 };
  for (const obra of obras) {
    const rutaObra = buscarCarpetaObra(obra.obra);
    if (!rutaObra) {
      console.log(`OMITIDA (carpeta no encontrada): ${obra.obra}`);
      resumen.omitidas++;
      continue;
    }
    const rutaCalculo = archivoCalculo(rutaObra);
    if (!rutaCalculo) {
      console.log(`OMITIDA (sin Excel de cálculo): ${obra.obra}`);
      resumen.omitidas++;
      continue;
    }
    try {
      escribirEnExcel(rutaCalculo, construirCamposConfirmacion(obra));
      console.log(`OK: ${obra.obra}`);
      resumen.ok++;
    } catch (err) {
      console.error(`ERROR en "${obra.obra}": ${err.message}`);
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
