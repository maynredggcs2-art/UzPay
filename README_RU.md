# UzPay — подключение к Render PostgreSQL

## Важно
- `index.html` не подключается к PostgreSQL напрямую. База подключается только сервером `server.js`.
- Пароль БД храните только в Render Environment Variables, никогда не вставляйте его в HTML или GitHub. Поскольку строка подключения уже была отправлена в чат, смените пароль/создайте новые credentials в Render, если это действующий пароль.
- В `index.html` оставлен маркер `https://YOUR-RENDER-SERVICE.onrender.com`. После публикации API замените его на URL своего Render Web Service.

## Android + Render
1. Загрузите содержимое папки проекта в GitHub: `index.html`, `server.js`, `package.json`.
2. Render → New + → PostgreSQL. Создайте БД в том же регионе, что и Web Service.
3. Render → New + → Web Service → подключите репозиторий. Runtime: Node. Build Command: `npm install`; Start Command: `npm start`.
4. В Environment добавьте `DATABASE_URL` = Internal Database URL из Render PostgreSQL и `ADMIN_PASSWORD` = новый длинный пароль для админ-панели. Не добавляйте эти секреты в GitHub.
5. После Deploy откройте `https://ВАШ-СЕРВИС.onrender.com/health`. Ожидаемый ответ: `{"ok":true,"service":"UzPay API","database":"connected"}`.
6. Откройте `index.html` в GitHub, нажмите Edit и замените `https://YOUR-RENDER-SERVICE.onrender.com` на URL сервиса из Render. Сохраните. Перезагрузите Mini App.
7. Админ-пароль в интерфейсе должен совпадать с `ADMIN_PASSWORD` в Render Environment.

## Что хранится
Данные пользователей, хеши паролей, сессии, настройки, заказы, баланс и инвентарь хранятся в JSONB-строке PostgreSQL. Пароли пользователей хешируются на сервере.

## Ограничения этой первой версии
API поддерживает регистрацию/вход, синхронизацию профиля, создание заказов, админ-заказы/пользователей/настройки/баланс и операции с инвентарём. Игровые API пока возвращают `game_unavailable`; игры требуют отдельной серверной реализации. Проверка платежа и автоматическая доставка Telegram Stars/Premium/Gifts не реализованы — подтверждение заказа администратором не означает реальный платёж. Перед реальным использованием добавьте Telegram WebApp initData verification, rate limiting, CSRF/origin restrictions и безопасную платёжную интеграцию.
