<?php
declare(strict_types=1);

// Planificación de obras (cronograma + Gantt) — a pedido de Álvaro,
// 2026-09-29: reemplaza la base "Seguimiento Obras" de Notion. Cuando una
// obra se acepta, Álvaro la crea acá con TODAS las categorías de trabajo
// (Medición, Material, Fabricación, Chapas, Composite, Transporte, Grúa,
// Montaje, Facturar) y le va poniendo un rango de fechas y un responsable a
// cada una — eso arma el cronograma de la obra y, filtrando la categoría
// Montaje, el Gantt semanal para asignar montadores.
//
// Es independiente de "Obras Aceptadas" a propósito: los nombres de obra
// que usaba Álvaro en Notion no coinciden con los del panel (ej. "Jose
// Abascal" vs "8 Viv. Jose Abascal, 57"), así que cada obra de
// planificación tiene su propio nombre y, opcionalmente, un vínculo
// (obra_panel) a la obra aceptada correspondiente, que Álvaro elige a mano.
//
// GET: requiere sesión (cualquier usuario — la página de Inicio muestra el
//   Gantt semanal de montaje a todos). Devuelve obras, tareas, la lista de
//   responsables usados (para autocompletar), las obras aceptadas del panel
//   (para vincular) y si el usuario puede editar.
// Todo lo que escribe requiere rol admin (Álvaro es quien asigna fechas):
//   POST {accion:"crear_obra", nombre, constructora?, obra_panel?, tipo?,
//     situacion?, silicona?, comentario?}: crea la obra + una tarea vacía
//     por cada categoría.
//   PATCH {accion:"actualizar_obra", id, ...campos}
//   DELETE {accion:"eliminar_obra", id}: borra la obra y sus tareas.
//   POST {accion:"agregar_tarea", obra_id, categoria}
//   PATCH {accion:"actualizar_tarea", id, fecha_inicio?, fecha_fin?,
//     responsable?, estado?, comentario?, categoria?}: solo pisa los campos
//     mandados. Devuelve la tarea actualizada.
//   DELETE {accion:"eliminar_tarea", id}
// POST (SYNC_TOKEN) {accion:"importar_notion", obras:[...]}: carga inicial
//   desde Notion (backend/drive_sync/importar_planificacion_notion.js).
//   Idempotente: una tarea con un notion_id ya importado se saltea, y la
//   obra se busca por nombre + constructora antes de crearla.

const CATEGORIAS_PLANIFICACION = ['Medición', 'Material', 'Fabricación', 'Chapas', 'Composite', 'Transporte', 'Grúa', 'Montaje', 'Facturar', 'Varios'];
// Las que se crean solas al dar de alta una obra ("Varios" queda para
// agregar a mano si hace falta).
const CATEGORIAS_ALTA_OBRA = ['Medición', 'Material', 'Fabricación', 'Chapas', 'Composite', 'Transporte', 'Grúa', 'Montaje', 'Facturar'];
const ESTADOS_TAREA = ['Pendiente', 'Terminado'];
const CAMPOS_OBRA = ['nombre', 'constructora', 'obra_panel', 'tipo', 'situacion', 'silicona', 'comentario', 'estado'];

$config = require __DIR__ . '/../../backend/bootstrap.php';

function fechaValidaPlanificacion(?string $valor, string $campo): ?string
{
    $valor = trim((string) $valor);
    if ($valor === '') {
        return null;
    }
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $valor)) {
        Response::error("\"$campo\" debe tener formato AAAA-MM-DD", 422);
    }
    return $valor;
}

function textoONull($valor): ?string
{
    $valor = trim((string) ($valor ?? ''));
    return $valor === '' ? null : $valor;
}

function insertarTareaPlanificacion(PDO $db, int $obraId, array $t, ?string $autor): void
{
    $db->prepare("
        INSERT INTO planificacion_tareas (obra_id, categoria, fecha_inicio, fecha_fin, responsable, estado, comentario, notion_id, actualizado_por)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ")->execute([
        $obraId,
        $t['categoria'],
        $t['fecha_inicio'] ?? null,
        $t['fecha_fin'] ?? null,
        $t['responsable'] ?? null,
        $t['estado'] ?? 'Pendiente',
        $t['comentario'] ?? null,
        $t['notion_id'] ?? null,
        $autor,
    ]);
}

try {
    $db = Database::connection($config);

    $db->exec("
        CREATE TABLE IF NOT EXISTS planificacion_obras (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          nombre TEXT NOT NULL,
          constructora TEXT,
          obra_panel TEXT,
          tipo TEXT,
          situacion TEXT,
          silicona TEXT,
          comentario TEXT,
          estado TEXT NOT NULL DEFAULT 'Activa',
          creado_por TEXT,
          creado_en TEXT NOT NULL DEFAULT (datetime('now')),
          actualizado_en TEXT NOT NULL DEFAULT (datetime('now'))
        )
    ");
    $db->exec("
        CREATE TABLE IF NOT EXISTS planificacion_tareas (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          obra_id INTEGER NOT NULL,
          categoria TEXT NOT NULL,
          fecha_inicio TEXT,
          fecha_fin TEXT,
          responsable TEXT,
          estado TEXT NOT NULL DEFAULT 'Pendiente',
          comentario TEXT,
          notion_id TEXT UNIQUE,
          actualizado_por TEXT,
          actualizado_en TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (obra_id) REFERENCES planificacion_obras(id) ON DELETE CASCADE
        )
    ");
    $db->exec('CREATE INDEX IF NOT EXISTS idx_planificacion_tareas_obra ON planificacion_tareas(obra_id)');

    // SYNC_TOKEN (sin sesión) — carga inicial desde Notion. Mismo patrón que
    // montaje_obra.php: se resuelve ANTES del chequeo de sesión.
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $bodyPost = json_decode((string) file_get_contents('php://input'), true) ?? [];
        $token = $_GET['token'] ?? $bodyPost['token'] ?? '';
        if ($config['sync_token'] !== '' && hash_equals($config['sync_token'], (string) $token)) {
            if (($bodyPost['accion'] ?? '') !== 'importar_notion') {
                Response::error('Acción no reconocida', 422);
            }
            $obrasCreadas = 0;
            $tareasCreadas = 0;
            $tareasSalteadas = 0;
            $stmtBuscarObra = $db->prepare('SELECT id FROM planificacion_obras WHERE nombre = ? AND IFNULL(constructora, \'\') = ?');
            $stmtTareaExiste = $db->prepare('SELECT 1 FROM planificacion_tareas WHERE notion_id = ?');

            $db->beginTransaction();
            foreach (($bodyPost['obras'] ?? []) as $o) {
                $nombre = textoONull($o['nombre'] ?? null);
                if ($nombre === null) {
                    continue;
                }
                $constructora = textoONull($o['constructora'] ?? null);
                $stmtBuscarObra->execute([$nombre, $constructora ?? '']);
                $obraId = (int) ($stmtBuscarObra->fetchColumn() ?: 0);
                if ($obraId === 0) {
                    $db->prepare("
                        INSERT INTO planificacion_obras (nombre, constructora, tipo, situacion, silicona, comentario, estado, creado_por)
                        VALUES (?, ?, ?, ?, ?, ?, ?, 'Importado de Notion')
                    ")->execute([
                        $nombre,
                        $constructora,
                        textoONull($o['tipo'] ?? null),
                        textoONull($o['situacion'] ?? null),
                        textoONull($o['silicona'] ?? null),
                        textoONull($o['comentario'] ?? null),
                        ($o['estado'] ?? '') === 'Terminada' ? 'Terminada' : 'Activa',
                    ]);
                    $obraId = (int) $db->lastInsertId();
                    $obrasCreadas++;
                }
                foreach (($o['tareas'] ?? []) as $t) {
                    $categoria = (string) ($t['categoria'] ?? '');
                    if (!in_array($categoria, CATEGORIAS_PLANIFICACION, true)) {
                        $categoria = 'Varios';
                    }
                    $notionId = textoONull($t['notion_id'] ?? null);
                    if ($notionId !== null) {
                        $stmtTareaExiste->execute([$notionId]);
                        if ($stmtTareaExiste->fetchColumn()) {
                            $tareasSalteadas++;
                            continue;
                        }
                    }
                    insertarTareaPlanificacion($db, $obraId, [
                        'categoria' => $categoria,
                        'fecha_inicio' => textoONull($t['fecha_inicio'] ?? null),
                        'fecha_fin' => textoONull($t['fecha_fin'] ?? null),
                        'responsable' => textoONull($t['responsable'] ?? null),
                        'estado' => in_array($t['estado'] ?? '', ESTADOS_TAREA, true) ? $t['estado'] : 'Pendiente',
                        'comentario' => textoONull($t['comentario'] ?? null),
                        'notion_id' => $notionId,
                    ], 'Importado de Notion');
                    $tareasCreadas++;
                }
            }
            $db->commit();

            Response::json([
                'ok' => true,
                'obras_creadas' => $obrasCreadas,
                'tareas_creadas' => $tareasCreadas,
                'tareas_salteadas' => $tareasSalteadas,
            ]);
        }
    }

    $usuario = AuthMiddleware::usuarioActual($config['jwt']['secret']);
    $puedeEditar = in_array('admin', $usuario['roles'] ?? [], true);

    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        $obras = $db->query('SELECT * FROM planificacion_obras ORDER BY nombre COLLATE NOCASE')->fetchAll();
        $tareas = $db->query('SELECT * FROM planificacion_tareas ORDER BY obra_id, fecha_inicio, id')->fetchAll();

        // Responsables ya usados + la lista de montadores/ayudantes de la
        // pestaña Montaje — solo para autocompletar, se puede escribir
        // cualquier nombre (proveedores, transportista, etc.).
        $responsables = [];
        foreach ($tareas as $t) {
            foreach (explode(',', (string) $t['responsable']) as $r) {
                $r = trim($r);
                if ($r !== '') {
                    $responsables[$r] = true;
                }
            }
        }
        $tablaPersonasExiste = (bool) $db->query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'montaje_personas'")->fetchColumn();
        if ($tablaPersonasExiste) {
            foreach ($db->query('SELECT nombre FROM montaje_personas')->fetchAll() as $p) {
                $responsables[$p['nombre']] = true;
            }
        }
        $responsables = array_keys($responsables);
        sort($responsables, SORT_NATURAL | SORT_FLAG_CASE);

        $obrasPanel = [];
        $tablaObrasExiste = (bool) $db->query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'obras_aceptadas'")->fetchColumn();
        if ($tablaObrasExiste) {
            $obrasPanel = $db->query('SELECT id, obra FROM obras_aceptadas ORDER BY obra COLLATE NOCASE')->fetchAll();
        }

        Response::json([
            'obras' => $obras,
            'tareas' => $tareas,
            'responsables' => $responsables,
            'obras_panel' => $obrasPanel,
            'categorias' => CATEGORIAS_PLANIFICACION,
            'puede_editar' => $puedeEditar,
        ]);
    }

    if (!$puedeEditar) {
        Response::error('Solo Álvaro (administrador) puede modificar la planificación', 403);
    }

    $body = json_decode((string) file_get_contents('php://input'), true) ?? [];
    $accion = (string) ($body['accion'] ?? '');
    $autor = $usuario['nombre'] ?? null;

    if ($_SERVER['REQUEST_METHOD'] === 'POST' && $accion === 'crear_obra') {
        $nombre = textoONull($body['nombre'] ?? null);
        if ($nombre === null) {
            Response::error('Falta el nombre de la obra', 422);
        }
        $db->beginTransaction();
        $db->prepare("
            INSERT INTO planificacion_obras (nombre, constructora, obra_panel, tipo, situacion, silicona, comentario, creado_por)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ")->execute([
            $nombre,
            textoONull($body['constructora'] ?? null),
            textoONull($body['obra_panel'] ?? null),
            textoONull($body['tipo'] ?? null),
            textoONull($body['situacion'] ?? null),
            textoONull($body['silicona'] ?? null),
            textoONull($body['comentario'] ?? null),
            $autor,
        ]);
        $obraId = (int) $db->lastInsertId();
        foreach (CATEGORIAS_ALTA_OBRA as $categoria) {
            insertarTareaPlanificacion($db, $obraId, ['categoria' => $categoria], $autor);
        }
        $db->commit();

        $stmtObra = $db->prepare('SELECT * FROM planificacion_obras WHERE id = ?');
        $stmtObra->execute([$obraId]);
        $stmtTareas = $db->prepare('SELECT * FROM planificacion_tareas WHERE obra_id = ? ORDER BY id');
        $stmtTareas->execute([$obraId]);
        Response::json(['obra' => $stmtObra->fetch(), 'tareas' => $stmtTareas->fetchAll()]);
    }

    if ($_SERVER['REQUEST_METHOD'] === 'PATCH' && $accion === 'actualizar_obra') {
        $id = (int) ($body['id'] ?? 0);
        if ($id <= 0) {
            Response::error('Falta "id"', 422);
        }
        $sets = [];
        $valores = [];
        foreach (CAMPOS_OBRA as $campo) {
            if (!array_key_exists($campo, $body)) {
                continue;
            }
            $valor = textoONull($body[$campo]);
            if ($campo === 'nombre' && $valor === null) {
                Response::error('El nombre de la obra no puede quedar vacío', 422);
            }
            if ($campo === 'estado' && !in_array($valor, ['Activa', 'Terminada'], true)) {
                Response::error('"estado" debe ser Activa o Terminada', 422);
            }
            $sets[] = "$campo = ?";
            $valores[] = $valor;
        }
        if ($sets) {
            $valores[] = $id;
            $db->prepare('UPDATE planificacion_obras SET ' . implode(', ', $sets) . ", actualizado_en = datetime('now') WHERE id = ?")
                ->execute($valores);
        }
        $stmt = $db->prepare('SELECT * FROM planificacion_obras WHERE id = ?');
        $stmt->execute([$id]);
        Response::json(['obra' => $stmt->fetch()]);
    }

    if ($_SERVER['REQUEST_METHOD'] === 'DELETE' && $accion === 'eliminar_obra') {
        $id = (int) ($body['id'] ?? 0);
        if ($id <= 0) {
            Response::error('Falta "id"', 422);
        }
        $db->prepare('DELETE FROM planificacion_tareas WHERE obra_id = ?')->execute([$id]);
        $db->prepare('DELETE FROM planificacion_obras WHERE id = ?')->execute([$id]);
        Response::json(['ok' => true]);
    }

    if ($_SERVER['REQUEST_METHOD'] === 'POST' && $accion === 'agregar_tarea') {
        $obraId = (int) ($body['obra_id'] ?? 0);
        $categoria = (string) ($body['categoria'] ?? '');
        if ($obraId <= 0 || !in_array($categoria, CATEGORIAS_PLANIFICACION, true)) {
            Response::error('Faltan "obra_id" y/o una "categoria" válida', 422);
        }
        insertarTareaPlanificacion($db, $obraId, ['categoria' => $categoria], $autor);
        $stmt = $db->prepare('SELECT * FROM planificacion_tareas WHERE id = ?');
        $stmt->execute([(int) $db->lastInsertId()]);
        Response::json(['tarea' => $stmt->fetch()]);
    }

    if ($_SERVER['REQUEST_METHOD'] === 'PATCH' && $accion === 'actualizar_tarea') {
        $id = (int) ($body['id'] ?? 0);
        $stmtActual = $db->prepare('SELECT * FROM planificacion_tareas WHERE id = ?');
        $stmtActual->execute([$id]);
        $actual = $stmtActual->fetch();
        if (!$actual) {
            Response::error('Tarea no encontrada', 404);
        }

        $inicio = array_key_exists('fecha_inicio', $body) ? fechaValidaPlanificacion($body['fecha_inicio'], 'fecha_inicio') : $actual['fecha_inicio'];
        $fin = array_key_exists('fecha_fin', $body) ? fechaValidaPlanificacion($body['fecha_fin'], 'fecha_fin') : $actual['fecha_fin'];
        if ($inicio !== null && $fin !== null && $fin < $inicio) {
            Response::error('La fecha de fin no puede ser anterior a la de inicio', 422);
        }
        $estado = array_key_exists('estado', $body) ? (string) $body['estado'] : $actual['estado'];
        if (!in_array($estado, ESTADOS_TAREA, true)) {
            Response::error('"estado" debe ser Pendiente o Terminado', 422);
        }
        $categoria = array_key_exists('categoria', $body) ? (string) $body['categoria'] : $actual['categoria'];
        if (!in_array($categoria, CATEGORIAS_PLANIFICACION, true)) {
            Response::error('Categoría no válida', 422);
        }
        $responsable = array_key_exists('responsable', $body) ? textoONull($body['responsable']) : $actual['responsable'];
        $comentario = array_key_exists('comentario', $body) ? textoONull($body['comentario']) : $actual['comentario'];

        $db->prepare("
            UPDATE planificacion_tareas
            SET categoria = ?, fecha_inicio = ?, fecha_fin = ?, responsable = ?, estado = ?, comentario = ?,
                actualizado_por = ?, actualizado_en = datetime('now')
            WHERE id = ?
        ")->execute([$categoria, $inicio, $fin, $responsable, $estado, $comentario, $autor, $id]);

        $stmtActual->execute([$id]);
        Response::json(['tarea' => $stmtActual->fetch()]);
    }

    if ($_SERVER['REQUEST_METHOD'] === 'DELETE' && $accion === 'eliminar_tarea') {
        $id = (int) ($body['id'] ?? 0);
        if ($id <= 0) {
            Response::error('Falta "id"', 422);
        }
        $db->prepare('DELETE FROM planificacion_tareas WHERE id = ?')->execute([$id]);
        Response::json(['ok' => true]);
    }

    Response::error('Acción no reconocida', 422);
} catch (Throwable $e) {
    Response::error(get_class($e) . ': ' . $e->getMessage(), 500);
}
