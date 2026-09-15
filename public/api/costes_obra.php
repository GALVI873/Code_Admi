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
// costes_reales_categoria: mismo total real, pero desglosado por categoría
// (Material/Vidrio/Chapas/Transporte/Persianas/Composite/Comision/
// Ingenieria/Colocacion/Variable) — sync_costes_paf.js mapea la columna
// "Categoría" del PAF a las categorías de la Comparativa (mapeo dado por
// Álvaro el 2026-09-15: M.O.→Colocacion, Fabricación→Colocacion,
// Fabricación y Suministro→Material, Ferretería→Variable, Persianas/
// Composite/Comision/Ingenieria quedan con su propio nombre porque no
// existen como categoría en la Comparativa). "Varios" del PAF queda
// deliberadamente AFUERA de este desglose (informativo, no se le adjudica
// a ninguna categoría) — por eso la suma de costes_reales_categoria de una
// obra puede ser menor que su total en costes_reales_obra.
//
// costes_alias_obra: correcciones manuales de un admin para textos del PAF
// que nunca van a cruzar solos contra ninguna obra conocida (ej. "Los
// Cerezos, 543-A / Urb. El clavín" trae el número de parcela METIDO en el
// medio, entre "Los Cerezos" y "Urb. El Clavín" — rompe la coincidencia de
// texto aunque sea, a simple vista, obviamente la misma obra). En vez de
// tocar PAF.xlsx (archivo compartido, lo editan varias personas) o renombrar
// la carpeta de Drive de la obra (rompería otras cosas que dependen de ese
// nombre exacto), un admin asigna el texto tal cual aparece en el PAF a la
// obra correcta UNA vez — sync_costes_paf.js consulta esta tabla primero
// (texto exacto, sin pasar por el emparejamiento automático) antes de
// intentar el resto, así queda resuelto para siempre.
//
// GET: requiere sesión + rol admin. Devuelve obras_aceptadas (con
// precio_presupuesto/costo_inicial) + costes_reales_obra + costes por
// categoría (iniciales y reales) + lo sin asignar + los alias ya cargados.
// PATCH {accion:"asignar_alias", texto_paf, obra}: requiere sesión + rol
// admin — guarda el alias y migra al toque lo que ya estaba en "sin
// asignar" para ese texto hacia costes_reales_obra (no hace falta esperar a
// la próxima sincronización para verlo reflejado; el desglose por
// categoría sí espera a la próxima corrida de sync_costes_paf.js, que
// vuelve a leer el PAF completo).
// PATCH {accion:"quitar_alias", texto_paf}: deshace un alias por si se
// asignó mal.
// POST: {accion:"reemplazar_costes_reales", costes:[...], costes_categoria:
// [...], sin_asignar:[...]} protegido por SYNC_TOKEN — reemplaza las tablas
// completas en cada corrida (mismo criterio que reemplazar_materiales en
// seguimiento_materiales.php: la sincronización es la única fuente de
// verdad de estos datos, no hay edición manual que proteger). {accion:
// "listar_alias"} (también SYNC_TOKEN) — lee la tabla de alias para que
// sync_costes_paf.js la consulte antes de emparejar.

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
    $db->exec("
        CREATE TABLE IF NOT EXISTS costes_reales_categoria (
          obra TEXT NOT NULL,
          categoria TEXT NOT NULL,
          costo_real REAL NOT NULL,
          cantidad_filas INTEGER NOT NULL,
          actualizado_en TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (obra, categoria)
        )
    ");
    // Definida también acá (no solo en obras_aceptadas.php, que es quien la
    // escribe) porque el GET de abajo la lee — mismo criterio del resto del
    // proyecto: cada archivo asegura las tablas que toca.
    $db->exec("
        CREATE TABLE IF NOT EXISTS costes_iniciales_categoria (
          obra TEXT NOT NULL,
          categoria TEXT NOT NULL,
          costo_inicial REAL NOT NULL,
          actualizado_en TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (obra, categoria)
        )
    ");
    $db->exec("
        CREATE TABLE IF NOT EXISTS costes_alias_obra (
          texto_paf TEXT PRIMARY KEY,
          obra TEXT NOT NULL,
          creado_en TEXT NOT NULL DEFAULT (datetime('now'))
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
        $categoriasIniciales = $db->query('SELECT * FROM costes_iniciales_categoria')->fetchAll();
        $categoriasReales = $db->query('SELECT * FROM costes_reales_categoria')->fetchAll();
        $alias = $db->query('SELECT * FROM costes_alias_obra ORDER BY creado_en DESC')->fetchAll();

        Response::json([
            'obras' => $obras,
            'costes_reales' => $costesReales,
            'sin_asignar' => $sinAsignar,
            'categorias_iniciales' => $categoriasIniciales,
            'categorias_reales' => $categoriasReales,
            'alias' => $alias,
        ]);
    }

    if ($_SERVER['REQUEST_METHOD'] === 'PATCH') {
        $usuario = AuthMiddleware::usuarioActual($config['jwt']['secret']);
        if (!tieneRolCostes($usuario, 'admin')) {
            Response::error('No autorizado para esta acción', 403);
        }

        $body = json_decode((string) file_get_contents('php://input'), true) ?? [];
        $textoPaf = trim((string) ($body['texto_paf'] ?? ''));
        if ($textoPaf === '') {
            Response::error('Falta "texto_paf"', 422);
        }

        if (($body['accion'] ?? '') === 'asignar_alias') {
            $obra = trim((string) ($body['obra'] ?? ''));
            if ($obra === '') {
                Response::error('Falta "obra"', 422);
            }

            $db->prepare("
                INSERT INTO costes_alias_obra (texto_paf, obra) VALUES (?, ?)
                ON CONFLICT(texto_paf) DO UPDATE SET obra = excluded.obra, creado_en = datetime('now')
            ")->execute([$textoPaf, $obra]);

            // Migra al toque lo que ya estaba en "sin asignar" para este
            // texto — no hace falta esperar a la próxima corrida del PAF
            // para verlo reflejado en el total de la obra (el desglose por
            // categoría sí espera, ver comentario de cabecera).
            $stmtSinAsignar = $db->prepare('SELECT * FROM costes_reales_sin_asignar WHERE obra_texto = ?');
            $stmtSinAsignar->execute([$textoPaf]);
            $filaSinAsignar = $stmtSinAsignar->fetch();
            if ($filaSinAsignar) {
                $db->prepare("
                    INSERT INTO costes_reales_obra (obra, costo_real, cantidad_filas) VALUES (?, ?, ?)
                    ON CONFLICT(obra) DO UPDATE SET
                        costo_real = costo_real + excluded.costo_real,
                        cantidad_filas = cantidad_filas + excluded.cantidad_filas,
                        actualizado_en = datetime('now')
                ")->execute([$obra, $filaSinAsignar['total'], $filaSinAsignar['cantidad_filas']]);
                $db->prepare('DELETE FROM costes_reales_sin_asignar WHERE obra_texto = ?')->execute([$textoPaf]);
            }

            Response::json(['ok' => true]);
        }

        if (($body['accion'] ?? '') === 'quitar_alias') {
            $db->prepare('DELETE FROM costes_alias_obra WHERE texto_paf = ?')->execute([$textoPaf]);
            Response::json(['ok' => true]);
        }

        Response::error('Falta accion "asignar_alias" o "quitar_alias"', 422);
    }

    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $token = $_GET['token'] ?? $_POST['token'] ?? '';
        if ($config['sync_token'] === '' || !hash_equals($config['sync_token'], (string) $token)) {
            Response::error('No autorizado', 403);
        }

        $body = json_decode((string) file_get_contents('php://input'), true) ?? [];

        if (($body['accion'] ?? '') === 'listar_alias') {
            $alias = $db->query('SELECT texto_paf, obra FROM costes_alias_obra')->fetchAll();
            Response::json(['alias' => $alias]);
        }

        if (($body['accion'] ?? '') !== 'reemplazar_costes_reales') {
            Response::error('Falta accion "reemplazar_costes_reales" o "listar_alias"', 422);
        }

        $costes = $body['costes'] ?? null;
        $sinAsignar = $body['sin_asignar'] ?? null;
        $costesCategoria = $body['costes_categoria'] ?? [];
        if (!is_array($costes) || !is_array($sinAsignar) || !is_array($costesCategoria)) {
            Response::error('Faltan "costes", "sin_asignar" y/o "costes_categoria" (arrays)', 422);
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

            $db->exec('DELETE FROM costes_reales_categoria');
            $stmtCat = $db->prepare('INSERT INTO costes_reales_categoria (obra, categoria, costo_real, cantidad_filas) VALUES (?, ?, ?, ?)');
            foreach ($costesCategoria as $c) {
                $obra = trim((string) ($c['obra'] ?? ''));
                $categoria = trim((string) ($c['categoria'] ?? ''));
                if ($obra === '' || $categoria === '') {
                    continue;
                }
                $stmtCat->execute([$obra, $categoria, $c['costo_real'] ?? 0, $c['cantidad_filas'] ?? 0]);
            }
            $db->commit();
        } catch (Throwable $e) {
            $db->rollBack();
            throw $e;
        }

        Response::json(['ok' => true, 'obras' => count($costes), 'sin_asignar' => count($sinAsignar), 'categorias' => count($costesCategoria)]);
    }

    Response::error('Método no permitido', 405);
} catch (Throwable $e) {
    Response::error(get_class($e) . ': ' . $e->getMessage(), 500);
}
