<?php
declare(strict_types=1);

// Vista "Costes" (2026-09-15, a pedido de Álvaro) — solo para admin: por
// cada obra aceptada, compara el costo con el que se armó el presupuesto
// (obras_aceptadas.costo_inicial, ver ese archivo) contra el gasto real
// acumulado en PAF.xlsx ("Pedido-Albaran-Factura", la planilla donde Sandra/
// Alfredo/etc. cargan cada pedido/albarán/factura a mano) — para ver en qué
// obras ya se pasaron del costo inicial.
//
// costes_reales_obra: un total por obra, agregado por
// backend/drive_sync/sync_costes_paf.js sumando TODAS las filas del PAF que
// matchean esa obra (columna "Importe Fra. sin IVA", sin filtrar por
// "Estado" — a pedido explícito de Álvaro, "incluir todos los gastos, no
// excluir nada"). La columna "Obra" del PAF es texto libre escrito a mano
// (variantes, apellidos de más, etc.) — el script la normaliza y la
// empareja contra los nombres reales de obras_aceptadas; lo que no logra
// emparejar automáticamente NO se pierde, queda en
// costes_reales_sin_asignar para que un admin lo revise a mano (evita que
// un gasto real quede invisible por un typo, pero también evita
// adjudicárselo a la obra equivocada por error).
//
// GET: requiere sesión + rol admin. Devuelve obras_aceptadas (con
// precio_presupuesto/costo_inicial) + costes_reales_obra + lo sin asignar.
// POST: {accion:"reemplazar_costes_reales", costes:[...], sin_asignar:[...]}
// protegido por SYNC_TOKEN — reemplaza las dos tablas completas en cada
// corrida (mismo criterio que reemplazar_materiales en
// seguimiento_materiales.php: la sincronización es la única fuente de
// verdad de estos datos, no hay edición manual que proteger).

$config = require __DIR__ . '/../../backend/bootstrap.php';

function tieneRolCostes(array $usuario, string $rol): bool
{
    return in_array($rol, $usuario['roles'] ?? [], true);
}

try {
    $db = Database::connection($config);

    $db->exec("
        CREATE TABLE IF NOT EXISTS costes_reales_obra (
          obra TEXT PRIMARY KEY,
          costo_real REAL NOT NULL,
          cantidad_filas INTEGER NOT NULL,
          actualizado_en TEXT NOT NULL DEFAULT (datetime('now'))
        )
    ");
    $db->exec("
        CREATE TABLE IF NOT EXISTS costes_reales_sin_asignar (
          obra_texto TEXT PRIMARY KEY,
          total REAL NOT NULL,
          cantidad_filas INTEGER NOT NULL,
          actualizado_en TEXT NOT NULL DEFAULT (datetime('now'))
        )
    ");

    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        $usuario = AuthMiddleware::usuarioActual($config['jwt']['secret']);
        if (!tieneRolCostes($usuario, 'admin')) {
            Response::error('No autorizado para esta acción', 403);
        }

        $obras = $db->query("
            SELECT obra, categoria, contacto, cliente, estatus, precio_presupuesto, costo_inicial
            FROM obras_aceptadas
            ORDER BY obra
        ")->fetchAll();
        $costesReales = $db->query('SELECT * FROM costes_reales_obra')->fetchAll();
        $sinAsignar = $db->query('SELECT * FROM costes_reales_sin_asignar ORDER BY total DESC')->fetchAll();

        Response::json(['obras' => $obras, 'costes_reales' => $costesReales, 'sin_asignar' => $sinAsignar]);
    }

    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $token = $_GET['token'] ?? $_POST['token'] ?? '';
        if ($config['sync_token'] === '' || !hash_equals($config['sync_token'], (string) $token)) {
            Response::error('No autorizado', 403);
        }

        $body = json_decode((string) file_get_contents('php://input'), true) ?? [];
        if (($body['accion'] ?? '') !== 'reemplazar_costes_reales') {
            Response::error('Falta accion "reemplazar_costes_reales"', 422);
        }

        $costes = $body['costes'] ?? null;
        $sinAsignar = $body['sin_asignar'] ?? null;
        if (!is_array($costes) || !is_array($sinAsignar)) {
            Response::error('Faltan "costes" y/o "sin_asignar" (arrays)', 422);
        }

        $db->beginTransaction();
        try {
            $db->exec('DELETE FROM costes_reales_obra');
            $stmt = $db->prepare('INSERT INTO costes_reales_obra (obra, costo_real, cantidad_filas) VALUES (?, ?, ?)');
            foreach ($costes as $c) {
                $obra = trim((string) ($c['obra'] ?? ''));
                if ($obra === '') {
                    continue;
                }
                $stmt->execute([$obra, $c['costo_real'] ?? 0, $c['cantidad_filas'] ?? 0]);
            }

            $db->exec('DELETE FROM costes_reales_sin_asignar');
            $stmtSinAsignar = $db->prepare('INSERT INTO costes_reales_sin_asignar (obra_texto, total, cantidad_filas) VALUES (?, ?, ?)');
            foreach ($sinAsignar as $s) {
                $obraTexto = trim((string) ($s['obra_texto'] ?? ''));
                if ($obraTexto === '') {
                    continue;
                }
                $stmtSinAsignar->execute([$obraTexto, $s['total'] ?? 0, $s['cantidad_filas'] ?? 0]);
            }
            $db->commit();
        } catch (Throwable $e) {
            $db->rollBack();
            throw $e;
        }

        Response::json(['ok' => true, 'obras' => count($costes), 'sin_asignar' => count($sinAsignar)]);
    }

    Response::error('Método no permitido', 405);
} catch (Throwable $e) {
    Response::error(get_class($e) . ': ' . $e->getMessage(), 500);
}
