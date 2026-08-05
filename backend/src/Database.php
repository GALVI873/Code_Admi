<?php
declare(strict_types=1);

final class Database
{
    private static ?PDO $instance = null;

    public static function connection(array $config): PDO
    {
        if (self::$instance === null) {
            $dsn = 'sqlite:' . $config['db']['path'];
            self::$instance = new PDO($dsn, null, null, [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            ]);
            self::$instance->exec('PRAGMA foreign_keys = ON;');
        }
        return self::$instance;
    }
}
