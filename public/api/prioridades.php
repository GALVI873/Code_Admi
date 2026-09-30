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
// POST {accion:"agregar_tarea", obra_id, categoria_id?, descripcion?}
// PATCH {accion:"actualizar_tarea", id, ...campos}: solo pisa lo mandado.
// DELETE {accion:"eliminar_tarea", id}

const ESTADOS_PRIORIDAD = ['Pendiente', 'En curso', 'Terminado'];
// Pastel, mismo criterio que Planificación — se van asignando en orden a
// cada categoría nueva (después se puede cambiar).
const COLORES_PRIORIDAD = ['#f8d7bc', '#bfdcf3', '#c6e9cc', '#dccbf0', '#f4e5ad', '#f5c9c9', '#bde6d9', '#dde2e7'];
const CATEGORIAS_INICIALES = [['Mano de obra', '#f8d7bc'], ['Composite', '#bfdcf3']];

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
            $categoriaIds = [];
            $colores = array_column(CATEGORIAS_INICIALES, 1, 0);
            $insertarTarea = $db->prepare("
                INSERT INTO prioridades_tareas (obra_id, categoria_id, descripcion, responsable, fecha_inicio, fecha_fin, falta_material, pendiente_ppto, destacada, actualizado_por)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Importado de planilla')
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

    if ($metodo === 'POST' && $accion === 'agregar_tarea') {
        $obraId = (int) ($body['obra_id'] ?? 0);
        if (!filaPor($db, 'prioridades_obras', $obraId)) {
            Response::error('Obra no encontrada', 404);
        }
        $categoriaId = (int) ($body['categoria_id'] ?? 0) ?: null;
        $db->prepare('INSERT INTO prioridades_tareas (obra_id, categoria_id, descripcion, actualizado_por) VALUES (?, ?, ?, ?)')
            ->execute([$obraId, $categoriaId, (string) textoPrioridad($body['descripcion'] ?? null), $autor]);
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
            SET categoria_id = ?, descripcion = ?, responsable = ?, fecha_inicio = ?, fecha_fin = ?, estado = ?,
                falta_material = ?, pendiente_ppto = ?, destacada = ?, actualizado_por = ?, actualizado_en = datetime('now')
            WHERE id = ?
        ")->execute([
            $t['categoria_id'], $t['descripcion'], $t['responsable'], $t['fecha_inicio'], $t['fecha_fin'], $t['estado'],
            $t['falta_material'], $t['pendiente_ppto'], $t['destacada'], $autor, $id,
        ]);
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
