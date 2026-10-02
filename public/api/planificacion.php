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
//     situacion?, silicona?, comentario?, fecha_aceptacion?}: crea la obra.
//     Con fecha de aceptación las tareas salen con el cronograma tipo (ver
//     backend/src/Planificacion.php); sin ella, una tarea vacía por categoría.
//   POST {accion:"calcular_fechas", id, fecha_aceptacion}: rellena las
//     fechas de las tareas pendientes de la obra con el cronograma tipo.
//   PATCH {accion:"actualizar_obra", id, ...campos}
//   DELETE {accion:"eliminar_obra", id}: borra la obra y sus tareas.
//   POST {accion:"agregar_tarea", obra_id, categoria, fecha_inicio?,
//     fecha_fin?, responsable?, ayudante?, estado?, comentario?} — la
//     categoría puede ser un texto propio (ver categoriaPlanificacion).
//   PATCH {accion:"actualizar_tarea", id, fecha_inicio?, fecha_fin?,
//     responsable?, ayudante?, estado?, comentario?, categoria?}: solo pisa
//     los campos mandados. Devuelve la tarea actualizada.
//   DELETE {accion:"eliminar_tarea", id}
// POST (SYNC_TOKEN) {accion:"importar_notion", obras:[...]}: carga inicial
//   desde Notion (backend/drive_sync/importar_planificacion_notion.js).
//   Idempotente: una tarea con un notion_id ya importado se saltea, y la
//   obra se busca por nombre + constructora antes de crearla.

$config = require __DIR__ . '/../../backend/bootstrap.php';

// Después del bootstrap: la clase Planificacion se carga ahí.
const CATEGORIAS_PLANIFICACION = Planificacion::CATEGORIAS;
const ESTADOS_TAREA = ['Pendiente', 'Terminado'];
const CAMPOS_OBRA = ['nombre', 'constructora', 'obra_panel', 'tipo', 'situacion', 'silicona', 'comentario', 'estado', 'fecha_aceptacion'];

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

// Categoría de una tarea: una de la lista o un texto propio (a pedido de
// Álvaro, 2026-10-02: al crear la tarea se puede escribir otro nombre, ej.
// "Montaje remates"). Las de la lista conservan su color y su lógica (el
// Gantt de montaje toma solo "Montaje"); un texto propio sale como "Varios".
function categoriaPlanificacion($valor): ?string
{
    $valor = textoONull($valor);
    return $valor === null || mb_strlen($valor) > 60 ? null : $valor;
}

try {
    $db = Database::connection($config);

    Planificacion::asegurarTablas($db);

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
                    Planificacion::insertarTarea($db, $obraId, [
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

        // Montadores y ayudantes de la pestaña Montaje de las obras aceptadas
        // (montaje_personas, rol "montador" | "ayudante") — para elegirlos
        // desde la ventana de una tarea de Montaje.
        $personas = $tablaPersonasExiste
            ? $db->query('SELECT id, nombre, rol FROM montaje_personas ORDER BY nombre COLLATE NOCASE')->fetchAll()
            : [];

        $obrasPanel = [];
        $tablaObrasExiste = (bool) $db->query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'obras_aceptadas'")->fetchColumn();
        if ($tablaObrasExiste) {
            $obrasPanel = $db->query('SELECT id, obra FROM obras_aceptadas ORDER BY obra COLLATE NOCASE')->fetchAll();
        }

        Response::json([
            'obras' => $obras,
            'tareas' => $tareas,
            'responsables' => $responsables,
            'personas' => $personas,
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
        $obraId = Planificacion::crearObra($db, [
            'nombre' => $nombre,
            'constructora' => textoONull($body['constructora'] ?? null),
            'obra_panel' => textoONull($body['obra_panel'] ?? null),
            'tipo' => textoONull($body['tipo'] ?? null),
            'situacion' => textoONull($body['situacion'] ?? null),
            'silicona' => textoONull($body['silicona'] ?? null),
            'comentario' => textoONull($body['comentario'] ?? null),
            'fecha_aceptacion' => fechaValidaPlanificacion($body['fecha_aceptacion'] ?? null, 'fecha_aceptacion'),
        ], $autor);
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
            if ($campo === 'fecha_aceptacion') {
                $valor = fechaValidaPlanificacion($valor, 'fecha_aceptacion');
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

    if ($_SERVER['REQUEST_METHOD'] === 'POST' && $accion === 'calcular_fechas') {
        $id = (int) ($body['id'] ?? 0);
        $fechaAceptacion = fechaValidaPlanificacion($body['fecha_aceptacion'] ?? null, 'fecha_aceptacion');
        if ($id <= 0 || $fechaAceptacion === null) {
            Response::error('Faltan "id" y/o "fecha_aceptacion"', 422);
        }
        $db->beginTransaction();
        Planificacion::recalcularFechas($db, $id, $fechaAceptacion, $autor);
        $db->commit();
        $stmtObra = $db->prepare('SELECT * FROM planificacion_obras WHERE id = ?');
        $stmtObra->execute([$id]);
        $stmtTareas = $db->prepare('SELECT * FROM planificacion_tareas WHERE obra_id = ? ORDER BY id');
        $stmtTareas->execute([$id]);
        Response::json(['obra' => $stmtObra->fetch(), 'tareas' => $stmtTareas->fetchAll()]);
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
        $categoria = categoriaPlanificacion($body['categoria'] ?? null);
        if ($obraId <= 0 || $categoria === null) {
            Response::error('Faltan "obra_id" y/o una "categoria" válida', 422);
        }
        // Los demás campos son opcionales: los usa "Deshacer" (Ctrl+Z) para
        // volver a crear una tarea eliminada tal como estaba.
        $estado = (string) ($body['estado'] ?? 'Pendiente');
        Planificacion::insertarTarea($db, $obraId, [
            'categoria' => $categoria,
            'fecha_inicio' => fechaValidaPlanificacion($body['fecha_inicio'] ?? null, 'fecha_inicio'),
            'fecha_fin' => fechaValidaPlanificacion($body['fecha_fin'] ?? null, 'fecha_fin'),
            'responsable' => textoONull($body['responsable'] ?? null),
            'ayudante' => textoONull($body['ayudante'] ?? null),
            'estado' => in_array($estado, ESTADOS_TAREA, true) ? $estado : 'Pendiente',
            'comentario' => textoONull($body['comentario'] ?? null),
        ], $autor);
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
        $categoria = array_key_exists('categoria', $body) ? categoriaPlanificacion($body['categoria']) : $actual['categoria'];
        if ($categoria === null) {
            Response::error('Categoría no válida', 422);
        }
        $responsable = array_key_exists('responsable', $body) ? textoONull($body['responsable']) : $actual['responsable'];
        $ayudante = array_key_exists('ayudante', $body) ? textoONull($body['ayudante']) : ($actual['ayudante'] ?? null);
        $comentario = array_key_exists('comentario', $body) ? textoONull($body['comentario']) : $actual['comentario'];

        $db->prepare("
            UPDATE planificacion_tareas
            SET categoria = ?, fecha_inicio = ?, fecha_fin = ?, responsable = ?, ayudante = ?, estado = ?, comentario = ?,
                actualizado_por = ?, actualizado_en = datetime('now')
            WHERE id = ?
        ")->execute([$categoria, $inicio, $fin, $responsable, $ayudante, $estado, $comentario, $autor, $id]);

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
