# Сайт «Аптека со склада»

Репозиторий production-версии интернет-магазина АСС.

Поддерживаемая среда для сборки и тестов — Node.js 24.

## Обязательная проверка перед выкладкой

```bash
npm ci
npm test
npm run lint
npm run build
```

CI выполняет те же проверки для каждого pull request и каждого обновления ветки `main`.
Для каждого исправления сначала добавляется регрессионный тест. Секреты и production-настройки хранятся только на сервере и никогда не добавляются в Git.

## Заказы для выдачи на кассе ePharm

Сайт сохраняет коммерческие заказы с любым доступным способом доставки и оплаты.
В кассовую очередь ePharm передаются только заказы с явно выбранными самовывозом
и наличными; курьерские, оплаченные онлайн и демонстрационные заказы без расчёта
не являются заданиями на выдачу фармацевту. Правило проверяется при создании
outbox-события и повторно перед отправкой. Ранее накопленные неподходящие события
получают терминальный статус `skipped`, а уже отправленные заказы скрываются
сервером ePharm от кассового интерфейса без удаления истории.

## Переключение каталога Daribar

Каталог переключается одним серверным feature flag без изменения данных:

```dotenv
# Текущий безопасный режим: клиент видит Medusa, сравнение выполняется фоном.
STOREFRONT_CATALOG_PROVIDER=shadow

# После приёмки теневого отчёта:
# STOREFRONT_CATALOG_PROVIDER=daribar
DARIBAR_ENABLED=true
DARIBAR_CATALOG_ENABLED=true
DARIBAR_ORDER_ENABLED=true
DARIBAR_CATALOG_READ_SOURCE=postgres
DARIBAR_CATALOG_SNAPSHOT_PATH=/var/www/inkar-shop/shared/data/daribar-catalog.snapshot.json
TYPESENSE_URL=http://127.0.0.1:8108
TYPESENSE_COLLECTION=daribar-products
# TYPESENSE_SEARCH_API_KEY и TYPESENSE_ADMIN_API_KEY задаются только на сервере.
```

Откат storefront: вернуть `STOREFRONT_CATALOG_PROVIDER=medusa` и перезапустить
приложение. Откат последнего снимка данных: `npm run catalog:daribar:rollback`.

Полный атомарный цикл выполняет `npm run catalog:daribar:stack`:

1. загружает и атомарно переименовывает полный снимок Daribar;
2. строит новую версию коллекции Typesense и переключает alias после проверки;
3. нормализует данные в PostgreSQL и одной транзакцией меняет `active_run_id`;
4. сохраняет предыдущий run для немедленного отката.

`deploy/systemd/inkar-shop-daribar-sync.timer` запускает этот цикл ежедневно.
`deploy/systemd/inkar-shop-catalog-shadow.timer` записывает сравнение Medusa и
Daribar в `catalog_shadow_reports`.
`deploy/systemd/typesense-server.service` поднимает локальный Typesense только
на `127.0.0.1:8108`; ключ администратора берётся из серверного env-файла.

До включения Daribar нужно применить миграции (`npm run db:migrate`), запустить
первую синхронизацию и проверить хост командой `npm run infra:capacity`.
Production-профиль: не менее 8 CPU, 16 ГБ RAM и 300 ГБ SSD. Скрипт также
блокирует приёмку хоста при недостаточном свободном месте.

Корзины разных провайдеров хранятся раздельно. Daribar-корзина содержит native
SKU в product/variant ID; перед оформлением `/api/cart/availability` и quote
делают одну live v3-проверку всей корзины в одной аптеке. Создание заказа,
`payment_url`, локальная запись и обновление статуса используют один
`providerOrderId` Daribar.
