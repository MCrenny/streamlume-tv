# Как запустить StreamLume TV внутри Media Station X — Полная документация

**Дата:** 28.06.2026
**Результат:** Приложение StreamLume TV (React Native Web) полностью загружается внутри MSX как единое целое со всеми каналами, категориями и логикой.

---

## Архитектура решения

```
Пользователь вводит домен в MSX
         ↓
MSX запрашивает https://streamlume-tv-svmorozoww.amvera.io/
         ↓
Сервер отдаёт JSON (start-параметр с content: prefix)
         ↓
MSX запрашивает /msx/launch?v=2
         ↓
Сервер отдаёт страницу с кнопкой "Открыть приложение"
         ↓
Пользователь нажимает OK -> MSX показывает Link Validation -> Continue
         ↓
MSX открывает index.html?msx=1 через link: action (полный экран)
         ↓
React Native Web приложение загружается ЦЕЛИКОМ
```

---

## Ключевые правила MSX (нельзя нарушать)

1. Поле Start Parameter в настройках MSX принимает только menu:URL или content:URL.
   Голый домен без префикса — ошибка "Invalid start parameter".

2. link:URL — единственный способ открыть внешнее веб-приложение на весь экран.
   Через interaction:load: или execute: приложение уходит ПОД интерфейс MSX.

3. link: нельзя использовать как start parameter — только как action внутри элемента.

4. MSX агрессивно кэширует JSON-файлы. При любом изменении менять URL (?v=N).

5. type: "plugin" в start.json — формат MSX App Store, не для start parameter.

---

## Что вводить в MSX Settings

В поле Start Parameter Setup вводить:
  streamlume-tv-svmorozoww.amvera.io

(без префиксов, слешей и http)
Если MSX не принимает — вводить:
  content:streamlume-tv-svmorozoww.amvera.io

---

## Файл msx/start.json

{
  "name": "StreamLume",
  "version": "1.0",
  "parameter": "content:https://streamlume-tv-svmorozoww.amvera.io/msx/launch?v=2"
}

---

## Роуты в server.js

GET / — отдаёт start JSON с полем parameter (content: prefix)
GET /msx/launch — отдаёт страницу MSX с кнопкой link: на index.html
GET /* — статика (React бандл) + fallback на index.html

---

## index.html — что добавлено в <head>

1. Перехватчик ошибок window.onerror (показывает краши на экране ТВ)
2. Полифилл globalThis (для Chrome < 71)
3. Полифилл queueMicrotask (для Chrome < 71)
4. MSX Plugin SDK: https://msx.benzac.de/js/tvx-plugin.min.js
5. ResizeObserver полифилл с CDN
6. Кастомный драйвер пульта (2-в-1)

---

## Кастомный драйвер пульта — ключевые детали

- Включается при нажатии стрелки (isTvMode = true)
- Отключается при касании экрана или мыши (isTvMode = false)
- Стрелки: ищет геометрически ближайший элемент в нужном направлении
- OK/Enter: симулирует touchstart + touchend + click

КРИТИЧЕСКИЙ БАГ (исправлен):
Перед forEach нужно кэшировать: var target = currentFocus;
Иначе disableTvMode() обнуляет currentFocus в середине цикла →
TypeError: Cannot read properties of null (reading dispatchEvent)

---

## Что НЕ работает (ловушки)

- type: "plugin" в start.json — формат App Store, не работает как start parameter
- link:URL как start parameter — MSX требует menu: или content:
- "ready": "link:..." в content JSON — не поддерживается, content not valid
- layout: "0,0,12,8" для кнопки — слишком большая высота, no selectable items
- color: "msx-blue" в item — недопустимый цвет, no selectable items
- Готовые spatial navigation библиотеки — конфликтуют с React Native Web

---

## Как обновить приложение в будущем

1. Скопировать новый _expo/static/js/web/index-HASH.js в e:\streamlume-tv\_expo\static\js\web\
2. Обновить имя файла в index.html (строка <script src="..."> в конце body)
3. git add . && git commit -m "update bundle" && git push amvera main:master
4. Подождать 2-3 минуты пока Amvera пересоберёт контейнер
