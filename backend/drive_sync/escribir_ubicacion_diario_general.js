// Escribe de vuelta en el Excel real (Z:\DRIVE GALVI\3. PUESTO TÉCNICO\1.
// Diario General Galvi.xlsx, hoja "Diario General") los cambios de
// Ubicación que Alfredo/Álvaro hicieron desde el panel — mismo mecanismo de
// automatización COM que ya usa escribir_confirmaciones_aceptadas.js para
// la Ficha (llenar_diario_general_com.ps1). Hasta ahora Ubicación solo
// sobrevivía en el panel (diario_general_ubicacion, ver diario_general.php)
// sin llegar nunca al archivo real; este script cierra ese círculo.
//
// Como escribir_confirmaciones_aceptadas.js, requiere el mount Z:\ de Drive
// Desktop y Excel instalado — solo puede correr en esta máquina local, no
// en GitHub Actions.
//
// Uso:
//   node escribir_ubicacion_diario_general.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const RUTA_EXCEL = 'Z:/DRIVE GALVI/3. PUESTO TÉCNICO/1. Diario General Galvi.xlsx';
const PS_SCRIPT = path.join(__dirname, 'llenar_diario_general_com.ps1');

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

async function listarPendientes() {
  const url = `${process.env.PANEL_API_URL}/diario_general.php?token=${process.env.SYNC_TOKEN}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accion: 'listar_pendientes_ubicacion' }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data));
  return data.items || [];
}

// Nombres de columna exactos de la hoja "Diario General" (ver
// extract_diario_general.js) — se mandan por JSON en vez de dejar que el
// .ps1 los tenga como literales, porque Windows PowerShell 5.1 lee un .ps1
// sin BOM con el codepage ANSI del sistema y corrompe las tildes en tiempo
// de ejecución (confirmado con una corrida real: 'Obra' funcionaba,
// 'Ubicación'/'Categoría' no). El JSON sí se lee forzando UTF-8 en el
// script, así que ahí las tildes llegan bien.
const COLUMNAS = {
  obra: 'Obra',
  categoria: 'Categoría',
  descripcion: 'Descripción',
  proveedor: 'Proveedor',
  material: 'Material',
  color: 'Color',
  ubicacion: 'Ubicación',
};

function escribirEnExcel(items) {
  const jsonPath = path.join(os.tmpdir(), `diario_general_ubicacion_${Date.now()}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify({ columnas: COLUMNAS, items }), 'utf8');
  try {
    const salida = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', PS_SCRIPT, '-RutaExcel', RUTA_EXCEL, '-RutaJson', jsonPath],
      { encoding: 'utf8' },
    );
    console.log(salida.trim());
  } finally {
    fs.unlinkSync(jsonPath);
    cerrarExcelHuerfano();
  }
}

async function main() {
  if (!fs.existsSync(RUTA_EXCEL)) {
    console.error(`No se encontró el archivo (¿está montada la unidad Z:\\?): ${RUTA_EXCEL}`);
    process.exit(1);
  }

  const items = await listarPendientes();
  if (items.length === 0) {
    console.log('No hay cambios de Ubicación pendientes de escribir.');
    return;
  }

  console.log(`Escribiendo ${items.length} cambio(s) de Ubicación...`);
  escribirEnExcel(items);
  console.log('Listo.');
}

main().catch((err) => {
  console.error('ERROR FATAL:', err.message);
  process.exit(1);
});
