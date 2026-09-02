<?php
declare(strict_types=1);

// Seguimiento de pedidos de material por obra aceptada — leído de la hoja
// "BD" (detalle por ítem) del Excel "...MEDYSEG.xlsx" que Alfredo (Gestión
// de Obras) lleva por obra dentro de "SEGUIMIENTO DE OBRAS (Aceptadas)"
// (ver backend/drive_sync/sync_obras_aceptadas.js /
// extract_seguimiento_materiales.js). Tabla separada de
// presupuestos_en_estudio porque es un dominio de datos distinto
// (logística de pedidos, no presupuesto) — el panel las cruza por nombre
// de obra en el frontend. Se agrupa en el panel por Tipo (modelo de
// ventana) y dentro de cada tipo por Posición (la ventana física puntual):
// un mismo tipo puede repetirse en varias posiciones.
//
// GET: lista todo el seguimiento (requiere sesión + obras.ver_aceptadas).
// Estado/Fecha Estimada/Comentario vienen con el override del panel
// aplicado por encima del valor recién sincronizado del Excel (ver
// seguimiento_materiales_overrides más abajo), igual patrón que Ubicación
// en diario_general.php.
// PATCH: {obra, posicion, tipo, material, descripcion, campo, valor} —
// Alfredo edita Estado, Fecha Estimada o Comentario de un ítem puntual
// (requiere sesión + obras.ver_aceptadas). Como no hay un id estable entre
// sincronizaciones (dos filas pueden ser idénticas, ej. dos paños de vidrio
// iguales en la misma posición), se identifica el ítem por el contenido
// que lo describe (posicion+tipo+material+descripcion) en vez de por fila
// de Excel — si hay ítems duplicados exactos, comparten el mismo override
// (limitación aceptada, no hay forma de distinguirlos solo por contenido).
// OJO: esto guarda el cambio en el panel (sobrevive a la próxima
// sincronización), pero todavía NO lo escribe de vuelta al Excel real —
// eso queda pendiente como paso aparte si hace falta.
// POST: reemplaza completo el seguimiento de una obra puntual, usado por la
// sincronización con Drive (protegido por SYNC_TOKEN, no por sesión de
// usuario). No hay upsert fila por fila porque no hay una clave estable
// entre corridas (una fila puede reordenarse, agregarse o quitarse en la
// hoja de origen entre una sincronización y la siguiente) — de paso limpia
// los overrides de ítems que ya no aparecen en esta obra.

$config = require __DIR__ . '/../../backend/bootstrap.php';

const CAMPOS_EDITABLES = ['estado', 'fecha_estimada', 'comentario'];

function claveEstableMaterial(array $m): string
{
    $partes = [
        strtolower(trim((string) ($m['posicion'] ?? ''))),
        strtolower(trim((string) ($m['tipo'] ?? ''))),
        strtolower(trim((string) ($m['material'] ?? ''))),
        strtolower(trim((string) ($m['descripcion'] ?? ''))),
    ];
    return implode('|', $partes);
}

try {
    $db = Database::connection($config);

    $db->exec("
        CREATE TABLE IF NOT EXISTS seguimiento_materiales (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          obra TEXT NOT NULL,
          fila_excel INTEGER,
          posicion TEXT,
          tipo TEXT,
          material TEXT,
          descripcion TEXT,
          estado TEXT,
          proveedor TEXT,
          fecha_pedido TEXT,
          numero_orden TEXT,
          fecha_estimada TEXT,
          comentario TEXT,
          actualizado_en TEXT NOT NULL DEFAULT (datetime('now'))
        )
    ");

    // Migración idempotente: la tabla original (antes de leer "BD" en vez
    // de "SEG") no tenía fila_excel/tipo/descripcion.
    $columnas = array_column($db->query('PRAGMA table_info(seguimiento_materiales)')->fetchAll(), 'name');
    foreach (['fila_excel', 'tipo', 'descripcion'] as $columna) {
        if (!in_array($columna, $columnas, true)) {
            $tipoSql = $columna === 'fila_excel' ? 'INTEGER' : 'TEXT';
            $db->exec("ALTER TABLE seguimiento_materiales ADD COLUMN $columna $tipoSql");
        }
    }

    $db->exec("
        CREATE TABLE IF NOT EXISTS seguimiento_materiales_overrides (
          obra TEXT NOT NULL,
          clave_estable TEXT NOT NULL,
          campo TEXT NOT NULL,
          valor TEXT,
          actualizado_en TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (obra, clave_estable, campo)
        )
    ");

    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        $usuario = AuthMiddleware::usuarioActual($config['jwt']['secret']);
        AuthMiddleware::requierePermiso($usuario, 'obras.ver_aceptadas');

        $materiales = $db->query('SELECT * FROM seguimiento_materiales ORDER BY obra, id')->fetchAll();

        $overrides = $db->query('SELECT obra, clave_estable, campo, valor FROM seguimiento_materiales_overrides')->fetchAll();
        $overridesPorClave = [];
        foreach ($overrides as $ov) {
            $overridesPorClave[$ov['obra'] . '::' . $ov['clave_estable']][$ov['campo']] = $ov['valor'];
        }
        foreach ($materiales as &$m) {
            $clave = $m['obra'] . '::' . claveEstableMaterial($m);
            if (isset($overridesPorClave[$clave])) {
                foreach ($overridesPorClave[$clave] as $campo => $valor) {
                    $m[$campo] = $valor;
                }
            }
        }
        unset($m);

        Response::json(['materiales' => $materiales]);
    }

    if ($_SERVER['REQUEST_METHOD'] === 'PATCH') {
        $usuario = AuthMiddleware::usuarioActual($config['jwt']['secret']);
        AuthMiddleware::requierePermiso($usuario, 'obras.ver_aceptadas');

        $body = json_decode((string) file_get_contents('php://input'), true) ?? [];
        $obra = trim((string) ($body['obra'] ?? ''));
        $campo = (string) ($body['campo'] ?? '');
        if ($obra === '' || !in_array($campo, CAMPOS_EDITABLES, true)) {
            Response::error('Falta "obra" y/o "campo" debe ser uno de: ' . implode(', ', CAMPOS_EDITABLES), 422);
        }
        if (!array_key_exists('valor', $body)) {
            Response::error('Falta "valor"', 422);
        }
        $valor = trim((string) $body['valor']);
        $valorGuardado = $valor === '' ? null : $valor;

        $clave = claveEstableMaterial($body);

        $db->prepare("
            INSERT INTO seguimiento_materiales_overrides (obra, clave_estable, campo, valor, actualizado_en)
            VALUES (?, ?, ?, ?, datetime('now'))
            ON CONFLICT(obra, clave_estable, campo) DO UPDATE SET valor = excluded.valor, actualizado_en = excluded.actualizado_en
        ")->execute([$obra, $clave, $campo, $valorGuardado]);

        Response::json(['ok' => true]);
    }

    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $token = $_GET['token'] ?? $_POST['token'] ?? '';
        if ($config['sync_token'] === '' || !hash_equals($config['sync_token'], (string) $token)) {
            Response::error('No autorizado', 403);
        }

        $body = json_decode((string) file_get_contents('php://input'), true) ?? $_POST;

        if (($body['accion'] ?? '') === 'listar_debug') {
            $obra = trim((string) ($body['obra'] ?? ''));
            $stmt = $db->prepare('SELECT * FROM seguimiento_materiales WHERE obra = ? ORDER BY id LIMIT 5');
            $stmt->execute([$obra]);
            Response::json(['materiales' => $stmt->fetchAll()]);
        }

        if (($body['accion'] ?? '') === 'reemplazar_materiales') {
            $obra = trim((string) ($body['obra'] ?? ''));
            $materiales = $body['materiales'] ?? null;
            if ($obra === '' || !is_array($materiales)) {
                Response::error('Faltan "obra" y/o "materiales" (array)', 422);
            }
            $db->prepare('DELETE FROM seguimiento_materiales WHERE obra = ?')->execute([$obra]);
            $stmt = $db->prepare("
                INSERT INTO seguimiento_materiales
                    (obra, fila_excel, posicion, tipo, material, descripcion, estado, proveedor, fecha_pedido, numero_orden, fecha_estimada, comentario, actualizado_en)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
            ");
            $clavesVigentes = [];
            foreach ($materiales as $m) {
                $stmt->execute([
                    $obra,
                    $m['filaExcel'] ?? null,
                    $m['posicion'] ?? null,
                    $m['tipo'] ?? null,
                    $m['material'] ?? null,
                    $m['descripcion'] ?? null,
                    $m['estado'] ?? null,
                    $m['proveedor'] ?? null,
                    $m['fecha_pedido'] ?? null,
                    $m['numero_orden'] ?? null,
                    $m['fecha_estimada'] ?? null,
                    $m['comentario'] ?? null,
                ]);
                $clavesVigentes[claveEstableMaterial($m)] = true;
            }

            // Limpia overrides de ítems que ya no existen en esta obra (se
            // borró la fila en el Excel).
            $clavesGuardadas = $db->prepare('SELECT clave_estable FROM seguimiento_materiales_overrides WHERE obra = ?');
            $clavesGuardadas->execute([$obra]);
            foreach ($clavesGuardadas->fetchAll(PDO::FETCH_COLUMN) as $clave) {
                if (!isset($clavesVigentes[$clave])) {
                    $db->prepare('DELETE FROM seguimiento_materiales_overrides WHERE obra = ? AND clave_estable = ?')->execute([$obra, $clave]);
                }
            }

            Response::json(['ok' => true, 'guardadas' => count($materiales)]);
        }

        Response::error('Acción no reconocida', 422);
    }

    Response::error('Método no permitido', 405);
} catch (Throwable $e) {
    Response::error(get_class($e) . ': ' . $e->getMessage(), 500);
}
