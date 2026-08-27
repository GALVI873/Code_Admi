// Extrae el seguimiento de pedidos de material de la hoja "SEG" del Excel
// "...MEDYSEG.xlsx" que vive en cada carpeta de obra dentro de "SEGUIMIENTO
// DE OBRAS (Aceptadas)" — es el archivo que, según la entrevista de Fase 1,
// lleva Alfredo (Gestión de Obras) para trackear pedidos por proveedor,
// fecha y estado. Una fila por línea de material (Carpintería, Vidrio,
// Persiana, Precerco...), no por ventana individual — el detalle técnico
// por ventana vive en la hoja "BD" del mismo archivo, pero esa queda fuera
// a propósito (demasiado detalle para una vista general, ver conversación).
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

function listarDirs(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory());
  } catch {
    return [];
  }
}

// El nombre del archivo trae un prefijo numérico variable ("2.", "3."...) y
// puntuación inconsistente ("Obra MEDYSEG.xlsx" vs "Obra.MEDYSEG.xlsx") —
// se busca por contener "medyseg" en vez de un patrón exacto.
function archivoMedyseg(rutaObra) {
  let archivos;
  try {
    archivos = fs.readdirSync(rutaObra);
  } catch {
    return null;
  }
  const candidato = archivos.find((n) => /medyseg/i.test(n) && /\.xlsx$/i.test(n) && !n.startsWith('~$'));
  return candidato ? path.join(rutaObra, candidato) : null;
}

// "." es el placeholder que usa la propia plantilla para "todavía sin
// dato" (Proveedor/Fecha/Nº Orden antes de pedir) — se normaliza a null
// igual que un blanco real, no es un valor a mostrar.
function normalizarValor(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (s === '' || s === '.') return null;
  return s;
}

// Las fechas llegan como serial de Excel (número de días desde 1900) leídas
// sin cellDates a propósito: con cellDates, SheetJS las devuelve como Date
// con un desfase de zona horaria que corre la fecha un día para atrás
// (confirmado comparando contra XLSX.SSF.parse_date_code, que da el
// y/m/d exacto sin pasar por Date en ningún momento).
function fechaDeSerial(valor) {
  if (typeof valor !== 'number') return null;
  const { y, m, d } = XLSX.SSF.parse_date_code(valor);
  if (!y) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// La hoja "SEG" es una tabla dinámica: la columna "Posición" solo trae el
// número en la primera fila de cada grupo (ej. Carpintería) y queda en
// blanco en las filas siguientes del mismo grupo (ej. Vidrio, Persiana) —
// hay que arrastrar el último valor visto. "(en blanco)" es un literal que
// escribe la propia tabla dinámica cuando el material no está atado a
// ninguna posición puntual (ej. obras chicas donde Carpintería/Vidrio/
// Persiana aplican a toda la obra, no ventana por ventana) — a diferencia
// de un blanco real (que arrastra la posición anterior), "(en blanco)"
// reinicia el arrastre a null para que las filas siguientes del mismo
// grupo no hereden por error la posición numérica previa.
function extraerMateriales(rutaArchivo) {
  const wb = XLSX.readFile(rutaArchivo);
  const ws = wb.Sheets['SEG'];
  if (!ws) return [];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  const idxHeader = rows.findIndex(
    (r) => r.some((c) => /posici[oó]n/i.test(String(c))) && r.some((c) => /^material$/i.test(String(c).trim())),
  );
  if (idxHeader === -1) return [];

  const header = rows[idxHeader];
  const col = (regex) => header.findIndex((c) => regex.test(String(c).trim()));
  const iPosicion = col(/posici[oó]n/i);
  const iMaterial = col(/^material$/i);
  const iEstado = col(/^estado$/i);
  const iProveedor = col(/^proveedor$/i);
  const iFechaPedido = col(/fecha\s*pedido/i);
  const iOrden = col(/n.\s*\/?\s*orden/i);
  const iFechaEstimada = col(/fecha\s*est/i);
  const iComentario = col(/comentario/i);

  const materiales = [];
  let posicionActual = null;
  for (let i = idxHeader + 1; i < rows.length; i++) {
    const fila = rows[i];
    const primeraCelda = normalizarValor(fila[0]);
    if (primeraCelda && /total general/i.test(primeraCelda)) break;

    const material = normalizarValor(fila[iMaterial]);
    if (!material) continue;

    const posicionCelda = normalizarValor(fila[iPosicion]);
    if (posicionCelda) posicionActual = /en blanco/i.test(posicionCelda) ? null : posicionCelda;

    materiales.push({
      posicion: posicionActual,
      material,
      estado: normalizarValor(fila[iEstado]),
      proveedor: normalizarValor(fila[iProveedor]),
      fecha_pedido: fechaDeSerial(fila[iFechaPedido]),
      numero_orden: normalizarValor(fila[iOrden]),
      fecha_estimada: fechaDeSerial(fila[iFechaEstimada]),
      comentario: normalizarValor(fila[iComentario]),
    });
  }
  return materiales;
}

module.exports = {
  listarDirs,
  archivoMedyseg,
  extraerMateriales,
};
