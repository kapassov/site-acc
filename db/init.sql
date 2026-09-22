-- Таблица общего витринного контента (баннеры, быстрые ссылки, сторис, подборки…).
-- Приложение создаёт её само при первом запуске; этот файл — для ручной инициализации
-- или применения в общей базе Medusa.
CREATE TABLE IF NOT EXISTS cms_content (
    id         int PRIMARY KEY DEFAULT 1,
    data       jsonb       NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT cms_singleton CHECK (id = 1)
);
