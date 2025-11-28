import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY");
const OPENROUTER_MODEL = Deno.env.get("OPENROUTER_MODEL") || "openai/gpt-4o-mini";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type AiResponse = {
    aiMin: number | null;
    aiMax: number | null;
    reasonShort: string;
    reasonLong: string;
    aiFailed: boolean;
    warnings: string[];
};

/**
 * Парсит JSON из текстового ответа AI
 * Ищет первый { и последний }, парсит это как JSON
 */
function parseAiJson(content: string): { finalMin: number; finalMax: number; reasonShort: string; reasonLong: string; warnings?: string[] } | null {
    try {
        const firstBrace = content.indexOf("{");
        const lastBrace = content.lastIndexOf("}");

        if (firstBrace === -1 || lastBrace === -1 || firstBrace >= lastBrace) {
            console.error("parseAiJson: No valid JSON braces found");
            return null;
        }

        const jsonStr = content.slice(firstBrace, lastBrace + 1);
        const parsed = JSON.parse(jsonStr);

        if (
            typeof parsed.finalMin !== "number" ||
            typeof parsed.finalMax !== "number" ||
            typeof parsed.reasonLong !== "string"
        ) {
            console.error("parseAiJson: Invalid structure", parsed);
            return null;
        }

        return {
            finalMin: parsed.finalMin,
            finalMax: parsed.finalMax,
            reasonShort: typeof parsed.reasonShort === "string" ? parsed.reasonShort : "",
            reasonLong: parsed.reasonLong,
            warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
        };
    } catch (err) {
        console.error("parseAiJson: Parse error", err);
        return null;
    }
}

serve(async (req) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    try {
        if (!OPENROUTER_API_KEY) {
            console.error("Missing OPENROUTER_API_KEY");
            const errorResponse: AiResponse = {
                aiMin: null,
                aiMax: null,
                aiFailed: true,
                reasonShort: "API ключ не настроен",
                reasonLong: "Сервер не смог подключиться к ИИ. Показана базовая стоимость по внутреннему калькулятору.",
                warnings: ["Расчёт выполнен без участия ИИ, только по базовым тарифам."],
            };
            return new Response(JSON.stringify(errorResponse), {
                status: 200,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        // Парсим входящие данные
        const data = await req.json();
        console.log("Request data keys:", Object.keys(data));

        const {
            description,
            descriptionStep2,
            photos = [],
            photoMetadata = [],
            material,
            thickness,
            position,
            conditions = [],
            workScope,
            materialOwner,
            localMin,
            localMax,
            volume,
            extraServices = [],
            attachments = [],
        } = data;

        // Формируем системный промпт
        const systemPrompt = `Ты опытный мастер-сварщик и специалист по ценообразованию для рынка Тюмени, РФ.
Твоя задача — САМОСТОЯТЕЛЬНО оценить стоимость сварочных работ на основе анализа изображений и описания, а также сформировать развёрнутое коммерческое предложение для клиента.

═══════════════════════════════════════════════════════════════════════════════
1. РАСЧЁТ ЦЕН И СИНХРОНИЗАЦИЯ ДИАПАЗОНОВ
═══════════════════════════════════════════════════════════════════════════════

1.1. Главное правило синхронизации:
   • aiMin = finalMin
   • aiMax = finalMax
   
   Никаких других диапазонов. Всё, что отображается в интерфейсе и в тексте КП, должно использовать ТОЛЬКО эти aiMin/aiMax.

1.2. Алгоритм расчёта базовой стоимости:

   ШАГ 1: Извлечь суммарную длину швов
   • Из volume или descriptionStep2 вытащить длину в см/мм/м → перевести в метры
   • Если длина не указана явно, оценить по фото/чертежу
   • Если невозможно определить — вернуть null и попросить уточнить

   ШАГ 2: Выбрать базовую ставку за метр в зависимости от материала
   • Чёрный металл: 400–1000 ₽/м (базовые условия: стык, низ, помещение)
   • Нержавейка: множитель 1.5–2 к чёрному → 600–2000 ₽/м
   • Латунь/медь/бронза: множитель 2–3 к чёрному → 800–3000 ₽/м
   • Алюминий: множитель 2–2.5 к чёрному → 800–2500 ₽/м

   ШАГ 3: Посчитать грубый коридор
   baseMin = lengthMeters × rateMin
   baseMax = lengthMeters × rateMax

   ШАГ 4: Применить коэффициенты сложности
   • Положение (вертикальное/потолочное): +20–50%
   • Высота/стеснённый доступ: +30–80%
   • Срочность: +20–40%
   • Специальные требования (НАКС, НК): +30–100%
   
   Общий итоговый множитель сложности: от 1.0 (простые условия) до 2.0 (средняя сложность), максимум до 3.0 только при РЕАЛЬНО жёстких условиях.
   
   finalMin = baseMin × kComplex
   finalMax = baseMax × kComplex

1.3. Защита от идиотских значений:

   ПРОВЕРКА 1: Ставка за метр
   • Если finalMin/lengthMeters < 200 ₽/м ИЛИ finalMax/lengthMeters > 3000 ₽/м
   • То пересчитать с разумными ставками (из ШАГ 2) без экстремальных коэффициентов
   
   ПРОВЕРКА 2: Общий диапазон
   • Если finalMin или finalMax > 3–4× localMax без явных причин (экзотика, высота, ночь)
   • То мягко прижать к диапазону localMin/localMax с объяснением в reasonLong

1.4. Арифметика в reasonLong (ОБЯЗАТЕЛЬНЫЙ БЛОК):

   В reasonLong ОБЯЗАТЕЛЬНО добавить отдельный абзац с подробной арифметикой:
   
   Пример:
   «Арифметика: суммарная длина швов – 17,3 м. Базовая ставка за латунный шов в аргоне с подготовкой и зачисткой – 1 200–1 600 ₽/м. С учётом сложности и дополнительных операций получаем диапазон 520 000–635 000 ₽.»
   
   ВАЖНО: Числа в последней строке брать НАПРЯМУЮ из finalMin и finalMax (которые = aiMin/aiMax).
   Запрещено писать в арифметике суммы, отличающиеся от aiMin/aiMax!

═══════════════════════════════════════════════════════════════════════════════
2. МАТЕРИАЛЫ, РАСХОДНИКИ И ТИП РАБОТЫ
═══════════════════════════════════════════════════════════════════════════════

Используем поля:
• workScope – "from_scratch", "from_blanks", "repair"
• materialOwner – "client" или "contractor"

ПРАВИЛА:

A) workScope = "repair" (переделка/ремонт):
   • Клиент предоставляет только существующую конструкцию
   • Металл для заплат/вставок, электроды/проволока, газ, расходники – ИСПОЛНИТЕЛЯ
   • ЗАПРЕЩЕНО писать: «металл, электроды и расходники вы предоставляете самостоятельно»

B) workScope = "from_blanks" (сварка из заготовок):
   • Клиент предоставляет металл/заготовки
   • Сварочные материалы и расходники (электроды, проволока, газ, шлифкруги) – ИСПОЛНИТЕЛЯ
   • Допустимый текст: «Металл вы предоставляете, все сварочные материалы и расходники входят в стоимость работ»

C) workScope = "from_scratch" (изготовление с нуля):
   • По умолчанию ВСЁ (металл + расходники) – ИСПОЛНИТЕЛЯ, если в описании не сказано обратное
   • materialOwner использовать только как уточнение:
     - "contractor" → подчёркиваем, что металл включён в цену
     - "client" → пишем, что цена за работы, но расходники всё равно наши

ГЛАВНОЕ: Электроды, проволока, газ, абразивы ВСЕГДА предоставляет ИСПОЛНИТЕЛЬ, независимо от workScope!

═══════════════════════════════════════════════════════════════════════════════
3. ТЕХНОЛОГИЯ СВАРКИ ДЛЯ ЛАТУНИ И ЦВЕТНЫХ МЕТАЛЛОВ
═══════════════════════════════════════════════════════════════════════════════

• Чёрный металл → можно ручная дуговая, полуавтомат в CO₂/MAG
• Нержавейка → аргонодуговая или сварка в смеси защитных газов, НЕ чистый CO₂
• Латунь, медь, бронза, алюминий → ВСЕГДА аргонодуговая (TIG) сварка

ЗАПРЕТИТЬ для цветных металлов формулировки «полуавтоматическая сварка в среде CO₂».

В текст КП для латуни/меди/бронзы/алюминия ОБЯЗАТЕЛЬНО добавить:
• «Работы выполняются аргонодуговой сваркой (TIG)»
• «Используется специализированный присадочный материал для [материал] сплавов»

═══════════════════════════════════════════════════════════════════════════════
4. ВРЕДНОСТЬ И УСИЛЕНИЕ КП
═══════════════════════════════════════════════════════════════════════════════

Для материалов: латунь, медь, бронза, нержавейка — в текст КП ВСЕГДА добавлять отдельный абзац:

«При сварке латунных/нержавеющих сплавов выделяются вредные пары и аэрозоли (цинк, свинец, медь и др.), поэтому работы выполняются с применением вентиляции и средств индивидуальной защиты, в соответствии с требованиями охраны труда. Это усложняет процесс и повышает стоимость, но обеспечивает безопасность и стабильное качество швов.»

Этот абзац должен быть ОТДЕЛЬНЫМ абзацем В СЕРЕДИНЕ КП, а не в примечании в конце.

═══════════════════════════════════════════════════════════════════════════════
5. СТРУКТУРА И ДЛИНА КП
═══════════════════════════════════════════════════════════════════════════════

КП должно быть БОГАТЫМ и ДЛИННЫМ (минимум 4–6 полноценных абзацев).
Арифметика и вредность идут ДОПОЛНИТЕЛЬНО, а не вместо основного текста.

ОБЯЗАТЕЛЬНАЯ СТРУКТУРА:

1. Вступление (1 абзац)
   • Кто мы, чем занимаемся
   • Город (Тюмень)
   • В общем виде о компетенциях

2. Описание конкретного заказа (1-2 абзаца)
   • Что именно делаем в этом проекте
   • Материал, длина швов, условия работ
   • Технология сварки (особенно для цветных металлов)

3. Блок стоимости (1 абзац)
   • «Предварительная стоимость работ: от {aiMin} до {aiMax} ₽.»
   • «Точная сумма зависит от объёма сварки, сложности узлов и необходимости дополнительных услуг.»

4. Арифметика (ОТДЕЛЬНЫЙ абзац, обязательно!)
   • Длина швов
   • Базовая ставка за метр
   • Итоговая вилка = aiMin–aiMax
   
   Пример: «Арифметика: суммарная длина швов – 17,3 м. Базовая ставка за латунный шов в аргоне с подготовкой и зачисткой – 1 200–1 600 ₽/м. С учётом сложности и дополнительных операций получаем диапазон 520 000–635 000 ₽.»

5. Особенности материала и вредности (ОТДЕЛЬНЫЙ абзац, если материал цветной/нержавейка!)
   • Использовать текст из раздела 4 выше

6. Выгоды и гарантия (1-2 абзаца)
   • Что клиент получит
   • Упоминание ГОСТ, надёжности
   • Примерные сроки
   • Гарантия на швы

7. Дополнительные услуги (1 абзац)
   • Выезд на замер
   • Доставка
   • Монтаж/демонтаж
   • Покраска
   • НК (ВИК/УЗК)
   • Оформление документации

ВАЖНО:
• В сам текст КП НЕ добавлять заголовок «Коммерческое предложение»
• Заголовок подставляется только на фронте при копировании
• КП должно начинаться сразу с сути, например: «Мы занимаемся сварочными работами...»

НЕ СОКРАЩАТЬ ТЕКСТ! Это должен быть ПОЛНОЦЕННЫЙ развёрнутый документ, который впечатлит клиента.

═══════════════════════════════════════════════════════════════════════════════
6. ФОРМАТ ОТВЕТА
═══════════════════════════════════════════════════════════════════════════════

Верни ответ СТРОГО в формате JSON:

{
  "finalMin": number | null,
  "finalMax": number | null,
  "reasonShort": string,
  "reasonLong": string,
  "warnings": string[]
}

• finalMin и finalMax — это и есть aiMin/aiMax (те же числа!)
• reasonShort — краткая суть для быстрого просмотра
• reasonLong — полное развёрнутое КП по структуре выше
• warnings — массив предупреждений (если есть)

Если не смог посчитать (нет длины, каша в данных) — ставь finalMin/finalMax = null, в reasonLong пиши, что нужно уточнить размеры.

═══════════════════════════════════════════════════════════════════════════════
ДАННЫЕ ЗАЯВКИ:
═══════════════════════════════════════════════════════════════════════════════

• Описание: ${description || "нет"}
• Уточнения (шаг 2): ${descriptionStep2 || "нет"}
• Материал: ${material || "не указан"}
• Толщина: ${thickness || "не указана"}
• Объём работ: ${volume || "не указан"}
• Положение: ${position || "не указано"}
• Условия работы: ${conditions.join(", ") || "обычные"}
• Режим работы (workScope): ${workScope || "не указан"}
• Материал предоставляет (materialOwner): ${materialOwner === "client" ? "заказчик (считаем только работу)" : materialOwner === "contractor" ? "исполнитель (нужно купить и включить в цену)" : "не указано"}
• Доп. услуги: ${extraServices.join(", ") || "нет"}
• Локальный калькулятор (справочно): ${localMin || 0} - ${localMax || 0} ₽

═══════════════════════════════════════════════════════════════════════════════
ИТОГОВЫЙ АЛГОРИТМ РАБОТЫ:
═══════════════════════════════════════════════════════════════════════════════

1. Анализируй фото/чертежи (если есть в attachments) В ПЕРВУЮ ОЧЕРЕДЬ → определи тип изделия, длину швов
2. Используй текстовые поля для уточнения параметров
3. localMin/localMax — ТОЛЬКО ориентир, а НЕ готовый ответ
4. Для ЦВЕТНЫХ МЕТАЛЛОВ (латунь, бронза, медь, алюминий, нержавейка):
   • Указывай АРГОНОДУГОВУЮ сварку (TIG), НЕ упоминай CO₂/MAG
   • Добавляй блок о ВРЕДНОСТИ и мерах безопасности в reasonLong (в середине КП)
   • Используй повышенные ставки и коэффициенты сложности
5. Рассчитывай finalMin/finalMax по алгоритму из раздела 1
6. Добавляй отдельный абзац с АРИФМЕТИКОЙ в reasonLong (раздел 1.4)
7. РАСХОДНИКИ (электроды, газ, абразивы) ВСЕГДА предоставляет ИСПОЛНИТЕЛЬ
8. Формируй развёрнутое КП по структуре из раздела 5 (минимум 4–6 абзацев + арифметика + вредность)
9. В КП обязательно укажи вилку цен из finalMin/finalMax и опиши арифметику
10. Если данных мало — не возвращай числа (null), в reasonLong — вежливая просьба уточнить детали

ПОМНИ: aiMin = finalMin, aiMax = finalMax. Везде один диапазон!`;

        // Формируем user content
        const userContent: any[] = [
            {
                type: "text",
                text: `
ДАННЫЕ ЗАЯВКИ:
• Описание: ${description || "нет"}
• Уточнения по материалам (шаг 2): ${descriptionStep2 || "нет"}
• Материал: ${material || "не указан"}
• Толщина: ${thickness || "не указана"}
• Объём работ: ${volume || "не указан"}
• Положение: ${position || "не указано"}
• Условия работы: ${conditions.join(", ") || "обычные"}
• Режим работы: ${workScope || "не указан"}
• Материал предоставляет: ${materialOwner === "client" ? "заказчик (считаем только работу)" : materialOwner === "contractor" ? "исполнитель (нужно купить и включить в цену)" : "не указано"}
• Доп. услуги: ${extraServices.join(", ") || "нет"}
• Локальный калькулятор (справочно): ${localMin || 0} - ${localMax || 0} ₽
`,
            },
        ];

        // Добавляем фото
        for (const file of attachments) {
            if (file.type === "image") {
                userContent.push({
                    type: "image_url",
                    image_url: { url: file.url },
                });
            }
        }

        console.log("Sending request to OpenRouter...");

        // Вызываем OpenRouter API
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 60000);

        let response;
        try {
            response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${OPENROUTER_API_KEY}`,
                    "Content-Type": "application/json",
                    "HTTP-Referer": "https://argo-weld-calc.com",
                    "X-Title": "ARGO Weld Calculator",
                },
                body: JSON.stringify({
                    model: "openai/gpt-4o-mini",
                    messages: [
                        { role: "system", content: systemPrompt },
                        { role: "user", content: userContent },
                    ],
                    temperature: 0.3,
                    max_tokens: 3000,
                }),
                signal: controller.signal,
            });
        } catch (fetchError) {
            clearTimeout(timeoutId);
            console.error("OpenRouter fetch error:", fetchError);
            const errorResponse: AiResponse = {
                aiMin: null,
                aiMax: null,
                aiFailed: true,
                reasonShort: "Ошибка подключения к ИИ",
                reasonLong: `Не удалось подключиться к API OpenRouter. Возможные причины: таймаут сети, недоступность сервера. Показана базовая стоимость по внутреннему калькулятору. Техническая информация: ${fetchError}`,
                warnings: ["Расчёт выполнен без участия ИИ, только по базовым тарифам."],
            };
            return new Response(JSON.stringify(errorResponse), {
                status: 200,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        clearTimeout(timeoutId);

        if (!response.ok) {
            // Пытаемся получить максимум информации об ошибке
            let errorDetails = "";
            try {
                const errorJson = await response.json();
                errorDetails = JSON.stringify(errorJson, null, 2);
                console.error("OpenRouter API error (JSON):", response.status, errorJson);
            } catch {
                errorDetails = await response.text();
                console.error("OpenRouter API error (text):", response.status, errorDetails);
            }

            const errorResponse: AiResponse = {
                aiMin: null,
                aiMax: null,
                aiFailed: true,
                reasonShort: "Ошибка API ИИ",
                reasonLong: `OpenRouter API вернул ошибку (HTTP ${response.status}). Возможные причины: неверный API-ключ, превышен лимит запросов, временная недоступность модели. Показана базовая стоимость по внутреннему калькулятору.`,
                warnings: ["Расчёт выполнен без участия ИИ, только по базовым тарифам."],
            };
            return new Response(JSON.stringify(errorResponse), {
                status: 200,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        // Читаем ответ от OpenRouter
        const rawResponse = await response.text();
        console.log("OpenRouter raw response (first 500 chars):", rawResponse.slice(0, 500));

        let aiResponse;
        try {
            aiResponse = JSON.parse(rawResponse);
        } catch (err) {
            console.error("Failed to parse OpenRouter JSON:", err);
            const errorResponse: AiResponse = {
                aiMin: null,
                aiMax: null,
                aiFailed: true,
                reasonShort: "Ошибка разбора ответа OpenRouter",
                reasonLong: "Сервер получил некорректный ответ от OpenRouter. Показана базовая стоимость по внутреннему калькулятору.",
                warnings: ["Расчёт выполнен без участия ИИ, только по базовым тарифам."],
            };
            return new Response(JSON.stringify(errorResponse), {
                status: 200,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        // Извлекаем текст из aiResponse.choices[0].message.content
        const content = aiResponse.choices?.[0]?.message?.content;

        if (!content || typeof content !== "string") {
            console.error("No content in AI response:", aiResponse);
            const errorResponse: AiResponse = {
                aiMin: null,
                aiMax: null,
                aiFailed: true,
                reasonShort: "Пустой ответ от ИИ",
                reasonLong: "ИИ вернул пустой ответ. Показана базовая стоимость по внутреннему калькулятору.",
                warnings: ["Расчёт выполнен без участия ИИ, только по базовым тарифам."],
            };
            return new Response(JSON.stringify(errorResponse), {
                status: 200,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        console.log("AI raw text:", content);

        // Парсим JSON из текста
        const parsed = parseAiJson(content);

        if (!parsed) {
            console.error("Failed to parse AI JSON from content");
            const errorResponse: AiResponse = {
                aiMin: null,
                aiMax: null,
                aiFailed: true,
                reasonShort: "Ошибка разбора ответа ИИ",
                reasonLong: "ИИ вернул ответ в некорректном формате. Показана базовая стоимость по внутреннему калькулятору.",
                warnings: ["Расчёт выполнен без участия ИИ, только по базовым тарифам."],
            };
            return new Response(JSON.stringify(errorResponse), {
                status: 200,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        const finalMin = Number(parsed.finalMin);
        const finalMax = Number(parsed.finalMax);

        // Проверка на валидность
        const isValidNumbers = Number.isFinite(finalMin) && finalMin > 0 && Number.isFinite(finalMax) && finalMax > 0;

        if (!isValidNumbers) {
            console.warn("AI returned invalid price:", { finalMin, finalMax });
            const errorResponse: AiResponse = {
                aiMin: null,
                aiMax: null,
                aiFailed: true,
                reasonShort: "Ошибка оценки ИИ",
                reasonLong: "Нейросеть не смогла корректно оценить стоимость (ответ не прошел проверку безопасности). Показана базовая стоимость по внутреннему калькулятору.",
                warnings: ["ИИ вернул некорректные данные, использован резервный расчёт"],
            };
            return new Response(JSON.stringify(errorResponse), {
                status: 200,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        // ЗАЩИТА ОТ БРЕДА: проверка цены за метр
        // Пытаемся извлечь длину швов из volume
        const rawVolume = volume ?? '';
        let lengthMeters = 5; // дефолтная длина для проверки
        const volumeMatch = rawVolume.match(/(\d+(?:\.\d+)?)\s*(м|метр|cm|см)/i);
        if (volumeMatch) {
            const value = parseFloat(volumeMatch[1]);
            const unit = volumeMatch[2].toLowerCase();
            if (unit.includes('м') || unit.includes('метр')) {
                lengthMeters = value;
            } else if (unit.includes('см') || unit.includes('cm')) {
                lengthMeters = value / 100;
            }
        }

        // Проверяем цену за метр
        const pricePerMeterMin = finalMin / lengthMeters;
        const pricePerMeterMax = finalMax / lengthMeters;
        const MIN_PRICE_PER_METER = 200;
        const MAX_PRICE_PER_METER = 10000;

        if (pricePerMeterMin < MIN_PRICE_PER_METER || pricePerMeterMax > MAX_PRICE_PER_METER) {
            console.warn(`ЗАЩИТА ОТ БРЕДА: цена за метр вне диапазона (${pricePerMeterMin.toFixed(0)}-${pricePerMeterMax.toFixed(0)} ₽/м), пересчитываем`);

            // Определяем материал для выбора ставки
            const materialLower = (material || '').toLowerCase();
            let reasonableMinRate = 500;
            let reasonableMaxRate = 1000;

            if (materialLower.includes('нерж') || materialLower.includes('stainless')) {
                reasonableMinRate = 600;
                reasonableMaxRate = 1500;
            } else if (materialLower.includes('латун') || materialLower.includes('медь') || materialLower.includes('bronze') || materialLower.includes('copper') || materialLower.includes('brass')) {
                reasonableMinRate = 800;
                reasonableMaxRate = 2000;
            } else if (materialLower.includes('алюмин') || materialLower.includes('aluminum')) {
                reasonableMinRate = 700;
                reasonableMaxRate = 1800;
            }

            // Пересчитываем с разумными ставками
            const recalcMin = lengthMeters * reasonableMinRate;
            const recalcMax = lengthMeters * reasonableMaxRate;

            console.log(`Пересчёт: ${lengthMeters}м × ${reasonableMinRate}-${reasonableMaxRate} ₽/м = ${recalcMin}-${recalcMax} ₽`);

            const errorResponse: AiResponse = {
                aiMin: Math.round(recalcMin),
                aiMax: Math.round(recalcMax),
                aiFailed: false,
                reasonShort: parsed.reasonShort || "Расчёт выполнен с учётом рыночных ставок",
                reasonLong: parsed.reasonLong + `\n\n(Примечание: первоначальная оценка ИИ была скорректирована в соответствии с актуальными тарифами рынка Тюмени ${reasonableMinRate}-${reasonableMaxRate} ₽/м)`,
                warnings: [...(parsed.warnings || []), "Цена скорректирована по рыночным ставкам"],
            };
            return new Response(JSON.stringify(errorResponse), {
                status: 200,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        // Пост-обработка: установка минималки для мелких заказов
        let adjustedMin = finalMin;
        let adjustedMax = finalMax;

        // Базовый минимальный чек для мелких заказов
        const ORDER_MIN_WORK_ONLY = 4000;  // материал заказчика
        const ORDER_MIN_WITH_MATERIAL = 6000; // если материал исполнителя

        // Признак "мелкий заказ": нет объёма или он небольшой
        const isSmallJob =
            !rawVolume ||
            (/^\s*\d+(\.\d+)?\s*(м|метр)/i.test(rawVolume) && parseFloat(rawVolume) <= 8);

        // Если модель дала числа, поднимаем их до минималки, если нужно
        if (isSmallJob) {
            const isContractor = materialOwner === 'contractor';
            const baseMin = isContractor ? ORDER_MIN_WITH_MATERIAL : ORDER_MIN_WORK_ONLY;

            if (adjustedMin < baseMin) {
                console.log(`Raising min price from ${adjustedMin} to ${baseMin} (small job, contractor=${isContractor})`);
                adjustedMin = baseMin;
            }
            if (adjustedMax < baseMin + 2000) {
                console.log(`Raising max price from ${adjustedMax} to ${baseMin + 2000} (small job)`);
                adjustedMax = baseMin + 2000;
            }
        }

        // На всякий случай, если после правок adjustedMax < adjustedMin — выровнять
        if (adjustedMax < adjustedMin) {
            adjustedMax = adjustedMin;
        }

        // Возвращаем успешный результат от ИИ
        // ВАЖНО: aiMin = adjustedMin, aiMax = adjustedMax (они же finalMin/finalMax)
        console.log("AI parse success:", { originalMin: finalMin, originalMax: finalMax, adjustedMin, adjustedMax });
        const successResponse: AiResponse = {
            aiMin: adjustedMin,
            aiMax: adjustedMax,
            aiFailed: false,
            reasonShort: parsed.reasonShort || "Расчёт выполнен искусственным интеллектом",
            reasonLong: parsed.reasonLong,
            warnings: parsed.warnings || [],
        };
        return new Response(JSON.stringify(successResponse), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    } catch (error) {
        console.error("Error in ai-price-estimate:", error);
        const errorResponse: AiResponse = {
            aiMin: null,
            aiMax: null,
            aiFailed: true,
            reasonShort: "Не удалось получить расчёт от нейросети",
            reasonLong: "При обращении к модели ИИ возникла техническая ошибка. Показана базовая стоимость по внутреннему калькулятору. Для уточнения свяжемся с вами вручную.",
            warnings: ["Расчёт выполнен без участия ИИ, только по базовым тарифам."],
        };
        return new Response(JSON.stringify(errorResponse), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }
});
