<?php
declare(strict_types=1);

// Adicionales de obra: trabajo extra que un cliente pide sobre una obra ya
// aceptada (cambios, ampliaciones) — Geraldinne los carga a mano desde la
// pestaña "Adicionales de Obra" de Presupuesto, no viene de ninguna
// sincronización con Drive. El "cliente" de cada adicional NUNCA se guarda
// como texto propio: siempre se resuelve al vuelo contra obras_aceptadas
// (JOIN por nombre de obra), así que si ese dato cambia ahí, se refleja acá
// solo, sin quedar desactualizado.
//
// GET: lista los adicionales + la lista de obras aceptadas disponibles para
// el desplegable "Nombre" (requiere sesión + presupuestos.ver_todos o
// presupuestos.ver_seguimiento — misma audiencia que la página Presupuesto,
// A PROPÓSITO no se exige obras.ver_aceptadas para no tener que abrirle a
// Geraldinne la página completa de Obras Aceptadas solo para este
// desplegable).
// POST: crea un adicional {obra, fecha_solicitud, detalle, solicitado_por} —
// arranca siempre en estatus "En Valoración" y prioridad "Normal".
// PATCH: {id, estatus} cambia el estatus ("En Valoración"/"Enviado") — como
// el resto de los campos, es Geraldinne quien lo hace a mano (requiere
// presupuestos.ver_seguimiento, no alcanza con ver_todos). {id, prioridad}
// cambia la prioridad ("Alta"/"Normal") — esa es exclusiva de Álvaro/
// Valentina (requiere presupuestos.gestionar_prioridad), mismo criterio que
// la prioridad de Presupuesto: decide si el adicional aparece en el bloque
// de arriba de "Orden del día".
// DELETE: {id} borra un adicional puntual (por si se cargó mal).

const ESTATUS_ADICIONAL_VALIDOS = ['En Valoración', 'Enviado'];
const PRIORIDAD_ADICIONAL_VALIDOS = ['Alta', 'Normal'];

$config = require __DIR__ . '/../../backend/bootstrap.php';

try {
    $db = Database::connection($config);

    $db->exec("
        CREATE TABLE IF NOT EXISTS adicionales_obra (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          obra TEXT NOT NULL,
          estatus TEXT NOT NULL DEFAULT 'En Valoración',
          prioridad TEXT NOT NULL DEFAULT 'Normal',
          fecha_solicitud TEXT,
          detalle TEXT NOT NULL,
          solicitado_por TEXT,
          creado_por_email TEXT,
          creado_por_nombre TEXT,
          creado_en TEXT NOT NULL DEFAULT (datetime('now')),
          actualizado_en TEXT NOT NULL DEFAULT (datetime('now'))
        )
    ");
    $columnasAdicionales = array_column($db->query('PRAGMA table_info(adicionales_obra)')->fetchAll(), 'name');
    if (!in_array('estatus', $columnasAdicionales, true)) {
        $db->exec("ALTER TABLE adicionales_obra ADD COLUMN estatus TEXT NOT NULL DEFAULT 'En Valoración'");
    }
    if (!in_array('prioridad', $columnasAdicionales, true)) {
        $db->exec("ALTER TABLE adicionales_obra ADD COLUMN prioridad TEXT NOT NULL DEFAULT 'Normal'");
    }

    $usuario = AuthMiddleware::usuarioActual($config['jwt']['secret']);
    AuthMiddleware::requiereAlgunPermiso($usuario, ['presupuestos.ver_todos', 'presupuestos.ver_seguimiento']);

    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        $adicionales = $db->query("
            SELECT
                a.*,
                COALESCE(NULLIF(oa.cliente, ''), oa.contacto) AS obra_cliente
            FROM adicionales_obra a
            LEFT JOIN obras_aceptadas oa ON oa.obra = a.obra
            ORDER BY a.creado_en DESC
        ")->fetchAll();

        $obrasDisponibles = $db->query("
            SELECT obra, COALESCE(NULLIF(cliente, ''), contacto) AS cliente
            FROM obras_aceptadas
            ORDER BY obra
        ")->fetchAll();

        Response::json(['adicionales' => $adicionales, 'obras_disponibles' => $obrasDisponibles]);
    }

    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $body = json_decode((string) file_get_contents('php://input'), true) ?? [];

        $obra = trim((string) ($body['obra'] ?? ''));
        $detalle = trim((string) ($body['detalle'] ?? ''));
        $fechaSolicitud = trim((string) ($body['fecha_solicitud'] ?? ''));
        $solicitadoPor = trim((string) ($body['solicitado_por'] ?? ''));

        if ($obra === '' || $detalle === '') {
            Response::error('Faltan "obra" y/o "detalle"', 422);
        }
        if ($fechaSolicitud !== '' && !preg_match('/^\d{4}-\d{2}-\d{2}$/', $fechaSolicitud)) {
            Response::error('"fecha_solicitud" debe tener formato AAAA-MM-DD', 422);
        }

        $stmtObra = $db->prepare('SELECT COALESCE(NULLIF(cliente, \'\'), contacto) AS cliente FROM obras_aceptadas WHERE obra = ?');
        $stmtObra->execute([$obra]);
        $obraExistente = $stmtObra->fetch();
        if (!$obraExistente) {
            Response::error('"obra" no coincide con ninguna obra aceptada', 422);
        }

        $stmt = $db->prepare("
            INSERT INTO adicionales_obra
                (obra, fecha_solicitud, detalle, solicitado_por, creado_por_email, creado_por_nombre, creado_en, actualizado_en)
            VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
        ");
        $stmt->execute([
            $obra,
            $fechaSolicitud === '' ? null : $fechaSolicitud,
            $detalle,
            $solicitadoPor === '' ? null : $solicitadoPor,
            $usuario['email'] ?? null,
            $usuario['nombre'] ?? null,
        ]);

        $id = (int) $db->lastInsertId();
        $stmtNuevo = $db->prepare('SELECT * FROM adicionales_obra WHERE id = ?');
        $stmtNuevo->execute([$id]);
        $nuevo = $stmtNuevo->fetch();
        $nuevo['obra_cliente'] = $obraExistente['cliente'];

        Response::json(['ok' => true, 'adicional' => $nuevo]);
    }

    if ($_SERVER['REQUEST_METHOD'] === 'PATCH') {
        $body = json_decode((string) file_get_contents('php://input'), true) ?? [];
        $id = (int) ($body['id'] ?? 0);
        if ($id <= 0) {
            Response::error('Falta "id"', 422);
        }

        if (array_key_exists('estatus', $body)) {
            AuthMiddleware::requierePermiso($usuario, 'presupuestos.ver_seguimiento');
            $estatus = trim((string) $body['estatus']);
            if (!in_array($estatus, ESTATUS_ADICIONAL_VALIDOS, true)) {
                Response::error('"estatus" debe ser una de: ' . implode(', ', ESTATUS_ADICIONAL_VALIDOS), 422);
            }
            $db->prepare("UPDATE adicionales_obra SET estatus = ?, actualizado_en = datetime('now') WHERE id = ?")
                ->execute([$estatus, $id]);
        }

        if (array_key_exists('prioridad', $body)) {
            AuthMiddleware::requierePermiso($usuario, 'presupuestos.gestionar_prioridad');
            $prioridad = trim((string) $body['prioridad']);
            if (!in_array($prioridad, PRIORIDAD_ADICIONAL_VALIDOS, true)) {
                Response::error('"prioridad" debe ser una de: ' . implode(', ', PRIORIDAD_ADICIONAL_VALIDOS), 422);
            }
            $db->prepare("UPDATE adicionales_obra SET prioridad = ?, actualizado_en = datetime('now') WHERE id = ?")
                ->execute([$prioridad, $id]);
        }

        Response::json(['ok' => true]);
    }

    if ($_SERVER['REQUEST_METHOD'] === 'DELETE') {
        $body = json_decode((string) file_get_contents('php://input'), true) ?? [];
        $id = (int) ($body['id'] ?? 0);
        if ($id <= 0) {
            Response::error('Falta "id"', 422);
        }
        $db->prepare('DELETE FROM adicionales_obra WHERE id = ?')->execute([$id]);
        Response::json(['ok' => true]);
    }

    Response::error('Método no permitido', 405);
} catch (Throwable $e) {
    Response::error(get_class($e) . ': ' . $e->getMessage(), 500);
}
