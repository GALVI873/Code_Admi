<?php
declare(strict_types=1);

// Prioridades — obras en fase de finalización (a pedido de Álvaro,
// 2026-09-30). Reemplaza su planilla "Cronograma de obra — Vallehermoso,
// CEA, Manipa y Archanda": por cada obra aceptada que se agrega acá, una
// lista de tareas de cierre (repasos, chapas, composite, barandillas...)
// con categoría, responsable, fechas y estado, más un Gantt y el "fin
// previsto" contra una fecha objetivo. Independiente de Planificación a
// propósito: cada obra en cierre "tiene vida propia", así que las
// CATEGORÍAS también son de cada obra (se agregan, renombran y colorean
// por obra) — al agregar una obra arranca con "Mano de obra" y "Composite",
// las dos que usaba la planilla.
//
// SOLO admin, tanto para ver como para modificar (por ahora es una
// herramienta de Álvaro; ver AppLayout.jsx).
//
// GET: obras, categorías, tareas, obras aceptadas disponibles para agregar
//   y responsables ya usados (para autocompletar).
// POST {accion:"agregar_obra", obra, alias?}
// PATCH {accion:"actualizar_obra", id, alias?, nota?, fecha_objetivo?}
// DELETE {accion:"eliminar_obra", id}: borra la obra con sus categorías y tareas.
// POST {accion:"agregar_categoria", obra_id, nombre, color?}
// PATCH {accion:"actualizar_categoria", id, nombre?, color?}
// DELETE {accion:"eliminar_categoria", id}: las tareas quedan sin categoría.
// POST {accion:"agregar_zona", obra_id, nombre} / PATCH {accion:
//   "actualizar_zona", id, nombre} / DELETE {accion:"eliminar_zona", id}:
//   "fachadas" (o zonas) de una obra — a pedido de Álvaro (2026-09-30), ej.
//   Cea Bermudez se divide en CEA y Vallehermoso. Una tarea puede ir en una
//   fachada o directamente en la obra; al borrar la fachada sus tareas
//   quedan en la obra.
// POST {accion:"agregar_accion", obra_id, nombre, color?} / PATCH
//   {accion:"actualizar_accion", id, nombre?, color?} / DELETE {accion:
//   "eliminar_accion", id}: lista de "Acción" de la obra (ej. Falta
//   material, Pend. Ppto) — a pedido de Álvaro (2026-10-01) funciona igual
//   que Categoría: cada obra tiene la suya y cada tarea elige una. Reemplaza
//   las casillas falta_material/pendiente_ppto (que quedan en la tabla sin
//   usarse; se migraron a acciones una sola vez).
// POST {accion:"agregar_tarea", obra_id, categoria_id?, zona_id?, descripcion?}
// PATCH {accion:"actualizar_tarea", id, ...campos}: solo pisa lo mandado.
// DELETE {accion:"eliminar_tarea", id}
// POST {accion:"enviar_a_alfredo", id, nota?, reenviar?}: pasa la tarea a
//   Alfredo como nota URGENTE en Seguimiento → Notas de esa obra
//   (comentarios_obra con urgente = 1) — a pedido de Álvaro, 2026-10-01.
//   Guarda en la tarea cuándo se envió y la nota creada; si ya se había
//   enviado y esa nota sigue abierta, no la duplica salvo reenviar = true.
//   No toca el estado de la tarea: que Alfredo resuelva su parte no
//   significa que esté Terminada (eso es cuando está hecha en obra).

const ESTADOS_PRIORIDAD = ['Pendiente', 'En curso', 'Terminado'];
// Pastel, mismo criterio que Planificación — se van asignando en orden a
// cada categoría nueva (después se puede cambiar).
const COLORES_PRIORIDAD = ['#f8d7bc', '#bfdcf3', '#c6e9cc', '#dccbf0', '#f4e5ad', '#f5c9c9', '#bde6d9', '#dde2e7'];
const CATEGORIAS_INICIALES = [['Mano de obra', '#f8d7bc'], ['Composite', '#bfdcf3']];
const ACCIONES_INICIALES = [['Falta material', '#fbe3d3'], ['Pend. Ppto', '#f5c9c9']];

// Crea las acciones iniciales de una obra y devuelve [nombre => id].
function crearAccionesIniciales(PDO $db, int $obraId): array
{
    $ids = [];
    foreach (ACCIONES_INICIALES as [$nombre, $color]) {
        $db->prepare('INSERT INTO prioridades_acciones (obra_id, nombre, color) VALUES (?, ?, ?)')->execute([$obraId, $nombre, $color]);
        $ids[$nombre] = (int) $db->lastInsertId();
    }
    return $ids;
}

$config = require __DIR__ . '/../../backend/bootstrap.php';

function textoPrioridad($valor): ?string
{
    $valor = trim((string) ($valor ?? ''));
    return $valor === '' ? null : $valor;
}

function fechaPrioridad($valor, string $campo): ?string
{
    $valor = textoPrioridad($valor);
    if ($valor !== null && !preg_match('/^\d{4}-\d{2}-\d{2}$/', $valor)) {
        Response::error("\"$campo\" debe tener formato AAAA-MM-DD", 422);
    }
    return $valor;
}

function colorPrioridad($valor): ?string
{
    $valor = textoPrioridad($valor);
    if ($valor !== null && !preg_match('/^#[0-9a-fA-F]{6}$/', $valor)) {
        Response::error('"color" debe tener formato #RRGGBB', 422);
    }
    return $valor;
}

function filaPor(PDO $db, string $tabla, int $id): ?array
{
    $stmt = $db->prepare("SELECT * FROM $tabla WHERE id = ?");
    $stmt->execute([$id]);
    return $stmt->fetch() ?: null;
}

try {
    $db = Database::connection($config);

    $db->exec("
        CREATE TABLE IF NOT EXISTS prioridades_obras (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          obra TEXT NOT NULL UNIQUE,
          alias TEXT,
          nota TEXT,
          fecha_objetivo TEXT,
          creado_por TEXT,
          creado_en TEXT NOT NULL DEFAULT (datetime('now'))
        )
    ");
    $db->exec("
        CREATE TABLE IF NOT EXISTS prioridades_categorias (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          obra_id INTEGER NOT NULL,
          nombre TEXT NOT NULL,
          color TEXT NOT NULL DEFAULT '#dde2e7'
        )
    ");
    $db->exec("
        CREATE TABLE IF NOT EXISTS prioridades_zonas (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          obra_id INTEGER NOT NULL,
          nombre TEXT NOT NULL
        )
    ");
    $db->exec("
        CREATE TABLE IF NOT EXISTS prioridades_tareas (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          obra_id INTEGER NOT NULL,
          categoria_id INTEGER,
          descripcion TEXT NOT NULL DEFAULT '',
          responsable TEXT,
          fecha_inicio TEXT,
          fecha_fin TEXT,
          estado TEXT NOT NULL DEFAULT 'Pendiente',
          falta_material INTEGER NOT NULL DEFAULT 0,
          pendiente_ppto INTEGER NOT NULL DEFAULT 0,
          destacada INTEGER NOT NULL DEFAULT 0,
          actualizado_por TEXT,
          creado_en TEXT NOT NULL DEFAULT (datetime('now')),
          actualizado_en TEXT NOT NULL DEFAULT (datetime('now'))
        )
    ");

    $columnasTareas = array_column($db->query('PRAGMA table_info(prioridades_tareas)')->fetchAll(), 'name');
    if (!in_array('zona_id', $columnasTareas, true)) {
        $db->exec('ALTER TABLE prioridades_tareas ADD COLUMN zona_id INTEGER');
    }
    $db->exec("
        CREATE TABLE IF NOT EXISTS prioridades_acciones (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          obra_id INTEGER NOT NULL,
          nombre TEXT NOT NULL,
          color TEXT NOT NULL DEFAULT '#dde2e7'
        )
    ");
    if (!in_array('alfredo_comentario_id', $columnasTareas, true)) {
        $db->exec('ALTER TABLE prioridades_tareas ADD COLUMN alfredo_comentario_id INTEGER');
        $db->exec('ALTER TABLE prioridades_tareas ADD COLUMN alfredo_enviado_en TEXT');
    }
    if (!in_array('accion_id', $columnasTareas, true)) {
        // Migración única: cada obra existente recibe las acciones iniciales
        // y sus tareas pasan de las casillas a la acción equivalente (si
        // tenía las dos marcadas, queda "Pend. Ppto", la más restrictiva).
        $db->beginTransaction();
        $db->exec('ALTER TABLE prioridades_tareas ADD COLUMN accion_id INTEGER');
        foreach ($db->query('SELECT id FROM prioridades_obras')->fetchAll() as $o) {
            $ids = crearAccionesIniciales($db, (int) $o['id']);
            $db->prepare('UPDATE prioridades_tareas SET accion_id = ? WHERE obra_id = ? AND pendiente_ppto = 1')->execute([$ids['Pend. Ppto'], $o['id']]);
            $db->prepare('UPDATE prioridades_tareas SET accion_id = ? WHERE obra_id = ? AND pendiente_ppto = 0 AND falta_material = 1')->execute([$ids['Falta material'], $o['id']]);
        }
        $db->commit();
    }

    // SYNC_TOKEN (sin sesión): carga inicial de una obra con sus tareas
    // desde la planilla de Álvaro — POST {accion:"importar", buscar, alias?,
    // nota?, tareas:[{categoria, descripcion, responsable?, fecha_inicio?,
    // fecha_fin?, falta_material?, pendiente_ppto?, destacada?}]}. "buscar"
    // es un texto que tiene que coincidir con UNA sola obra aceptada (los
    // nombres del panel no siempre se escriben igual que en la planilla).
    // Si la obra ya está en Prioridades no hace nada (no duplica).
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $bodyPost = json_decode((string) file_get_contents('php://input'), true) ?? [];
        $token = $_GET['token'] ?? $bodyPost['token'] ?? '';
        if ($config['sync_token'] !== '' && hash_equals($config['sync_token'], (string) $token)) {
            // "zonas_por_prefijo": pasa las tareas escritas "Zona: tarea" a
            // una fachada "Zona" (se crea si no existe) y deja solo "tarea"
            // en la descripción. Usado una vez para Cea Bermudez, que se
            // había importado con "CEA:" / "Vallehermoso:" delante.
            if (($bodyPost['accion'] ?? '') === 'zonas_por_prefijo') {
                $stmtObra = $db->prepare('SELECT * FROM prioridades_obras WHERE obra = ?');
                $stmtObra->execute([(string) ($bodyPost['obra'] ?? '')]);
                $obraFila = $stmtObra->fetch();
                if (!$obraFila) {
                    Response::error('Obra no encontrada en Prioridades', 404);
                }
                $db->beginTransaction();
                if (array_key_exists('alias', $bodyPost)) {
                    $db->prepare('UPDATE prioridades_obras SET alias = ? WHERE id = ?')->execute([textoPrioridad($bodyPost['alias']), $obraFila['id']]);
                }
                $zonas = [];
                $stmtZ = $db->prepare('SELECT id, nombre FROM prioridades_zonas WHERE obra_id = ?');
                $stmtZ->execute([$obraFila['id']]);
                foreach ($stmtZ->fetchAll() as $z) {
                    $zonas[$z['nombre']] = (int) $z['id'];
                }
                $stmtT = $db->prepare('SELECT id, descripcion FROM prioridades_tareas WHERE obra_id = ?');
                $stmtT->execute([$obraFila['id']]);
                $movidas = 0;
                foreach ($stmtT->fetchAll() as $t) {
                    if (!preg_match('/^([^:]{1,40}):\s*(.+)$/u', (string) $t['descripcion'], $m)) {
                        continue;
                    }
                    $zona = trim($m[1]);
                    if (!isset($zonas[$zona])) {
                        $db->prepare('INSERT INTO prioridades_zonas (obra_id, nombre) VALUES (?, ?)')->execute([$obraFila['id'], $zona]);
                        $zonas[$zona] = (int) $db->lastInsertId();
                    }
                    $db->prepare('UPDATE prioridades_tareas SET zona_id = ?, descripcion = ? WHERE id = ?')->execute([$zonas[$zona], trim($m[2]), $t['id']]);
                    $movidas++;
                }
                $db->commit();
                Response::json(['ok' => true, 'zonas' => array_keys($zonas), 'tareas_movidas' => $movidas]);
            }
            if (($bodyPost['accion'] ?? '') !== 'importar') {
                Response::error('Acción no reconocida', 422);
            }
            $stmtBuscar = $db->prepare('SELECT obra FROM obras_aceptadas WHERE obra LIKE ?');
            $stmtBuscar->execute(['%' . (string) ($bodyPost['buscar'] ?? '') . '%']);
            $coincidencias = $stmtBuscar->fetchAll(PDO::FETCH_COLUMN);
            if (count($coincidencias) !== 1) {
                Response::error('"buscar" tiene que coincidir con una sola obra aceptada; coinciden: ' . implode(' | ', $coincidencias), 422);
            }
            $obra = $coincidencias[0];
            $stmtExiste = $db->prepare('SELECT id FROM prioridades_obras WHERE obra = ?');
            $stmtExiste->execute([$obra]);
            if ($stmtExiste->fetchColumn()) {
                Response::json(['ok' => true, 'obra' => $obra, 'importado' => false, 'motivo' => 'ya estaba en Prioridades']);
            }

            $db->beginTransaction();
            $db->prepare("INSERT INTO prioridades_obras (obra, alias, nota, creado_por) VALUES (?, ?, ?, 'Importado de planilla')")
                ->execute([$obra, textoPrioridad($bodyPost['alias'] ?? null), textoPrioridad($bodyPost['nota'] ?? null)]);
            $obraId = (int) $db->lastInsertId();
            $accionIds = crearAccionesIniciales($db, $obraId);
            $categoriaIds = [];
            $colores = array_column(CATEGORIAS_INICIALES, 1, 0);
            $insertarTarea = $db->prepare("
                INSERT INTO prioridades_tareas (obra_id, categoria_id, accion_id, descripcion, responsable, fecha_inicio, fecha_fin, falta_material, pendiente_ppto, destacada, actualizado_por)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Importado de planilla')
            ");
            foreach (($bodyPost['tareas'] ?? []) as $t) {
                $categoria = textoPrioridad($t['categoria'] ?? null) ?? 'Mano de obra';
                if (!isset($categoriaIds[$categoria])) {
                    $color = $colores[$categoria] ?? COLORES_PRIORIDAD[count($categoriaIds) % count(COLORES_PRIORIDAD)];
                    $db->prepare('INSERT INTO prioridades_categorias (obra_id, nombre, color) VALUES (?, ?, ?)')->execute([$obraId, $categoria, $color]);
                    $categoriaIds[$categoria] = (int) $db->lastInsertId();
                }
                $insertarTarea->execute([
                    $obraId,
                    $categoriaIds[$categoria],
                    !empty($t['pendiente_ppto']) ? $accionIds['Pend. Ppto'] : (!empty($t['falta_material']) ? $accionIds['Falta material'] : null),
                    (string) textoPrioridad($t['descripcion'] ?? null),
                    textoPrioridad($t['responsable'] ?? null),
                    fechaPrioridad($t['fecha_inicio'] ?? null, 'fecha_inicio'),
                    fechaPrioridad($t['fecha_fin'] ?? null, 'fecha_fin'),
                    empty($t['falta_material']) ? 0 : 1,
                    empty($t['pendiente_ppto']) ? 0 : 1,
                    empty($t['destacada']) ? 0 : 1,
                ]);
            }
            $db->commit();
            Response::json(['ok' => true, 'obra' => $obra, 'importado' => true, 'tareas' => count($bodyPost['tareas'] ?? [])]);
        }
    }

    $usuario = AuthMiddleware::usuarioActual($config['jwt']['secret']);
    if (!in_array('admin', $usuario['roles'] ?? [], true)) {
        Response::error('Prioridades es solo para administradores', 403);
    }
    $autor = $usuario['nombre'] ?? null;

    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        $obras = $db->query('SELECT * FROM prioridades_obras ORDER BY creado_en, id')->fetchAll();
        $categorias = $db->query('SELECT * FROM prioridades_categorias ORDER BY obra_id, id')->fetchAll();
        $zonas = $db->query('SELECT * FROM prioridades_zonas ORDER BY obra_id, id')->fetchAll();
        $acciones = $db->query('SELECT * FROM prioridades_acciones ORDER BY obra_id, id')->fetchAll();
        $tareas = $db->query('SELECT * FROM prioridades_tareas ORDER BY obra_id, fecha_inicio IS NULL, fecha_inicio, id')->fetchAll();

        $obrasPanel = [];
        $tablaObras = (bool) $db->query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'obras_aceptadas'")->fetchColumn();
        if ($tablaObras) {
            $obrasPanel = $db->query('SELECT id, obra FROM obras_aceptadas ORDER BY obra COLLATE NOCASE')->fetchAll();
        }

        $responsables = [];
        foreach ($tareas as $t) {
            if ($t['responsable']) {
                $responsables[$t['responsable']] = true;
            }
        }
        $tablaPersonas = (bool) $db->query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'montaje_personas'")->fetchColumn();
        if ($tablaPersonas) {
            foreach ($db->query('SELECT nombre FROM montaje_personas')->fetchAll() as $p) {
                $responsables[$p['nombre']] = true;
            }
        }
        $responsables = array_keys($responsables);
        sort($responsables, SORT_NATURAL | SORT_FLAG_CASE);

        Response::json([
            'obras' => $obras,
            'categorias' => $categorias,
            'zonas' => $zonas,
            'acciones' => $acciones,
            'tareas' => $tareas,
            'obras_panel' => $obrasPanel,
            'responsables' => $responsables,
            'estados' => ESTADOS_PRIORIDAD,
            'colores' => COLORES_PRIORIDAD,
        ]);
    }

    $body = json_decode((string) file_get_contents('php://input'), true) ?? [];
    $accion = (string) ($body['accion'] ?? '');
    $metodo = $_SERVER['REQUEST_METHOD'];

    if ($metodo === 'POST' && $accion === 'agregar_obra') {
        $obra = textoPrioridad($body['obra'] ?? null);
        if ($obra === null) {
            Response::error('Falta "obra"', 422);
        }
        $stmtExiste = $db->prepare('SELECT id FROM prioridades_obras WHERE obra = ?');
        $stmtExiste->execute([$obra]);
        if ($stmtExiste->fetchColumn()) {
            Response::error('Esa obra ya está en Prioridades', 409);
        }
        $db->beginTransaction();
        $db->prepare('INSERT INTO prioridades_obras (obra, alias, creado_por) VALUES (?, ?, ?)')
            ->execute([$obra, textoPrioridad($body['alias'] ?? null), $autor]);
        $obraId = (int) $db->lastInsertId();
        foreach (CATEGORIAS_INICIALES as [$nombre, $color]) {
            $db->prepare('INSERT INTO prioridades_categorias (obra_id, nombre, color) VALUES (?, ?, ?)')
                ->execute([$obraId, $nombre, $color]);
        }
        crearAccionesIniciales($db, $obraId);
        $db->commit();
        $stmtCats = $db->prepare('SELECT * FROM prioridades_categorias WHERE obra_id = ? ORDER BY id');
        $stmtCats->execute([$obraId]);
        Response::json(['obra' => filaPor($db, 'prioridades_obras', $obraId), 'categorias' => $stmtCats->fetchAll()]);
    }

    if ($metodo === 'PATCH' && $accion === 'actualizar_obra') {
        $id = (int) ($body['id'] ?? 0);
        if (!filaPor($db, 'prioridades_obras', $id)) {
            Response::error('Obra no encontrada', 404);
        }
        $sets = [];
        $valores = [];
        foreach (['alias', 'nota'] as $campo) {
            if (array_key_exists($campo, $body)) {
                $sets[] = "$campo = ?";
                $valores[] = textoPrioridad($body[$campo]);
            }
        }
        if (array_key_exists('fecha_objetivo', $body)) {
            $sets[] = 'fecha_objetivo = ?';
            $valores[] = fechaPrioridad($body['fecha_objetivo'], 'fecha_objetivo');
        }
        if ($sets) {
            $valores[] = $id;
            $db->prepare('UPDATE prioridades_obras SET ' . implode(', ', $sets) . ' WHERE id = ?')->execute($valores);
        }
        Response::json(['obra' => filaPor($db, 'prioridades_obras', $id)]);
    }

    if ($metodo === 'DELETE' && $accion === 'eliminar_obra') {
        $id = (int) ($body['id'] ?? 0);
        $db->beginTransaction();
        $db->prepare('DELETE FROM prioridades_tareas WHERE obra_id = ?')->execute([$id]);
        $db->prepare('DELETE FROM prioridades_categorias WHERE obra_id = ?')->execute([$id]);
        $db->prepare('DELETE FROM prioridades_zonas WHERE obra_id = ?')->execute([$id]);
        $db->prepare('DELETE FROM prioridades_acciones WHERE obra_id = ?')->execute([$id]);
        $db->prepare('DELETE FROM prioridades_obras WHERE id = ?')->execute([$id]);
        $db->commit();
        Response::json(['ok' => true]);
    }

    if ($metodo === 'POST' && $accion === 'agregar_categoria') {
        $obraId = (int) ($body['obra_id'] ?? 0);
        $nombre = textoPrioridad($body['nombre'] ?? null);
        if (!filaPor($db, 'prioridades_obras', $obraId) || $nombre === null) {
            Response::error('Faltan "obra_id" y/o "nombre"', 422);
        }
        $color = colorPrioridad($body['color'] ?? null);
        if ($color === null) {
            $stmtN = $db->prepare('SELECT COUNT(*) FROM prioridades_categorias WHERE obra_id = ?');
            $stmtN->execute([$obraId]);
            $color = COLORES_PRIORIDAD[(int) $stmtN->fetchColumn() % count(COLORES_PRIORIDAD)];
        }
        $db->prepare('INSERT INTO prioridades_categorias (obra_id, nombre, color) VALUES (?, ?, ?)')
            ->execute([$obraId, $nombre, $color]);
        Response::json(['categoria' => filaPor($db, 'prioridades_categorias', (int) $db->lastInsertId())]);
    }

    if ($metodo === 'PATCH' && $accion === 'actualizar_categoria') {
        $id = (int) ($body['id'] ?? 0);
        $actual = filaPor($db, 'prioridades_categorias', $id);
        if (!$actual) {
            Response::error('Categoría no encontrada', 404);
        }
        $nombre = array_key_exists('nombre', $body) ? textoPrioridad($body['nombre']) : $actual['nombre'];
        if ($nombre === null) {
            Response::error('El nombre de la categoría no puede quedar vacío', 422);
        }
        $color = array_key_exists('color', $body) ? (colorPrioridad($body['color']) ?? $actual['color']) : $actual['color'];
        $db->prepare('UPDATE prioridades_categorias SET nombre = ?, color = ? WHERE id = ?')->execute([$nombre, $color, $id]);
        Response::json(['categoria' => filaPor($db, 'prioridades_categorias', $id)]);
    }

    if ($metodo === 'DELETE' && $accion === 'eliminar_categoria') {
        $id = (int) ($body['id'] ?? 0);
        $db->prepare('UPDATE prioridades_tareas SET categoria_id = NULL WHERE categoria_id = ?')->execute([$id]);
        $db->prepare('DELETE FROM prioridades_categorias WHERE id = ?')->execute([$id]);
        Response::json(['ok' => true]);
    }

    if ($metodo === 'POST' && $accion === 'agregar_accion') {
        $obraId = (int) ($body['obra_id'] ?? 0);
        $nombre = textoPrioridad($body['nombre'] ?? null);
        if (!filaPor($db, 'prioridades_obras', $obraId) || $nombre === null) {
            Response::error('Faltan "obra_id" y/o "nombre"', 422);
        }
        $color = colorPrioridad($body['color'] ?? null);
        if ($color === null) {
            $stmtN = $db->prepare('SELECT COUNT(*) FROM prioridades_acciones WHERE obra_id = ?');
            $stmtN->execute([$obraId]);
            $color = COLORES_PRIORIDAD[((int) $stmtN->fetchColumn() + 3) % count(COLORES_PRIORIDAD)];
        }
        $db->prepare('INSERT INTO prioridades_acciones (obra_id, nombre, color) VALUES (?, ?, ?)')->execute([$obraId, $nombre, $color]);
        Response::json(['accion' => filaPor($db, 'prioridades_acciones', (int) $db->lastInsertId())]);
    }

    if ($metodo === 'PATCH' && $accion === 'actualizar_accion') {
        $id = (int) ($body['id'] ?? 0);
        $actual = filaPor($db, 'prioridades_acciones', $id);
        if (!$actual) {
            Response::error('Acción no encontrada', 404);
        }
        $nombre = array_key_exists('nombre', $body) ? textoPrioridad($body['nombre']) : $actual['nombre'];
        if ($nombre === null) {
            Response::error('El nombre de la acción no puede quedar vacío', 422);
        }
        $color = array_key_exists('color', $body) ? (colorPrioridad($body['color']) ?? $actual['color']) : $actual['color'];
        $db->prepare('UPDATE prioridades_acciones SET nombre = ?, color = ? WHERE id = ?')->execute([$nombre, $color, $id]);
        Response::json(['accion' => filaPor($db, 'prioridades_acciones', $id)]);
    }

    if ($metodo === 'DELETE' && $accion === 'eliminar_accion') {
        $id = (int) ($body['id'] ?? 0);
        $db->prepare('UPDATE prioridades_tareas SET accion_id = NULL WHERE accion_id = ?')->execute([$id]);
        $db->prepare('DELETE FROM prioridades_acciones WHERE id = ?')->execute([$id]);
        Response::json(['ok' => true]);
    }

    if ($metodo === 'POST' && $accion === 'agregar_zona') {
        $obraId = (int) ($body['obra_id'] ?? 0);
        $nombre = textoPrioridad($body['nombre'] ?? null);
        if (!filaPor($db, 'prioridades_obras', $obraId) || $nombre === null) {
            Response::error('Faltan "obra_id" y/o "nombre"', 422);
        }
        $db->prepare('INSERT INTO prioridades_zonas (obra_id, nombre) VALUES (?, ?)')->execute([$obraId, $nombre]);
        Response::json(['zona' => filaPor($db, 'prioridades_zonas', (int) $db->lastInsertId())]);
    }

    if ($metodo === 'PATCH' && $accion === 'actualizar_zona') {
        $id = (int) ($body['id'] ?? 0);
        $nombre = textoPrioridad($body['nombre'] ?? null);
        if (!filaPor($db, 'prioridades_zonas', $id) || $nombre === null) {
            Response::error('Fachada no encontrada o nombre vacío', 422);
        }
        $db->prepare('UPDATE prioridades_zonas SET nombre = ? WHERE id = ?')->execute([$nombre, $id]);
        Response::json(['zona' => filaPor($db, 'prioridades_zonas', $id)]);
    }

    if ($metodo === 'DELETE' && $accion === 'eliminar_zona') {
        $id = (int) ($body['id'] ?? 0);
        $db->prepare('UPDATE prioridades_tareas SET zona_id = NULL WHERE zona_id = ?')->execute([$id]);
        $db->prepare('DELETE FROM prioridades_zonas WHERE id = ?')->execute([$id]);
        Response::json(['ok' => true]);
    }

    if ($metodo === 'POST' && $accion === 'agregar_tarea') {
        $obraId = (int) ($body['obra_id'] ?? 0);
        if (!filaPor($db, 'prioridades_obras', $obraId)) {
            Response::error('Obra no encontrada', 404);
        }
        $categoriaId = (int) ($body['categoria_id'] ?? 0) ?: null;
        $zonaId = (int) ($body['zona_id'] ?? 0) ?: null;
        $db->prepare('INSERT INTO prioridades_tareas (obra_id, categoria_id, zona_id, descripcion, actualizado_por) VALUES (?, ?, ?, ?, ?)')
            ->execute([$obraId, $categoriaId, $zonaId, (string) textoPrioridad($body['descripcion'] ?? null), $autor]);
        Response::json(['tarea' => filaPor($db, 'prioridades_tareas', (int) $db->lastInsertId())]);
    }

    if ($metodo === 'PATCH' && $accion === 'actualizar_tarea') {
        $id = (int) ($body['id'] ?? 0);
        $actual = filaPor($db, 'prioridades_tareas', $id);
        if (!$actual) {
            Response::error('Tarea no encontrada', 404);
        }
        $t = $actual;
        if (array_key_exists('descripcion', $body)) {
            $t['descripcion'] = (string) textoPrioridad($body['descripcion']);
        }
        if (array_key_exists('responsable', $body)) {
            $t['responsable'] = textoPrioridad($body['responsable']);
        }
        if (array_key_exists('categoria_id', $body)) {
            $t['categoria_id'] = (int) $body['categoria_id'] ?: null;
        }
        if (array_key_exists('zona_id', $body)) {
            $t['zona_id'] = (int) $body['zona_id'] ?: null;
        }
        if (array_key_exists('accion_id', $body)) {
            $t['accion_id'] = (int) $body['accion_id'] ?: null;
        }
        if (array_key_exists('fecha_inicio', $body)) {
            $t['fecha_inicio'] = fechaPrioridad($body['fecha_inicio'], 'fecha_inicio');
        }
        if (array_key_exists('fecha_fin', $body)) {
            $t['fecha_fin'] = fechaPrioridad($body['fecha_fin'], 'fecha_fin');
        }
        if ($t['fecha_inicio'] !== null && $t['fecha_fin'] !== null && $t['fecha_fin'] < $t['fecha_inicio']) {
            Response::error('La fecha de fin no puede ser anterior a la de inicio', 422);
        }
        if (array_key_exists('estado', $body)) {
            if (!in_array($body['estado'], ESTADOS_PRIORIDAD, true)) {
                Response::error('"estado" debe ser uno de: ' . implode(', ', ESTADOS_PRIORIDAD), 422);
            }
            $t['estado'] = $body['estado'];
        }
        foreach (['falta_material', 'pendiente_ppto', 'destacada'] as $campo) {
            if (array_key_exists($campo, $body)) {
                $t[$campo] = $body[$campo] ? 1 : 0;
            }
        }
        $db->prepare("
            UPDATE prioridades_tareas
            SET categoria_id = ?, zona_id = ?, accion_id = ?, descripcion = ?, responsable = ?, fecha_inicio = ?, fecha_fin = ?, estado = ?,
                falta_material = ?, pendiente_ppto = ?, destacada = ?, actualizado_por = ?, actualizado_en = datetime('now')
            WHERE id = ?
        ")->execute([
            $t['categoria_id'], $t['zona_id'], $t['accion_id'], $t['descripcion'], $t['responsable'], $t['fecha_inicio'], $t['fecha_fin'], $t['estado'],
            $t['falta_material'], $t['pendiente_ppto'], $t['destacada'], $autor, $id,
        ]);
        Response::json(['tarea' => filaPor($db, 'prioridades_tareas', $id)]);
    }

    if ($metodo === 'POST' && $accion === 'enviar_a_alfredo') {
        $id = (int) ($body['id'] ?? 0);
        $tarea = filaPor($db, 'prioridades_tareas', $id);
        if (!$tarea) {
            Response::error('Tarea no encontrada', 404);
        }
        $obra = filaPor($db, 'prioridades_obras', (int) $tarea['obra_id']);

        // comentarios_obra la crean obras_aceptadas.php/comentarios_obra.php;
        // se asegura acá también (mismo criterio del resto del proyecto).
        $db->exec("
            CREATE TABLE IF NOT EXISTS comentarios_obra (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              obra TEXT NOT NULL,
              autor_nombre TEXT NOT NULL,
              autor_email TEXT NOT NULL,
              mensaje TEXT NOT NULL,
              creado_en TEXT NOT NULL DEFAULT (datetime('now'))
            )
        ");
        $columnasCom = array_column($db->query('PRAGMA table_info(comentarios_obra)')->fetchAll(), 'name');
        foreach (['hecho' => 'INTEGER NOT NULL DEFAULT 0', 'archivado' => 'INTEGER NOT NULL DEFAULT 0', 'categoria' => "TEXT NOT NULL DEFAULT 'tarea'", 'urgente' => 'INTEGER NOT NULL DEFAULT 0'] as $col => $def) {
            if (!in_array($col, $columnasCom, true)) {
                $db->exec("ALTER TABLE comentarios_obra ADD COLUMN $col $def");
            }
        }

        if ($tarea['alfredo_comentario_id'] && empty($body['reenviar'])) {
            $previa = filaPor($db, 'comentarios_obra', (int) $tarea['alfredo_comentario_id']);
            if ($previa && !(int) $previa['hecho'] && !(int) $previa['archivado']) {
                Response::error('Esta tarea ya se envió a Alfredo y todavía la tiene pendiente', 409);
            }
        }

        // Mensaje para Alfredo — a pedido de Álvaro (2026-10-01) SOLO:
        // "URGENTE Prioridades", la fachada (ej. CEA / Vallehermoso), la
        // descripción y el mensaje opcional de Álvaro. Sin categoría,
        // acción, responsable ni fechas.
        $zona = $tarea['zona_id'] ? filaPor($db, 'prioridades_zonas', (int) $tarea['zona_id']) : null;
        $mensaje = '🚨 URGENTE Prioridades'
            . ($zona ? ' · ' . $zona['nombre'] : '')
            . ' — ' . ($tarea['descripcion'] !== '' ? $tarea['descripcion'] : 'Tarea sin descripción');
        if ($nota = textoPrioridad($body['nota'] ?? null)) {
            $mensaje .= "\n" . $nota;
        }

        $db->beginTransaction();
        $db->prepare("INSERT INTO comentarios_obra (obra, autor_nombre, autor_email, mensaje, categoria, urgente) VALUES (?, ?, ?, ?, 'tarea', 1)")
            ->execute([$obra['obra'], $usuario['nombre'] ?? 'Álvaro', $usuario['email'] ?? '', $mensaje]);
        $comentarioId = (int) $db->lastInsertId();
        $db->prepare("UPDATE prioridades_tareas SET alfredo_comentario_id = ?, alfredo_enviado_en = datetime('now') WHERE id = ?")
            ->execute([$comentarioId, $id]);
        $db->commit();
        Response::json(['tarea' => filaPor($db, 'prioridades_tareas', $id)]);
    }

    if ($metodo === 'DELETE' && $accion === 'eliminar_tarea') {
        $db->prepare('DELETE FROM prioridades_tareas WHERE id = ?')->execute([(int) ($body['id'] ?? 0)]);
        Response::json(['ok' => true]);
    }

    Response::error('Acción no reconocida', 422);
} catch (Throwable $e) {
    Response::error(get_class($e) . ': ' . $e->getMessage(), 500);
}
