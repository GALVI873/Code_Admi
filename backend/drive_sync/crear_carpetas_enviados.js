// Crea la subcarpeta "Enviados" dentro de cada obra marcada con "Si" en el
// Excel de seguimiento (columna "Generar carpeta de ppto"). Usa el mount
// local de Drive (Z:) para no depender de resolver ids por API.
// Uso: node crear_carpetas_enviados.js <listado.json>
const fs = require('fs');
const path = require('path');

const BASE = 'Z:/DRIVE GALVI/1. GALVI/1.OBRAS/1. ESTUDIOS Y SEGUIMIENTO/HOJAS DE CALCULO (PPTOS)/2026';

const listadoPath = process.argv[2];
if (!listadoPath) {
  console.error('Uso: node crear_carpetas_enviados.js <listado.json>');
  process.exit(1);
}
const marcadas = JSON.parse(fs.readFileSync(listadoPath, 'utf8'));

function normalizar(s) {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

// Busca la carpeta hija de `dir` cuyo nombre normalizado coincide con
// `nombreBuscado`, tolerando espacios/tildes/comas distintas a como está
// escrito en el Excel.
function resolverCarpeta(dir, nombreBuscado) {
  const directo = path.join(dir, nombreBuscado);
  if (fs.existsSync(directo)) return directo;

  if (!fs.existsSync(dir)) return null;
  const objetivo = normalizar(nombreBuscado);
  const hijos = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory());
  const match = hijos.find((d) => normalizar(d.name) === objetivo);
  return match ? path.join(dir, match.name) : null;
}

const resultados = { creadas: [], yaExistian: [], noEncontradas: [] };

for (const { categoria, contacto, obra } of marcadas) {
  const dirCategoria = resolverCarpeta(BASE, categoria);
  if (!dirCategoria) {
    resultados.noEncontradas.push({ categoria, contacto, obra, motivo: 'categoría no encontrada' });
    continue;
  }

  let dirContacto = dirCategoria;
  if (categoria !== 'Particulares') {
    dirContacto = resolverCarpeta(dirCategoria, contacto);
    if (!dirContacto) {
      resultados.noEncontradas.push({ categoria, contacto, obra, motivo: 'contacto no encontrado' });
      continue;
    }
  }

  const dirObra = resolverCarpeta(dirContacto, obra);
  if (!dirObra) {
    resultados.noEncontradas.push({ categoria, contacto, obra, motivo: 'obra no encontrada' });
    continue;
  }

  const dirEnviados = path.join(dirObra, 'Enviados');
  if (fs.existsSync(dirEnviados)) {
    resultados.yaExistian.push({ categoria, contacto, obra, ruta: dirEnviados });
  } else {
    fs.mkdirSync(dirEnviados);
    resultados.creadas.push({ categoria, contacto, obra, ruta: dirEnviados });
  }
}

console.log(`Creadas: ${resultados.creadas.length}`);
console.log(`Ya existían: ${resultados.yaExistian.length}`);
console.log(`No encontradas: ${resultados.noEncontradas.length}`);
console.log('\n=== Creadas ===');
resultados.creadas.forEach((r) => console.log(`  ${r.categoria}/${r.contacto}/${r.obra}`));
console.log('\n=== Ya existían ===');
resultados.yaExistian.forEach((r) => console.log(`  ${r.categoria}/${r.contacto}/${r.obra}`));
console.log('\n=== NO encontradas (revisar manualmente) ===');
resultados.noEncontradas.forEach((r) => console.log(`  [${r.motivo}] ${r.categoria}/${r.contacto}/${r.obra}`));

fs.writeFileSync(
  path.join(__dirname, 'resultado_crear_carpetas_enviados.json'),
  JSON.stringify(resultados, null, 2)
);
