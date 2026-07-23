<?php
declare(strict_types=1);

$config = require __DIR__ . '/../../backend/bootstrap.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    Response::error('Método no permitido', 405);
}

$refreshToken = $_COOKIE['refresh_token'] ?? '';
if ($refreshToken !== '') {
    $db = Database::connection($config);
    (new AuthService($db, $config))->logout($refreshToken);
}

setcookie('refresh_token', '', ['expires' => time() - 3600, 'path' => '/api/']);
Response::json(['ok' => true]);
