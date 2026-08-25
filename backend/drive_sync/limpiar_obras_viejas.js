// Limpieza en bloque del panel "Presupuestos en Estudio" a partir de la
// columna D del Excel de seguimiento (Listado_Obras_En_Estudio_2026.xlsx):
//   "Si"                                  -> no se toca (sigue activa)
//   "Esta aprobado" / "...y facturado"    -> se borra del panel (ya se
//                                             trasladó a seguimiento de obra)
//   cualquier otro valor (vacío, "??", …) -> estatus "Descartado" (vieja)
// Resuelve el nombre real de obra contra el mount local de Drive (Z:) para
// no depender de que el texto del Excel esté escrito idéntico al de la
// carpeta; si ya no existe en Drive (obras trasladadas), usa el texto del
// Excel tal cual.
// Uso: node limpiar_obras_viejas.js [--aplicar]   (sin --aplicar, solo simula)
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const EXCEL = 'Z:/DRIVE GALVI/1. GALVI/1.OBRAS/1. ESTUDIOS Y SEGUIMIENTO/Listado_Obras_En_Estudio_2026.xlsx';
const BASE_DRIVE = 'Z:/DRIVE GALVI/1. GALVI/1.OBRAS/1. ESTUDIOS Y SEGUIMIENTO/HOJAS DE CALCULO (PPTOS)/2026';

const APLICAR = process.argv.includes('--aplicar');

function normalizar(s) {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
}

function resolverCarpeta(dir, nombreBuscado) {
  const directo = path.join(dir, nombreBuscado);
  if (fs.existsSync(directo)) return directo;
  if (!fs.existsSync(dir)) return null;
  const objetivo = normalizar(nombreBuscado);
  const hijos = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory());
  const match = hijos.find((d) => normalizar(d.name) === objetivo);
  return match ? path.join(dir, match.name) : null;
}

// Devuelve el nombre real de carpeta (con mayúsculas/tildes tal cual están
// en Drive) si la obra sigue existiendo en el árbol de "en estudio", o null.
function resolverObraReal(categoria, contacto, obra) {
  const dirCategoria = resolverCarpeta(BASE_DRIVE, categoria);
  if (!dirCategoria) return null;
  const dirContacto = categoria === 'Particulares' ? dirCategoria : resolverCarpeta(dirCategoria, contacto);
  if (!dirContacto) return null;
  const dirObra = resolverCarpeta(dirContacto, obra);
  if (!dirObra) return null;
  return path.basename(dirObra);
}

const wb = XLSX.readFile(EXCEL);
const ws = wb.Sheets[wb.SheetNames[0]];
const filas = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' }).slice(1);

const descartar = [];
const eliminar = [];
const siOmitidas = [];

for (const fila of filas) {
  const [categoria, contacto, obra, marca] = [fila[0], fila[1], fila[2], (fila[3] || '').trim()];
  if (!obra) continue;

  const real = resolverObraReal(categoria, contacto, obra);
  const nombreFinal = real || obra;

  if (marca.toLowerCase() === 'si') {
    siOmitidas.push(nombreFinal);
  } else if (marca === 'Esta aprobado' || marca === 'Esta aprobado y facturado') {
    // Si el Excel de cálculo sigue en la carpeta de estudio, borrar la fila
    // no sirve: el próximo sync la vuelve a crear. En ese caso se descarta
    // en vez de eliminar (el estatus manual sí sobrevive al sync).
    if (real) {
      descartar.push({ nombreFinal, enDrive: true, marca: `${marca} (aún en Drive, se descarta en vez de borrar)` });
    } else {
      eliminar.push({ nombreFinal, enDrive: false, marca });
    }
  } else {
    descartar.push({ nombreFinal, enDrive: !!real, marca: marca || '(en blanco)' });
  }
}

console.log(`Sin tocar (Si): ${siOmitidas.length}`);
console.log(`\nA marcar Descartado: ${descartar.length}`);
descartar.forEach((d) => console.log(`  [${d.enDrive ? 'en Drive' : 'NO en Drive'}] ${d.nombreFinal}  (${d.marca})`));
console.log(`\nA eliminar del panel: ${eliminar.length}`);
eliminar.forEach((d) => console.log(`  [${d.enDrive ? 'AÚN en Drive!' : 'no en Drive, ok'}] ${d.nombreFinal}  (${d.marca})`));

if (!APLICAR) {
  console.log('\n(Simulación. Volvé a correr con --aplicar para ejecutar los cambios reales.)');
  process.exit(0);
}

async function aplicar() {
  const base = `${process.env.PANEL_API_URL}/presupuestos_en_estudio.php?token=${process.env.SYNC_TOKEN}`;

  const resMarcar = await fetch(base, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accion: 'marcar_estatus', obras: descartar.map((d) => d.nombreFinal), estatus: 'Descartado' }),
  });
  const dataMarcar = await resMarcar.json();
  if (!resMarcar.ok) throw new Error('marcar_estatus: ' + JSON.stringify(dataMarcar));
  console.log(`\nDescartadas: ${dataMarcar.actualizados} filas actualizadas.`);

  const resEliminar = await fetch(base, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ obras: eliminar.map((d) => d.nombreFinal) }),
  });
  const dataEliminar = await resEliminar.json();
  if (!resEliminar.ok) throw new Error('eliminar: ' + JSON.stringify(dataEliminar));
  console.log(`Eliminadas: ${dataEliminar.eliminados} filas borradas.`);
}

aplicar().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
