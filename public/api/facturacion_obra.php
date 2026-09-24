<?php
declare(strict_types=1);

// Pestaña "Facturación" de una obra aceptada — a pedido de Álvaro,
// 2026-09-23: hoy esto se lleva a mano en la hoja "Facturación" del
// MEDYSEG.xlsx de cada obra (verificado contra Azalea, que ya facturó 3
// veces: la hoja "Facturación 3" de esa obra coincide centavo a centavo con
// la factura real "GALVI FRA 089-2026"). El panel arranca llevando ese
// mismo registro para poder ir generando desde acá la proforma y la
// factura, en vez de mantenerlo aparte.
//
// MODELO:
// - facturacion_datos_cliente: razón social/NIF/dirección fiscal + IVA y
//   retención de la obra (varían por cliente — ej. particular 21%/0%,
//   empresa con inversión del sujeto pasivo 0%/5% — no hay forma de
//   derivarlos solos, Alfredo los carga una vez por obra).
// - facturacion_linea: cada renglón facturable (una posición del pedido, o
//   algo fuera de presupuesto agregado a mano — ej. chapas, incrementos:
//   a pedido de Álvaro, 2026-09-23, esto se resuelve como una línea más,
//   sin un mecanismo aparte para combinar varias posiciones en una).
// - facturacion_ronda: cada tanda de facturación (proforma o factura), con
//   su fecha; una factura real puede llevar el número que le puso
//   Contabilidad (numero_factura) una vez emitida — el panel NO asigna
//   numeración fiscal sola, eso lo decide Contabilidad como siempre.
// - facturacion_ronda_linea: cuánto (unidades e importe) se facturó de
//   CADA línea en esa ronda puntual.
// - facturacion_anticipo / facturacion_anticipo_amortizacion: a pedido de
//   Álvaro — un anticipo es su propio registro (monto, fecha, descripción),
//   y cada ronda puede amortizar (descontar) una parte de él. Reemplaza el
//   truco de MEDYSEG (unidades en -1, precio negativo) por algo explícito:
//   nunca se puede amortizar más de lo que tiene el anticipo, y el saldo
//   pendiente de amortizar queda siempre visible.
//
// "Pendiente" de una línea = su total menos la suma de lo facturado en
// todas las rondas ya creadas — se calcula al vuelo, no se guarda.
//
// GET ?obra=... : requiere sesión + obras.ver_aceptadas. Devuelve
// datos_cliente, lineas (con "facturado"/"pendiente" ya calculados),
// rondas (con su detalle de líneas y amortizaciones) y anticipos (con su
// saldo).
// PATCH {accion:"actualizar_datos_cliente", obra, razon_social?, nif?,
//   direccion_fiscal?, iva_pct?, retencion_pct?}.
// POST {accion:"agregar_linea", obra, concepto, presupuesto_ref?, uds,
//   precio_unit}: una línea nueva (posición o "fuera de presupuesto").
// POST {accion:"agregar_anticipo", obra, descripcion, monto, fecha}.
// POST {accion:"crear_ronda", obra, tipo ("proforma"|"factura"), fecha,
//   lineas:[{linea_id, uds, importe}], amortizaciones?:[{anticipo_id,
//   monto}], numero_factura?}: crea la ronda siguiente (numeración propia
//   por obra, 1/2/3...) con el detalle de cada línea facturada en esa
//   tanda; valida que ninguna amortización supere el saldo del anticipo.
// PATCH {accion:"asignar_numero_factura", ronda_id, numero_factura}: para
//   cuando Contabilidad ya emitió la factura real y hay que dejar
//   registrado el número que le puso.
// PATCH {accion:"editar_linea", id, concepto?, presupuesto_ref?, uds?,
//   precio_unit?}: edita una línea existente EN EL LUGAR (mismo id) —
//   a diferencia de eliminar_linea, funciona aunque la línea ya se haya
//   usado en alguna ronda (no toca el histórico de facturación, solo el
//   texto/precio de la línea); recalcula "total" si cambian uds o
//   precio_unit.
// DELETE {accion:"eliminar_linea", id}: solo si esa línea todavía no se
//   usó en ninguna ronda (protege el registro histórico).
// DELETE {accion:"eliminar_ronda", id}: por si se cargó mal — borra la
//   ronda y sus amortizaciones asociadas.
// Todo lo de sesión requiere obras.ver_aceptadas (Alfredo y admin).

const TIPOS_RONDA_VALIDOS = ['proforma', 'factura'];

$config = require __DIR__ . '/../../backend/bootstrap.php';

try {
    $db = Database::connection($config);

    $db->exec("
        CREATE TABLE IF NOT EXISTS facturacion_datos_cliente (
          obra TEXT PRIMARY KEY,
          razon_social TEXT,
          nif TEXT,
          direccion_fiscal TEXT,
          iva_pct REAL NOT NULL DEFAULT 21,
          retencion_pct REAL NOT NULL DEFAULT 0,
          actualizado_en TEXT NOT NULL DEFAULT (datetime('now'))
        )
    ");
    $db->exec("
        CREATE TABLE IF NOT EXISTS facturacion_linea (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          obra TEXT NOT NULL,
          concepto TEXT NOT NULL,
          presupuesto_ref TEXT,
          uds REAL NOT NULL DEFAULT 1,
          precio_unit REAL NOT NULL DEFAULT 0,
          total REAL NOT NULL DEFAULT 0,
          orden INTEGER NOT NULL DEFAULT 0,
          creado_en TEXT NOT NULL DEFAULT (datetime('now'))
        )
    ");
    $db->exec("
        CREATE TABLE IF NOT EXISTS facturacion_ronda (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          obra TEXT NOT NULL,
          numero INTEGER NOT NULL,
          tipo TEXT NOT NULL DEFAULT 'proforma',
          fecha TEXT NOT NULL,
          numero_factura TEXT,
          creado_por TEXT,
          creado_en TEXT NOT NULL DEFAULT (datetime('now'))
        )
    ");
    $db->exec("
        CREATE TABLE IF NOT EXISTS facturacion_ronda_linea (
          ronda_id INTEGER NOT NULL,
          linea_id INTEGER NOT NULL,
          uds REAL NOT NULL DEFAULT 0,
          importe REAL NOT NULL DEFAULT 0,
          PRIMARY KEY (ronda_id, linea_id)
        )
    ");
    $db->exec("
        CREATE TABLE IF NOT EXISTS facturacion_anticipo (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          obra TEXT NOT NULL,
          descripcion TEXT,
          monto REAL NOT NULL,
          fecha TEXT,
          creado_en TEXT NOT NULL DEFAULT (datetime('now'))
        )
    ");
    $db->exec("
        CREATE TABLE IF NOT EXISTS facturacion_anticipo_amortizacion (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          anticipo_id INTEGER NOT NULL,
          ronda_id INTEGER NOT NULL,
          monto REAL NOT NULL
        )
    ");

    $usuario = AuthMiddleware::usuarioActual($config['jwt']['secret']);
    AuthMiddleware::requierePermiso($usuario, 'obras.ver_aceptadas');

    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        $obra = trim((string) ($_GET['obra'] ?? ''));
        if ($obra === '') {
            Response::error('Falta "obra"', 422);
        }

        $stmtCliente = $db->prepare('SELECT * FROM facturacion_datos_cliente WHERE obra = ?');
        $stmtCliente->execute([$obra]);
        $datosCliente = $stmtCliente->fetch() ?: [
            'obra' => $obra, 'razon_social' => null, 'nif' => null, 'direccion_fiscal' => null,
            'iva_pct' => 21, 'retencion_pct' => 0,
        ];

        $stmtLineas = $db->prepare('SELECT * FROM facturacion_linea WHERE obra = ? ORDER BY orden, id');
        $stmtLineas->execute([$obra]);
        $lineas = $stmtLineas->fetchAll();

        $stmtRondas = $db->prepare('SELECT * FROM facturacion_ronda WHERE obra = ? ORDER BY numero');
        $stmtRondas->execute([$obra]);
        $rondas = $stmtRondas->fetchAll();

        $facturadoPorLinea = [];
        if ($rondas) {
            $idsRonda = array_column($rondas, 'id');
            $marcadores = implode(',', array_fill(0, count($idsRonda), '?'));
            $stmtRL = $db->prepare("SELECT * FROM facturacion_ronda_linea WHERE ronda_id IN ($marcadores)");
            $stmtRL->execute($idsRonda);
            $ronaLineasPorRonda = [];
            foreach ($stmtRL->fetchAll() as $rl) {
                $ronaLineasPorRonda[$rl['ronda_id']][] = $rl;
                $facturadoPorLinea[$rl['linea_id']] = ($facturadoPorLinea[$rl['linea_id']] ?? 0) + (float) $rl['importe'];
            }

            $stmtAmort = $db->prepare("SELECT * FROM facturacion_anticipo_amortizacion WHERE ronda_id IN ($marcadores)");
            $stmtAmort->execute($idsRonda);
            $amortizacionesPorRonda = [];
            foreach ($stmtAmort->fetchAll() as $a) {
                $amortizacionesPorRonda[$a['ronda_id']][] = $a;
            }

            foreach ($rondas as &$r) {
                $r['lineas'] = $ronaLineasPorRonda[$r['id']] ?? [];
                $r['amortizaciones'] = $amortizacionesPorRonda[$r['id']] ?? [];
            }
            unset($r);
        }

        foreach ($lineas as &$l) {
            $facturado = $facturadoPorLinea[$l['id']] ?? 0;
            $l['facturado'] = $facturado;
            $l['pendiente'] = (float) $l['total'] - $facturado;
        }
        unset($l);

        $stmtAnticipos = $db->prepare('SELECT * FROM facturacion_anticipo WHERE obra = ? ORDER BY fecha, id');
        $stmtAnticipos->execute([$obra]);
        $anticipos = $stmtAnticipos->fetchAll();

        if ($anticipos) {
            $idsAnticipo = array_column($anticipos, 'id');
            $marcadoresA = implode(',', array_fill(0, count($idsAnticipo), '?'));
            $stmtAmortA = $db->prepare("SELECT anticipo_id, SUM(monto) AS amortizado FROM facturacion_anticipo_amortizacion WHERE anticipo_id IN ($marcadoresA) GROUP BY anticipo_id");
            $stmtAmortA->execute($idsAnticipo);
            $amortizadoPorAnticipo = [];
            foreach ($stmtAmortA->fetchAll() as $a) {
                $amortizadoPorAnticipo[$a['anticipo_id']] = (float) $a['amortizado'];
            }
            foreach ($anticipos as &$a) {
                $amortizado = $amortizadoPorAnticipo[$a['id']] ?? 0;
                $a['amortizado'] = $amortizado;
                $a['saldo'] = (float) $a['monto'] - $amortizado;
            }
            unset($a);
        }

        Response::json([
            'datos_cliente' => $datosCliente,
            'lineas' => $lineas,
            'rondas' => $rondas,
            'anticipos' => $anticipos,
        ]);
    }

    if ($_SERVER['REQUEST_METHOD'] === 'PATCH') {
        $body = json_decode((string) file_get_contents('php://input'), true) ?? [];
        $accion = (string) ($body['accion'] ?? '');

        if ($accion === 'actualizar_datos_cliente') {
            $obra = trim((string) ($body['obra'] ?? ''));
            if ($obra === '') {
                Response::error('Falta "obra"', 422);
            }
            $stmtActual = $db->prepare('SELECT * FROM facturacion_datos_cliente WHERE obra = ?');
            $stmtActual->execute([$obra]);
            $actual = $stmtActual->fetch() ?: ['razon_social' => null, 'nif' => null, 'direccion_fiscal' => null, 'iva_pct' => 21, 'retencion_pct' => 0];

            $razonSocial = array_key_exists('razon_social', $body) ? trim((string) $body['razon_social']) : ($actual['razon_social'] ?? '');
            $nif = array_key_exists('nif', $body) ? trim((string) $body['nif']) : ($actual['nif'] ?? '');
            $direccionFiscal = array_key_exists('direccion_fiscal', $body) ? trim((string) $body['direccion_fiscal']) : ($actual['direccion_fiscal'] ?? '');
            $ivaPct = array_key_exists('iva_pct', $body) ? (float) $body['iva_pct'] : (float) ($actual['iva_pct'] ?? 21);
            $retencionPct = array_key_exists('retencion_pct', $body) ? (float) $body['retencion_pct'] : (float) ($actual['retencion_pct'] ?? 0);

            $db->prepare("
                INSERT INTO facturacion_datos_cliente (obra, razon_social, nif, direccion_fiscal, iva_pct, retencion_pct, actualizado_en)
                VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
                ON CONFLICT(obra) DO UPDATE SET
                    razon_social = excluded.razon_social,
                    nif = excluded.nif,
                    direccion_fiscal = excluded.direccion_fiscal,
                    iva_pct = excluded.iva_pct,
                    retencion_pct = excluded.retencion_pct,
                    actualizado_en = datetime('now')
            ")->execute([
                $obra,
                $razonSocial === '' ? null : $razonSocial,
                $nif === '' ? null : $nif,
                $direccionFiscal === '' ? null : $direccionFiscal,
                $ivaPct,
                $retencionPct,
            ]);

            Response::json(['ok' => true]);
        }

        if ($accion === 'asignar_numero_factura') {
            $rondaId = (int) ($body['ronda_id'] ?? 0);
            $numeroFactura = trim((string) ($body['numero_factura'] ?? ''));
            if ($rondaId <= 0) {
                Response::error('Falta "ronda_id"', 422);
            }
            $db->prepare('UPDATE facturacion_ronda SET numero_factura = ? WHERE id = ?')
                ->execute([$numeroFactura === '' ? null : $numeroFactura, $rondaId]);
            Response::json(['ok' => true]);
        }

        // A pedido de Álvaro (2026-09-24): "quiero que en la proforma salga
        // más detalle de las ventanas, no solo V1 sino las medidas y el
        // color" — hasta ahora una línea solo se podía borrar y volver a
        // cargar para cambiarle el concepto (arriesgado si ya se usó en
        // alguna ronda: eliminar_linea lo bloquea a propósito). Esta acción
        // edita en el lugar sin tocar el id, así que las rondas ya creadas
        // que la referencian no se rompen — recalcula "total" si cambian
        // uds/precio_unit.
        if ($accion === 'editar_linea') {
            $id = (int) ($body['id'] ?? 0);
            if ($id <= 0) {
                Response::error('Falta "id"', 422);
            }
            $stmtActual = $db->prepare('SELECT * FROM facturacion_linea WHERE id = ?');
            $stmtActual->execute([$id]);
            $actual = $stmtActual->fetch();
            if (!$actual) {
                Response::error('Línea no encontrada', 404);
            }

            $concepto = array_key_exists('concepto', $body) ? trim((string) $body['concepto']) : $actual['concepto'];
            $presupuestoRef = array_key_exists('presupuesto_ref', $body) ? trim((string) $body['presupuesto_ref']) : ($actual['presupuesto_ref'] ?? '');
            $uds = array_key_exists('uds', $body) ? (float) $body['uds'] : (float) $actual['uds'];
            $precioUnit = array_key_exists('precio_unit', $body) ? (float) $body['precio_unit'] : (float) $actual['precio_unit'];
            if ($concepto === '') {
                Response::error('"concepto" no puede quedar vacío', 422);
            }
            $total = $uds * $precioUnit;

            $db->prepare('UPDATE facturacion_linea SET concepto = ?, presupuesto_ref = ?, uds = ?, precio_unit = ?, total = ? WHERE id = ?')
                ->execute([$concepto, $presupuestoRef === '' ? null : $presupuestoRef, $uds, $precioUnit, $total, $id]);

            Response::json(['ok' => true]);
        }

        Response::error('Acción no reconocida', 422);
    }

    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $body = json_decode((string) file_get_contents('php://input'), true) ?? [];
        $accion = (string) ($body['accion'] ?? '');

        if ($accion === 'agregar_linea') {
            $obra = trim((string) ($body['obra'] ?? ''));
            $concepto = trim((string) ($body['concepto'] ?? ''));
            if ($obra === '' || $concepto === '') {
                Response::error('Faltan "obra" y/o "concepto"', 422);
            }
            $uds = (float) ($body['uds'] ?? 1);
            $precioUnit = (float) ($body['precio_unit'] ?? 0);
            $presupuestoRef = trim((string) ($body['presupuesto_ref'] ?? ''));
            $total = $uds * $precioUnit;

            $stmtOrden = $db->prepare('SELECT COALESCE(MAX(orden), 0) + 1 AS siguiente FROM facturacion_linea WHERE obra = ?');
            $stmtOrden->execute([$obra]);
            $orden = (int) $stmtOrden->fetch()['siguiente'];

            $db->prepare('INSERT INTO facturacion_linea (obra, concepto, presupuesto_ref, uds, precio_unit, total, orden) VALUES (?, ?, ?, ?, ?, ?, ?)')
                ->execute([$obra, $concepto, $presupuestoRef === '' ? null : $presupuestoRef, $uds, $precioUnit, $total, $orden]);

            $id = (int) $db->lastInsertId();
            $stmt = $db->prepare('SELECT * FROM facturacion_linea WHERE id = ?');
            $stmt->execute([$id]);
            $linea = $stmt->fetch();
            $linea['facturado'] = 0;
            $linea['pendiente'] = $total;

            Response::json(['linea' => $linea]);
        }

        if ($accion === 'agregar_anticipo') {
            $obra = trim((string) ($body['obra'] ?? ''));
            $monto = (float) ($body['monto'] ?? 0);
            if ($obra === '' || $monto <= 0) {
                Response::error('Faltan "obra" y/o "monto" (debe ser mayor a 0)', 422);
            }
            $descripcion = trim((string) ($body['descripcion'] ?? ''));
            $fecha = trim((string) ($body['fecha'] ?? ''));
            if ($fecha !== '' && !preg_match('/^\d{4}-\d{2}-\d{2}$/', $fecha)) {
                Response::error('"fecha" debe tener formato AAAA-MM-DD', 422);
            }

            $db->prepare('INSERT INTO facturacion_anticipo (obra, descripcion, monto, fecha) VALUES (?, ?, ?, ?)')
                ->execute([$obra, $descripcion === '' ? null : $descripcion, $monto, $fecha === '' ? null : $fecha]);

            $id = (int) $db->lastInsertId();
            $stmt = $db->prepare('SELECT * FROM facturacion_anticipo WHERE id = ?');
            $stmt->execute([$id]);
            $anticipo = $stmt->fetch();
            $anticipo['amortizado'] = 0;
            $anticipo['saldo'] = $monto;

            Response::json(['anticipo' => $anticipo]);
        }

        if ($accion === 'crear_ronda') {
            $obra = trim((string) ($body['obra'] ?? ''));
            $tipo = trim((string) ($body['tipo'] ?? ''));
            $fecha = trim((string) ($body['fecha'] ?? ''));
            $lineasRonda = $body['lineas'] ?? [];
            if ($obra === '' || !in_array($tipo, TIPOS_RONDA_VALIDOS, true) || $fecha === '' || !is_array($lineasRonda) || count($lineasRonda) === 0) {
                Response::error('Faltan "obra", "tipo" (proforma|factura), "fecha" y/o "lineas" (al menos una)', 422);
            }
            if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $fecha)) {
                Response::error('"fecha" debe tener formato AAAA-MM-DD', 422);
            }

            $amortizaciones = $body['amortizaciones'] ?? [];
            if (!is_array($amortizaciones)) {
                $amortizaciones = [];
            }
            // Valida ANTES de escribir nada: ninguna amortización puede
            // superar el saldo actual de su anticipo.
            foreach ($amortizaciones as $am) {
                $anticipoId = (int) ($am['anticipo_id'] ?? 0);
                $monto = (float) ($am['monto'] ?? 0);
                if ($anticipoId <= 0 || $monto <= 0) {
                    continue;
                }
                $stmtAnt = $db->prepare('SELECT monto FROM facturacion_anticipo WHERE id = ? AND obra = ?');
                $stmtAnt->execute([$anticipoId, $obra]);
                $anticipo = $stmtAnt->fetch();
                if (!$anticipo) {
                    Response::error("El anticipo #$anticipoId no existe en esta obra", 422);
                }
                $stmtAmortizado = $db->prepare('SELECT COALESCE(SUM(monto), 0) AS total FROM facturacion_anticipo_amortizacion WHERE anticipo_id = ?');
                $stmtAmortizado->execute([$anticipoId]);
                $yaAmortizado = (float) $stmtAmortizado->fetch()['total'];
                $saldo = (float) $anticipo['monto'] - $yaAmortizado;
                if ($monto > $saldo + 0.01) {
                    Response::error("La amortización de $monto € supera el saldo pendiente del anticipo #$anticipoId ($saldo €)", 422);
                }
            }

            $stmtNumero = $db->prepare('SELECT COALESCE(MAX(numero), 0) + 1 AS siguiente FROM facturacion_ronda WHERE obra = ?');
            $stmtNumero->execute([$obra]);
            $numero = (int) $stmtNumero->fetch()['siguiente'];

            $numeroFactura = trim((string) ($body['numero_factura'] ?? ''));

            $db->prepare('INSERT INTO facturacion_ronda (obra, numero, tipo, fecha, numero_factura, creado_por) VALUES (?, ?, ?, ?, ?, ?)')
                ->execute([$obra, $numero, $tipo, $fecha, $numeroFactura === '' ? null : $numeroFactura, $usuario['nombre'] ?? null]);
            $rondaId = (int) $db->lastInsertId();

            $stmtInsLinea = $db->prepare('INSERT INTO facturacion_ronda_linea (ronda_id, linea_id, uds, importe) VALUES (?, ?, ?, ?)');
            foreach ($lineasRonda as $lr) {
                $lineaId = (int) ($lr['linea_id'] ?? 0);
                $uds = (float) ($lr['uds'] ?? 0);
                $importe = (float) ($lr['importe'] ?? 0);
                if ($lineaId <= 0 || $importe == 0) {
                    continue;
                }
                $stmtInsLinea->execute([$rondaId, $lineaId, $uds, $importe]);
            }

            $stmtInsAmort = $db->prepare('INSERT INTO facturacion_anticipo_amortizacion (anticipo_id, ronda_id, monto) VALUES (?, ?, ?)');
            foreach ($amortizaciones as $am) {
                $anticipoId = (int) ($am['anticipo_id'] ?? 0);
                $monto = (float) ($am['monto'] ?? 0);
                if ($anticipoId <= 0 || $monto <= 0) {
                    continue;
                }
                $stmtInsAmort->execute([$anticipoId, $rondaId, $monto]);
            }

            $stmt = $db->prepare('SELECT * FROM facturacion_ronda WHERE id = ?');
            $stmt->execute([$rondaId]);
            Response::json(['ronda' => $stmt->fetch()]);
        }

        Response::error('Acción no reconocida', 422);
    }

    if ($_SERVER['REQUEST_METHOD'] === 'DELETE') {
        $body = json_decode((string) file_get_contents('php://input'), true) ?? [];
        $accion = (string) ($body['accion'] ?? '');
        $id = (int) ($body['id'] ?? 0);
        if ($id <= 0) {
            Response::error('Falta "id"', 422);
        }

        if ($accion === 'eliminar_linea') {
            $stmtUsada = $db->prepare('SELECT COUNT(*) AS c FROM facturacion_ronda_linea WHERE linea_id = ?');
            $stmtUsada->execute([$id]);
            if ((int) $stmtUsada->fetch()['c'] > 0) {
                Response::error('Esta línea ya se usó en una ronda de facturación, no se puede borrar', 422);
            }
            $db->prepare('DELETE FROM facturacion_linea WHERE id = ?')->execute([$id]);
            Response::json(['ok' => true]);
        }

        if ($accion === 'eliminar_ronda') {
            $db->prepare('DELETE FROM facturacion_ronda_linea WHERE ronda_id = ?')->execute([$id]);
            $db->prepare('DELETE FROM facturacion_anticipo_amortizacion WHERE ronda_id = ?')->execute([$id]);
            $db->prepare('DELETE FROM facturacion_ronda WHERE id = ?')->execute([$id]);
            Response::json(['ok' => true]);
        }

        Response::error('Acción no reconocida', 422);
    }

    Response::error('Método no permitido', 405);
} catch (Throwable $e) {
    Response::error(get_class($e) . ': ' . $e->getMessage(), 500);
}
