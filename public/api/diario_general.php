<?php
declare(strict_types=1);

// Diario General de pedidos de material y gestión — leído de la hoja
// "Diario General" de Z:\DRIVE GALVI\3. PUESTO TÉCNICO\1. Diario General
// Galvi.xlsx (ver backend/drive_sync/sync_diario_general.js). Una fila por
// ítem (material o tarea), no por obra — una obra puede tener varias.
//
// Las hojas "Gestión" y "Estatus Categoria" del mismo Excel NO se
// sincronizan: se confirmó que son vistas/copias de esta misma tabla y no
// siempre están al día entre sí. Diario General es la única fuente de
// verdad; el panel arma las dos vistas (Pedidos de Material / Gestión)
// filtrando por categoría en el frontend, no leyendo esas otras hojas.
// Alcance acotado: solo categorías operativas (Proveedor, Chapas, Vidrios,
// Fabricar, Persianas, Lacador, Medir, Acopio, Gestión) — lo administrativo/
// facturación queda fuera a pedido del usuario.
//
// GET: lista todo (requiere sesión + obras.ver_diario_general — Alfredo y
// admin, ambos lo necesitan según la entrevista de Fase 1).
// PATCH: {id, ubicacion} — cambia dónde está el material de un ítem
// puntual (requiere sesión + obras.ver_diario_general).
// POST: {accion:"reemplazar_todo", items:[...]} reemplaza la tabla completa,
// usado por la sincronización con Drive (protegido por SYNC_TOKEN). No hay
// upsert fila por fila porque no hay una clave estable entre corridas: el
// Excel se reordena y las filas se agregan/quitan libremente a mano.
// {accion:"listar_pendientes_ubicacion"} (SYNC_TOKEN) devuelve los ítems con
// un override de Ubicación puesto desde el panel, para que
// escribir_ubicacion_diario_general.js los escriba de vuelta en el Excel
// real (automatización COM, igual que la Ficha de Obras Aceptadas — ver
// llenar_diario_general_com.ps1).
//
// Por eso Ubicación no se guarda solo en la fila de diario_general (esa se
// borra y reinserta entera en cada sync): se guarda además en
// diario_general_ubicacion (tabla aparte, igual que
// obra_aceptada_confirmaciones para Obras Aceptadas) usando una "clave
// estable" calculada con los campos que identifican al ítem en sí — obra,
// categoria, descripcion, proveedor, material, color — y que no cambian de
// una corrida a otra. Los campos de estado (fecha_pedido, estatus_2,
// comentario...) quedan fuera de la clave a propósito, porque esos sí
// cambian con normalidad cuando alguien actualiza el Excel. El GET aplica
// esta capa por encima del valor recién sincronizado, así que un cambio
// hecho en el panel sobrevive a la siguiente sincronización siempre que el
// ítem siga siendo "el mismo" según esos campos; si esos campos cambian en
// el Excel, el override queda huérfano y simplemente deja de aplicarse (no
// rompe nada, solo se pierde el ajuste manual). La misma clave se usa para
// ubicar la fila real en el Excel al escribir de vuelta.

$config = require __DIR__ . '/../../backend/bootstrap.php';

function claveEstableDiario(array $fila): string
{
    $partes = [
        strtolower(trim((string) ($fila['obra'] ?? ''))),
        strtolower(trim((string) ($fila['categoria'] ?? ''))),
        strtolower(trim((string) ($fila['descripcion'] ?? ''))),
        strtolower(trim((string) ($fila['proveedor'] ?? ''))),
        strtolower(trim((string) ($fila['material'] ?? ''))),
        strtolower(trim((string) ($fila['color'] ?? ''))),
    ];
    return implode('|', $partes);
}

try {
    $db = Database::connection($config);

    $db->exec("
        CREATE TABLE IF NOT EXISTS diario_general (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          tipo TEXT,
          cliente TEXT,
          contacto TEXT,
          cod TEXT,
          obra TEXT NOT NULL,
          fecha_aceptacion TEXT,
          categoria TEXT NOT NULL,
          descripcion TEXT,
          color TEXT,
          material TEXT,
          proveedor TEXT,
          fecha_objetivo_inicio TEXT,
          fecha_objetivo_fin TEXT,
          fecha_pedido TEXT,
          tarea_1 TEXT,
          responsable TEXT,
          estatus_2 TEXT,
          fecha_entrega_proveedor TEXT,
          ubicacion TEXT,
          tarea_3 TEXT,
          comentario TEXT,
          prioridad TEXT,
          actualizado_en TEXT NOT NULL DEFAULT (datetime('now'))
        )
    ");

    $db->exec("
        CREATE TABLE IF NOT EXISTS diario_general_ubicacion (
          clave_estable TEXT PRIMARY KEY,
          ubicacion TEXT,
          actualizado_en TEXT NOT NULL DEFAULT (datetime('now'))
        )
    ");

    // Permiso propio (no reutiliza obras.ver_aceptadas): esta tabla no es
    // solo de Alfredo, la entrevista de Fase 1 confirma que Álvaro también
    // la necesita para transporte/montaje — se otorga a los dos roles.
    $db->exec("INSERT OR IGNORE INTO permisos (clave, descripcion) VALUES ('obras.ver_diario_general', 'Ver el Diario General de pedidos de material y gestión')");
    $db->exec("
        INSERT OR IGNORE INTO rol_permisos (rol_id, permiso_id)
        SELECT r.id, p.id FROM roles r, permisos p
        WHERE r.nombre = 'gestion_obras' AND p.clave = 'obras.ver_diario_general'
    ");
    $db->exec("
        INSERT OR IGNORE INTO rol_permisos (rol_id, permiso_id)
        SELECT r.id, p.id FROM roles r, permisos p
        WHERE r.nombre = 'admin' AND p.clave = 'obras.ver_diario_general'
    ");

    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        $usuario = AuthMiddleware::usuarioActual($config['jwt']['secret']);
        AuthMiddleware::requierePermiso($usuario, 'obras.ver_diario_general');

        $items = $db->query('SELECT * FROM diario_general ORDER BY obra, categoria')->fetchAll();

        $overrides = $db->query('SELECT clave_estable, ubicacion FROM diario_general_ubicacion')->fetchAll();
        $overridesPorClave = [];
        foreach ($overrides as $ov) {
            $overridesPorClave[$ov['clave_estable']] = $ov['ubicacion'];
        }
        foreach ($items as &$it) {
            $clave = claveEstableDiario($it);
            if (array_key_exists($clave, $overridesPorClave)) {
                $it['ubicacion'] = $overridesPorClave[$clave];
            }
        }
        unset($it);

        Response::json(['items' => $items]);
    }

    // Ubicación es el único campo editable desde el panel por ahora — dónde
    // está físicamente el material (Borox, Obra, Servido...) es justo lo
    // que Alfredo/Álvaro necesitan poder mover sin volver al Excel.
    if ($_SERVER['REQUEST_METHOD'] === 'PATCH') {
        $usuario = AuthMiddleware::usuarioActual($config['jwt']['secret']);
        AuthMiddleware::requierePermiso($usuario, 'obras.ver_diario_general');

        $body = json_decode((string) file_get_contents('php://input'), true) ?? [];
        $id = (int) ($body['id'] ?? 0);
        if ($id <= 0) {
            Response::error('Falta "id"', 422);
        }
        if (!array_key_exists('ubicacion', $body)) {
            Response::error('Falta "ubicacion"', 422);
        }
        $ubicacion = trim((string) $body['ubicacion']);
        $ubicacionGuardada = $ubicacion === '' ? null : $ubicacion;

        $fila = $db->prepare('SELECT * FROM diario_general WHERE id = ?');
        $fila->execute([$id]);
        $fila = $fila->fetch();
        if (!$fila) {
            Response::error('Ítem no encontrado', 404);
        }

        $db->prepare("UPDATE diario_general SET ubicacion = ?, actualizado_en = datetime('now') WHERE id = ?")
            ->execute([$ubicacionGuardada, $id]);

        $clave = claveEstableDiario($fila);
        $db->prepare("
            INSERT INTO diario_general_ubicacion (clave_estable, ubicacion, actualizado_en)
            VALUES (?, ?, datetime('now'))
            ON CONFLICT(clave_estable) DO UPDATE SET ubicacion = excluded.ubicacion, actualizado_en = excluded.actualizado_en
        ")->execute([$clave, $ubicacionGuardada]);

        Response::json(['ok' => true]);
    }

    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $token = $_GET['token'] ?? $_POST['token'] ?? '';
        if ($config['sync_token'] === '' || !hash_equals($config['sync_token'], (string) $token)) {
            Response::error('No autorizado', 403);
        }

        $body = json_decode((string) file_get_contents('php://input'), true) ?? $_POST;

        // Usado por escribir_ubicacion_diario_general.js (automatización COM
        // de Excel, corre solo en la máquina local con Drive Desktop
        // montado — no hay forma de hacer esto desde el servidor web).
        // Devuelve, para cada ítem que tiene un override de Ubicación
        // guardado, la fila completa (con el override ya aplicado) para que
        // el script pueda ubicar la fila real en el Excel por los mismos
        // campos identificadores que usa claveEstableDiario.
        if (($body['accion'] ?? '') === 'listar_pendientes_ubicacion') {
            $items = $db->query('SELECT * FROM diario_general')->fetchAll();
            $overrides = $db->query('SELECT clave_estable, ubicacion FROM diario_general_ubicacion')->fetchAll();
            $overridesPorClave = [];
            foreach ($overrides as $ov) {
                $overridesPorClave[$ov['clave_estable']] = $ov['ubicacion'];
            }
            $pendientes = [];
            foreach ($items as $it) {
                $clave = claveEstableDiario($it);
                if (array_key_exists($clave, $overridesPorClave)) {
                    $it['ubicacion'] = $overridesPorClave[$clave];
                    $pendientes[] = $it;
                }
            }
            Response::json(['items' => $pendientes]);
        }

        if (($body['accion'] ?? '') === 'reemplazar_todo') {
            $items = $body['items'] ?? null;
            if (!is_array($items)) {
                Response::error('Falta "items" (array)', 422);
            }
            $db->beginTransaction();
            $db->exec('DELETE FROM diario_general');
            $stmt = $db->prepare("
                INSERT INTO diario_general
                    (tipo, cliente, contacto, cod, obra, fecha_aceptacion, categoria, descripcion, color, material, proveedor, fecha_objetivo_inicio, fecha_objetivo_fin, fecha_pedido, tarea_1, responsable, estatus_2, fecha_entrega_proveedor, ubicacion, tarea_3, comentario, prioridad, actualizado_en)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
            ");
            $clavesVigentes = [];
            foreach ($items as $it) {
                $stmt->execute([
                    $it['tipo'] ?? null,
                    $it['cliente'] ?? null,
                    $it['contacto'] ?? null,
                    $it['cod'] ?? null,
                    $it['obra'] ?? '',
                    $it['fecha_aceptacion'] ?? null,
                    $it['categoria'] ?? '',
                    $it['descripcion'] ?? null,
                    $it['color'] ?? null,
                    $it['material'] ?? null,
                    $it['proveedor'] ?? null,
                    $it['fecha_objetivo_inicio'] ?? null,
                    $it['fecha_objetivo_fin'] ?? null,
                    $it['fecha_pedido'] ?? null,
                    $it['tarea_1'] ?? null,
                    $it['responsable'] ?? null,
                    $it['estatus_2'] ?? null,
                    $it['fecha_entrega_proveedor'] ?? null,
                    $it['ubicacion'] ?? null,
                    $it['tarea_3'] ?? null,
                    $it['comentario'] ?? null,
                    $it['prioridad'] ?? null,
                ]);
                $clavesVigentes[claveEstableDiario($it)] = true;
            }

            // Limpia overrides de ítems que ya no existen en el Excel (obra
            // cerrada, fila borrada a mano...) para que la tabla no crezca
            // indefinidamente con ajustes de ubicación que nunca más se van
            // a aplicar.
            $clavesGuardadas = $db->query('SELECT clave_estable FROM diario_general_ubicacion')->fetchAll(PDO::FETCH_COLUMN);
            foreach ($clavesGuardadas as $clave) {
                if (!isset($clavesVigentes[$clave])) {
                    $db->prepare('DELETE FROM diario_general_ubicacion WHERE clave_estable = ?')->execute([$clave]);
                }
            }

            $db->commit();
            Response::json(['ok' => true, 'guardados' => count($items)]);
        }

        Response::error('Acción no reconocida', 422);
    }

    Response::error('Método no permitido', 405);
} catch (Throwable $e) {
    if ($db->inTransaction()) {
        $db->rollBack();
    }
    Response::error(get_class($e) . ': ' . $e->getMessage(), 500);
}
