# Назначение верхних категорий Medusa

`assign-medusa-top-categories.mjs` безопасно назначает всем товарам одну из девяти закреплённых верхних категорий сайта. Товары без записи в mapping получают категорию `Другие`.

Скрипт не использует названия товаров, штрихкоды или нечёткий поиск. Допустимо только точное совпадение UUID с `metadata.ware_id` и единственным SKU. Единственный fallback — уникальный SKU у товара с пустым `ware_id`.

## Формат mapping

```json
{
  "036831EA-D7C1-4DB1-B9D4-D9BA3868EF1E": "lekarstva-i-bady",
  "5EDD4858-66E0-461F-8A1E-48E1383D242A": "mama-i-malysh"
}
```

Канонические `targetKey`:

- `bady`
- `gigiyena`
- `kosmetika`
- `lekarstva-i-bady`
- `linzy`
- `mama-i-malysh`
- `med-pribory-i-izdeliya`
- `sport-i-fitnes`
- `intim`
- `drugoe`

## Обязательный dry-run

Секреты передаются только через окружение и не записываются в отчёты:

```powershell
$env:MEDUSA_URL = "https://medusa.example.kz"
$env:MEDUSA_ADMIN_EMAIL = "admin@example.kz"
$env:MEDUSA_ADMIN_PASSWORD = Read-Host -MaskInput
npm run catalog:categories:assign -- --mapping ".\ware-category-map.json"
```

Dry-run авторизуется, читает все 27 975 товаров и полное дерево категорий, проверяет закреплённые ID/handle, затем создаёт:

- неизменяемый JSONL snapshot текущих связей товаров и категорий;
- файл `<snapshot>.sha256`;
- JSON-отчёт с покрытием mapping и планом;
- resumable JSONL-журнал.

Запросов записи в dry-run нет. Если `Другие` отсутствует, dry-run только отмечает необходимость её создания.

## Canary из 10 товаров

После проверки отчёта запустите отдельный canary. Желательно продолжить dry-run журнал через `--resume`, чтобы mapping SHA-256 был проверен:

```powershell
npm run catalog:categories:assign -- --mapping ".\ware-category-map.json" --apply --resume ".\medusa-top-categories-journal-DRY-RUN.jsonl"
```

До первого удалённого изменения скрипт создаёт новый snapshot и резервирует отчёт. Если категории `Другие` ещё нет, она создаётся под закреплённым root `site` только после snapshot. Canary работает последовательно, PATCH проверяется повторным GET.

## Полное продолжение

Полный режим разрешён только после события `canary_completed` в том же журнале:

```powershell
npm run catalog:categories:assign -- --mapping ".\ware-category-map.json" --apply --full --resume ".\medusa-top-categories-journal-DRY-RUN.jsonl"
```

Полная обработка использует не более двух одновременных запросов. Успешные изменения журналируются и при повторном запуске проверяются по текущему состоянию Medusa. При первой ошибке новые задачи не запускаются; продолжение выполняется той же командой с `--resume`.

## Правило сохранения дерева

Для выбранной верхней категории сохраняются только уже назначенные категории, являющиеся её потомками. Категории из других верхних веток удаляются. Итог всегда содержит root `site`, выбранную верхнюю категорию и допустимых потомков.

Удалять snapshot и журнал до завершения проверки нельзя. В них нет паролей или JWT, но есть идентификаторы каталога, поэтому хранить их следует как служебные данные.
