# Импорт изображений SKU в Medusa

Скрипт `import-sku-images.mjs` безопасно связывает изображения из распакованной папки `sku_images` с товарами Medusa. По умолчанию он выполняет только анализ (`dry-run`) и ничего не меняет на бэкенде.

## Правило сопоставления

Изображение допускается к загрузке только при одновременном выполнении всех условий:

1. Имя файла без расширения — канонический UUID.
2. UUID после нормализации регистра в точности равен `product.metadata.ware_id`.
3. Тот же UUID в точности равен SKU ровно одного варианта во всём каталоге.
4. Найденные `ware_id` и SKU принадлежат одному товару. Единственное безопасное исключение: если `metadata.ware_id` у этого товара строго пуст, разрешается уникальный SKU с отметкой `mapping_source=unique_variant_sku_fallback`.
5. У товара ещё нет ни `thumbnail`, ни элементов в `images`.
6. Файл — корректный JPEG/PNG размером не более 5 MiB.

Нечёткое сопоставление не применяется. Непустой `ware_id`, отличный от UUID файла/SKU, никогда не заменяется fallback-правилом. Несовпадения, неоднозначные дубли, неправильные сигнатуры и лишние файлы отмечаются как `quarantined` в JSONL-манифесте; исходные файлы не перемещаются и не удаляются.

## Требования

- Node.js 20 или новее.
- Распакованная папка с изображениями.
- Переменные окружения `MEDUSA_URL`, `MEDUSA_ADMIN_EMAIL`, `MEDUSA_ADMIN_PASSWORD`.
- У административного пользователя должны быть права чтения/обновления товаров и загрузки файлов.

Секреты берутся только из окружения и не записываются в манифест или консоль.

## 1. Обязательный dry-run

PowerShell:

```powershell
$env:MEDUSA_URL = "https://medusa.example.kz"
$env:MEDUSA_ADMIN_EMAIL = "admin@example.kz"
$env:MEDUSA_ADMIN_PASSWORD = Read-Host -AsSecureString | ConvertFrom-SecureString -AsPlainText
node scripts/import-sku-images.mjs --images-dir "C:\work\sku_images" --manifest ".\sku-images-dry-run.jsonl"
```

Без флага `--apply` запросы к Medusa только читающие. Итоговая строка `run_completed` содержит сводку, а каждая предыдущая строка объясняет судьбу конкретного файла.

Перед применением проверьте как минимум:

- `eligible` — ожидаемое количество строгих совпадений;
- `quarantine_reasons` — причины отклонения;
- `skipped_existing_media` — товары, которые скрипт не будет перезаписывать;
- отсутствие неожиданных `ambiguous_*` и `*_mismatch`.

## 2. Canary на нескольких товарах

Сначала загрузите не более пяти подтверждённых изображений:

```powershell
node scripts/import-sku-images.mjs --images-dir "C:\work\sku_images" --apply --limit 5 --manifest ".\sku-images-apply.jsonl"
```

После команды вручную проверьте эти товары в Medusa Admin и storefront. Скрипт загружает файлы по одному, дедуплицирует одинаковое содержимое по SHA-256, обновляет максимум два товара одновременно и проверяет результат повторным GET-запросом.

## 3. Продолжение после canary или сбоя

Для возобновления используйте тот же журнал:

```powershell
node scripts/import-sku-images.mjs --images-dir "C:\work\sku_images" --apply --resume ".\sku-images-apply.jsonl"
```

Успешные загрузки повторно не отправляются: URL восстанавливается из событий `upload_succeeded`. Товары с событием `product_update_succeeded` пропускаются. Дополнительно скрипт заново читает каталог и не трогает карточки, в которых уже появились изображения.

Код завершения `2` означает, что часть загрузок или обновлений завершилась ошибкой; детали находятся в событиях `upload_failed`/`product_update_failed`. Код `1` — фатальная ошибка до штатного завершения.

## Формат манифеста

Манифест — append-only JSONL. Основные события:

- `run_started`, `catalogue_loaded`, `run_completed`;
- `image_classified` со статусами `eligible`, `quarantined`, `skipped_existing_media`, `skipped_limit`;
- `upload_started`, `upload_succeeded`, `upload_failed`, `upload_reused`;
- `product_update_started`, `product_update_succeeded`, `product_update_failed`.

Не редактируйте журнал между запусками. Сохраните его вместе с внешней резервной копией соответствий товаров до завершения импорта.
