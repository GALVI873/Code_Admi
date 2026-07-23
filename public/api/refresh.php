<?php
declare(strict_types=1);

$config = require __DIR__ . '/../../backend/bootstrap.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    Response::error('Método no permitido', 405);
}

$refreshToken = $_COOKIE['refresh_token'] ?? '';
if ($refreshToken === '') {
    Response::error('Falta refresh token', 401);
}

$db = Database::connection($config);
$auth = new AuthService($db, $config);

try {
    $resultado = $auth->refresh($refreshToken);
} catch (RuntimeException $e) {
    Response::error($e->getMessage(), $e->getCode() ?: 401);
}

setcookie('refresh_token', $resultado['refresh_token'], [
    'expires' => time() + $config['jwt']['refresh_ttl'],
    'path' => '/api/',
    'secure' => true,
    'httponly' => true,
    'samesite' => 'Strict',
]);

Response::json(['access_token' => $resultado['access_token']]);
