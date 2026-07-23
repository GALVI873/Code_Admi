<?php
declare(strict_types=1);

$config = require __DIR__ . '/../../backend/bootstrap.php';

$usuario = AuthMiddleware::usuarioActual($config['jwt']['secret']);

Response::json(['usuario' => $usuario]);
