# ОГЭ-тренажер (офлайн) — этап 3

Локальная офлайн-система подготовки к ОГЭ (9 -> 10 класс) без сервера, npm, сборщика и внешних библиотек.

## Запуск
1. Откройте папку проекта.
2. Откройте `index.html` в браузере.
3. Всё работает локально, интернет не требуется.

По умолчанию в сборку уже встроен официальный пакет ФИПИ по доступным годам на странице ФИПИ для 4 предметов:
- русский язык
- математика
- физика
- английский язык
- годы: 2022–2026 (плюс дополнительно доступный архив по физике 2016).

## Архитектура после этапа 3
- `index.html`
  - только структура экранов и подключение модулей.
- `styles.css`
  - весь UI-стиль, адаптив, карточки, таблицы, onboarding.
- `questionBank.js`
  - банк вопросов, генератор 15 вариантов, blueprint engine, content coverage map, bank validator.
- `assessmentEngine.js`
  - рендеринг и проверка всех типов заданий.
- `planningEngine.js`
  - маршруты подготовки, рекомендации, readiness score, родительская сводка.
- `app.js`
  - UI orchestration, режимы, сессии, таймер, аналитика, import/export, resume.

## Поддерживаемые режимы
1. `Тренировка по темам`
- выбор предмета/сегмента/сложности/количества.

2. `Работа над ошибками`
- приоритет слабых тем и задач с ошибками;
- быстрые доработки: `Объяснить подробнее`, `Показать правило`, `Показать похожий пример`, `Закрепить ещё 3`.

3. `Экзамен`
- `Смешанный экзамен-тренажер`.
- `Точный экзаменационный макет`.
- `Экзаменационная тренировка`.
- В `Точный экзаменационный макет` параметры фиксируются автоматически по `subject blueprint`:
  - количество заданий,
  - лимит времени,
  - блочная структура,
  - допустимые форматы заданий.
- Поля количества вопросов и времени в exact-режиме блокируются и не зависят от ручного ввода.

## Subject blueprint engine
Blueprint теперь хранит:
- блочную структуру предмета;
- допустимые типы задач по блокам;
- обязательные элементы покрытия;
- политику порядка задач (`fixed-by-block` / `balanced-randomized`);
- тайминг и предупреждения;
- правила отображения результата;
- пометки про учебную самопроверку для развернутых форматов.

Ключевые API:
- `ExamData.getSubjectBlueprint(subjectKey, modelKey)`
- `ExamData.getExamByBlueprint(subjectKey, { modelKey, seedVariant, questionCount })`
- `ExamData.createVariantId(subjectKey, variant, modelKey, questionCount)`
- `ExamData.listStableVariants(subjectKey, options)`

## 15 воспроизводимых вариантов
Для каждого предмета доступны варианты `1..15`.

Свойства:
- стабильный seed;
- стабильный `variantId`;
- воспроизводимость;
- возможность `пересобрать` (очистить кеш и собрать заново из того же seed).

## Форматы заданий (`question.type`)
1. `single-choice`
2. `multi-choice`
3. `short-text`
4. `numeric-input`
5. `sequence-order`
6. `matching`
7. `fill-in-the-blank`
8. `extended-answer-lite`

Для каждого формата реализованы:
- отдельный рендеринг;
- отдельный валидатор ответа;
- scoring;
- корректная запись в историю попыток.

## Ограничения автоматической проверки
Развернутые/письменные/коммуникативные задания в офлайн-режиме проверяются как:
- `учебная самопроверка`;
- `ориентировочная оценка`;
- сверка по чек-листу и образцу сильного ответа.

Это не полная официальная экспертная проверка ФИПИ.

## Content coverage map
Карта покрытия отображает:
- раздел/тему/подтему;
- количество вопросов;
- сложность;
- типы и форматы;
- `examBlueprintTag`;
- статус покрытия: `нет / слабое / достаточное / сильное`.

Экран: `Покрытие программы`.

API:
- `ExamData.getContentCoverageMap(subjectKey)`

## Усиленный валидатор банка
`ExamData.validateQuestionBank()` теперь возвращает:
- `errors`
- `warnings`
- `coverageGaps`
- `weakCoverage`
- `lowDifficultyDiversity`
- `missingExplanationFields`
- `duplicateCandidates`
- `nearDuplicateCandidates`
- `explanationQuality` (strong/medium/weak + average)

В UI:
- кнопка `Запустить диагностику банка (dev/debug)`.

Дополнительно включена защита от дублей:
- при нормализации вопроса автоматически удаляются дублирующиеся варианты ответа (включая "скрытые" числовые/регистровые дубли);
- сигнатура вопроса сравнивается по нормализованной форме (не зависит от перестановки опций), поэтому один и тот же вопрос не должен попадать в сессию повторно;
- при запуске сессии список вопросов дополнительно санитизируется, а недостающие позиции дозаполняются уникальными вопросами из пула предмета.

## Explanation quality score
Для каждого вопроса оценивается полнота explanation-блока:
- `why`
- `stepByStep`
- `rule`
- `formula`
- `commonMistakes`
- `recognitionTip`
- для `extended-answer-lite`: наличие `strongSample`.

В диагностике показывается распределение `strong / medium / weak`.

## Аналитика: ученик и родитель
### Контур ученика
Экран `Мой прогресс`:
- общая статистика;
- прогресс по предметам;
- слабые темы;
- сравнение вариантов 1–15;
- последние сессии.

### Контур родителя
Экран `Отчёт`:
- предметная готовность;
- покрытие тем;
- слабые и “застарелые” темы;
- динамика;
- локальная итоговая сводка.

## Readiness score
Readiness рассчитывается как `оценка готовности тренажера` (не официальный прогноз ОГЭ) и учитывает:
- точность;
- покрытие тем;
- стабильность последних сессий;
- работу со сложными заданиями;
- покрытие форматов, релевантных только выбранному предмету (по его blueprint, без штрафа за нерелевантные типы);
- свежесть практики.

API:
- `PlanningEngine.computeReadiness(...)`

## Weekly analytics
Недельная аналитика считается по ISO-неделям (`YYYY-Www`), а не по упрощенной разбивке внутри месяца.
Это устраняет искажения на границах месяцев.

## Предметные усиления (4 предмета)
- `Русский язык`:
  - добавлены связные текстовые задания (несколько форматов по одному фрагменту),
  - расширены `short-text`, `fill-in-the-blank`, `matching`, `extended-answer-lite`.
- `Математика`:
  - увеличена доля `numeric-input`,
  - добавлены задания с короткой записью ответа и развернутым объяснением хода решения (`extended-answer-lite`).
- `Физика`:
  - добавлены `experimental-lite` сценарии: таблицы, графические выводы, числовой расчет по данным, развернутый вывод по эксперименту.
- `Английский язык`:
  - добавлены `listening-lite` задания с локальным audio/mock fallback,
  - `speaking-lite` карточки с таймером подготовки/ответа,
  - `writing-lite` с ожидаемой структурой, ключевыми пунктами и образцом ответа.

## Маршруты подготовки
Поддерживаются 5 сценариев:
1. `До экзамена далеко`
2. `Плановая подготовка`
3. `Интенсив за 4 недели`
4. `Интенсив за 2 недели`
5. `Повторение перед экзаменом`

Экран `Что делать дальше` формирует рекомендации на основе:
- weak topics;
- coverage gaps;
- устаревших тем;
- недоработанных форматов;
- текущей readiness.

## Import / Export / Backup
Реализовано локально:
- `Экспорт JSON` (stats + sessions + weak topics + routes + readiness snapshots + resume);
- `Импорт JSON` с проверкой версии backup;
- `Экспорт HTML-отчёта` для печати/отправки.

Также поддержан импорт официального банка (без отдельного режима):
- JSON с `type: "oge-official-bank-pack"` можно импортировать через ту же кнопку `Импорт JSON`;
- вопросы автоматически вливаются в общий банк и участвуют во всех режимах (тренировка/ошибки/экзамен);
- при наличии официального пакета генератор использует официальный пул как приоритетный;
- в диагностике отображается количество официальных вопросов, годы и `FIPI alignment`.
- заготовка формата лежит в файле `official-pack-template.json`.
- в проекте есть автосгенерированный пакет: `data/fipi_official_pack.auto.json` и `officialPackData.js`.

Пример формата:
```json
{
  "type": "oge-official-bank-pack",
  "version": 1,
  "source": "ФИПИ",
  "variants": [
    {
      "subject": "math",
      "year": 2025,
      "variant": 1,
      "questions": [
        {
          "segment": "Алгебра",
          "topic": "Линейные уравнения",
          "subtopic": "Базовый шаг",
          "difficulty": "medium",
          "type": "numeric-input",
          "prompt": "Решите уравнение ...",
          "numericAnswer": 4,
          "tolerance": 0.001,
          "explanation": {
            "correctAnswer": "4",
            "why": "...",
            "rule": "...",
            "stepByStep": "...",
            "commonMistakes": "...",
            "recognitionTip": "..."
          }
        }
      ]
    }
  ]
}
```

Важно:
- Автопакет собран из официальных ZIP-архивов ФИПИ, доступных на странице демоверсий на момент сборки.
- Часть заданий загружена в формате `extended-answer-lite` (учебная самопроверка), так как автоматическая проверка по PDF-демоверсиям ограничена офлайн-парсингом.

## Resume + onboarding
- `Onboarding` при первом запуске.
- `Продолжить с места остановки` через локальный snapshot сессии.

## LocalStorage
Основной ключ:
- `ogeTrainerStatsV4`

Дополнительно:
- legacy migration из `ogeTrainerStatsV3` и `ogeTrainerVariantStatsV2`;
- resume snapshot: `ogeTrainerResumeV1`.

## Базовая структура нормализованного вопроса
```js
{
  id,
  subject,
  segment,
  topic,
  subtopic,
  difficulty, // basic | medium | hard
  type,
  format,
  skill,
  prompt,
  options,
  correctIndex,
  correctAnswers,
  acceptedAnswers,
  numericAnswer,
  tolerance,
  sequenceItems,
  correctSequence,
  matching,
  matchPairs,
  blanks,
  correctBlanks,
  rubric,
  media, // optional: { type: "audio", localFile, mockTranscript, description }
  speakingLite, // optional: { prepSec, answerSec, taskCard, sampleAnswer, checklist }
  writingLite, // optional: { prompt, expectedStructure, keyPoints, sampleStrongAnswer }
  explanation: {
    correctAnswer,
    why,
    rule,
    formula,
    stepByStep,
    commonMistakes,
    alternateMethod,
    recognitionTip
  },
  expectedTimeSec,
  sourceHint,
  examBlueprintTag,
  requiredCoverage,
  tags,
  signature
}
```

## Правила добавления новых вопросов
- `id` должен быть уникальным в рамках банка.
- Для `single-choice` и `multi-choice` не допускаются повторяющиеся `options`.
- Для `single-choice`: `correctIndex` должен указывать на существующий элемент `options`.
- Для `multi-choice`: `correctAnswers` — массив уникальных индексов.
- Для `short-text`: заполните `acceptedAnswers` (допустимые эквиваленты).
- Для `numeric-input`: задайте `numericAnswer` и `tolerance`.
- Для `extended-answer-lite`: заполните `rubric.requiredKeyPoints` и `rubric.checklist`.

Для `extended-answer-lite` рекомендуется использовать расширенный `rubric`:
```js
rubric: {
  requiredKeyPoints: [],
  optionalKeyPoints: [],
  checklist: [],
  strongSample: "",
  typicalErrors: []
}
```

## Как добавить новый вопрос
1. Добавьте/расширьте фабрику в `questionBank.js`.
2. Укажите обязательные поля фабрики:
- `key`, `segment`, `topic`, `subtopic`, `difficulty`, `examBlueprintTag`, `build`.
3. Для нужного `type` заполните тип-специфичные поля.
4. Добавьте explanation-блок (минимум `why/rule/stepByStep/commonMistakes/recognitionTip`).
5. Проверьте через debug-диагностику.
6. Для `extended-answer-lite` добавляйте `requiredKeyPoints/optionalKeyPoints` и чек-лист.
7. Для `listening-lite` можно добавить `media.localFile`; если файла нет, добавьте `media.mockTranscript`.

## Как добавить новый формат вопроса
1. В `assessmentEngine.js` добавить:
- рендерер ввода;
- проверку;
- форматирование правильного ответа.
2. В `questionBank.js` добавить тип в `QUESTION_TYPE_META`.
3. Добавить задачи этого типа.
4. Прогнать `validateQuestionBank()`.

## Как добавить новый предмет
1. Добавить предмет в `SUBJECTS` и `SUBJECT_CONFIG`.
2. Добавить фабрики вопросов.
3. Добавить `SUBJECT_BLUEPRINTS` (+ exact/training profile).
4. Проверить coverage и validator.

## Smoke-test (ручной)
1. Открыть `index.html`.
2. Проверить onboarding и переход в тренажер.
3. Стартовать сессию, ответить 2-3 вопроса, выйти.
4. Убедиться, что блок `Продолжить с места остановки` появился.
5. Открыть `Экзамен` -> `Точный экзаменационный макет`, запустить вариант.
6. Открыть `Покрытие программы` и `Мой прогресс`.
7. Запустить `Диагностику банка`.
8. В `Отчёт` проверить экспорт JSON/HTML и импорт JSON.
