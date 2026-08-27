// Genera un Excel legible con el resultado de extraer_ofertas_proveedor.js:
// una hoja con las ofertas encontradas, otra con las obras sin ofertas y el
// motivo (sin carpeta "Valoración" / carpeta vacía / con PDF pero sin un
// total reconocible). Para revisión humana (Geraldinne), no se sube al panel.
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { extraerOfertasDeObra, carpetaValoracion } = require('./extract_ofertas_proveedor.js');

const BASE = 'Z:/DRIVE GALVI/1. GALVI/1.OBRAS/1. ESTUDIOS Y SEGUIMIENTO/HOJAS DE CALCULO (PPTOS)/2026';

function listarDirs(dir) {
  try { return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()); } catch { return []; }
}
function normalizar(s) {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
}
function buscarObra(nombreObjetivo) {
  const objetivo = normalizar(nombreObjetivo);
  for (const cat of listarDirs(BASE)) {
    if (cat.name === 'Particulares') {
      for (const obra of listarDirs(path.join(BASE, cat.name))) {
        if (normalizar(obra.name) === objetivo) return path.join(BASE, cat.name, obra.name);
      }
      continue;
    }
    for (const contacto of listarDirs(path.join(BASE, cat.name))) {
      for (const obra of listarDirs(path.join(BASE, cat.name, contacto.name))) {
        if (normalizar(obra.name) === objetivo) return path.join(BASE, cat.name, contacto.name, obra.name);
      }
    }
  }
  return null;
}

function motivoSinOfertas(rutaObra) {
  const rutaVal = carpetaValoracion(rutaObra);
  if (!rutaVal) return 'Sin carpeta "Valoración"';
  let archivos = [];
  try { archivos = fs.readdirSync(rutaVal).filter((n) => /\.pdf$/i.test(n)); } catch {}
  if (archivos.length === 0) return 'Carpeta "Valoración" vacía';
  return `Tiene ${archivos.length} PDF (${archivos.join(' | ')}) pero ninguno con un total reconocible`;
}

async function main() {
  const listaActivas = JSON.parse(fs.readFileSync('obras_activas_ficha.json', 'utf8'));
  const filasOfertas = [];
  const filasSinOfertas = [];

  for (const nombreObra of listaActivas) {
    const rutaObra = buscarObra(nombreObra);
    if (!rutaObra) {
      filasSinOfertas.push({ Obra: nombreObra, Motivo: 'Carpeta de obra no encontrada' });
      continue;
    }
    const ofertas = await extraerOfertasDeObra(rutaObra);
    if (ofertas.length === 0) {
      filasSinOfertas.push({ Obra: nombreObra, Motivo: motivoSinOfertas(rutaObra) });
    } else {
      for (const o of ofertas) {
        filasOfertas.push({
          Obra: nombreObra,
          Proveedor: o.proveedor || '(sin detectar)',
          Valor: o.valor,
          Fecha: o.fecha || '(sin detectar)',
          Archivo: o.archivo,
        });
      }
    }
  }

  const wb = XLSX.utils.book_new();

  const wsOfertas = XLSX.utils.json_to_sheet(filasOfertas);
  wsOfertas['!cols'] = [{ wch: 32 }, { wch: 22 }, { wch: 12 }, { wch: 12 }, { wch: 55 }];
  XLSX.utils.book_append_sheet(wb, wsOfertas, 'Ofertas encontradas');

  const wsSinOfertas = XLSX.utils.json_to_sheet(filasSinOfertas);
  wsSinOfertas['!cols'] = [{ wch: 32 }, { wch: 90 }];
  XLSX.utils.book_append_sheet(wb, wsSinOfertas, 'Sin ofertas');

  const salida = process.argv[2];
  XLSX.writeFile(wb, salida);
  console.log(`${filasOfertas.length} ofertas en ${new Set(filasOfertas.map((f) => f.Obra)).size} obras, ${filasSinOfertas.length} obras sin ofertas -> ${salida}`);
}

main().catch((err) => {
  console.error('ERROR FATAL:', err.message);
  process.exit(1);
});
