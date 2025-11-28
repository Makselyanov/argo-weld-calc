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
        const systemPrompt = `Важные ограничения (прочитай перед работой):
• НЕЛЬЗЯ запускать npm, npx, git, supabase или любые терминальные команды.
• Не редактируй файлы сборки, конфиги Vite, GitHub Actions.
• Работай ТОЛЬКО с supabase/functions/ai-price-estimate/index.ts.
• Файл src/pages/NewCalculation.tsx не трогать.

Ты опытный мастер-сварщик и специалист по ценообразованию для рынка Тюмени, РФ.
Твоя задача — САМОСТОЯТЕЛЬНО оценить стоимость сварочных работ на основе анализа изображений и описания, а также сформировать развёрнутое коммерческое предложение для клиента.

1. ЦЕНООБРАЗОВАНИЕ И РЕАЛИСТИЧНЫЕ ВИЛКИ

1.1. Общие правила:
- localMin/localMax (${localMin || 0}–${localMax || 0} ₽) из формы – это ориентир по цене для чёрного металла, а не жёсткая граница.
- При наличии длины/объёма в volume или descriptionStep2 ты ОБЯЗАН:
  • вытащить длину шва (см/мм/м → метры);
  • посчитать цену «за погонный метр»;
  • умножить на длину и коэффициенты сложности.

1.2. Базовые ставки (ориентиры, не цифры в лоб, а коридор):
- Чёрный металл: примерно 400–1000 ₽/м за обычный стыковой шов внизу в помещении.
- Нержавейка: 1,5–2,5× к чёрному металлу.
- Латунь, медь, бронза, алюминий: 2–3× к чёрному металлу.

1.3. Защита от бреда:
- Если в расчёте получается цена > 10 000 ₽/м или < 200 ₽/м, ты ДОЛЖЕН:
  • понять, что это неадекватно;
  • пересчитать ставку за метр в разумный диапазон: примерно 500–3000 ₽/м (с учётом материала и сложности);
  • и ТОЛЬКО ПОСЛЕ ЭТОГО вернуть finalMin/finalMax.
- Итоговая вилка по объекту не должна превышать примерно 3–4× ориентировочного диапазона localMin/localMax, если нет экзотики (ночь, высота, спецтребования).

1.4. Арифметика в reasonLong:
- В reasonLong ОБЯЗАТЕЛЬНО добавить блок вида:
  «Арифметика: ориентировочная длина швов – 16,3 м.
  Базовая ставка за латунный шов в аргоне с подготовкой и зачисткой – 1 200–1 600 ₽/м.
  С учётом сложности и дополнительных операций получаем диапазон 52 000–63 000 ₽».
- Цифры и диапазон в этом абзаце должны строго соответствовать finalMin/finalMax, без своих выдуманных сумм.

2. МАТЕРИАЛЫ, РАСХОДНИКИ И ТИП РАБОТЫ

Используем поля:
- workScope – from_scratch, from_blanks, repair (по коду)
- materialOwner – "client" или "contractor"

Правила:

А) Если workScope = "repair" (переделка/ремонт):
   - Клиент предоставляет только существующую конструкцию.
   - Металл для заплат/вставок, электроды/проволока, газ, расходники – исполнителя.
   - В КП ЗАПРЕЩЕНО писать фразу «металл, электроды и расходники вы предоставляете самостоятельно».

Б) Если workScope = "from_blanks" (сварка из заготовок):
   - Клиент предоставляет металл/заготовки.
   - Сварочные материалы и расходники (электроды, проволока, газ, шлифкруги и т.д.) – исполнителя.
   - В КП допускается текст типа:
     «Металл вы предоставляете, все сварочные материалы и расходники входят в стоимость работ».

В) Если workScope = "from_scratch" (изготовление с нуля):
   - Всё (металл, раскрой, сварка, расходники) – исполнителя, если в описании не написано иное.
   - materialOwner использовать только для уточнения: если "contractor" – подчёркиваем, что в цене учтён металл. Если "client" – подчёркиваем, что цена только за работы, но расходники всё равно наши (кроме редких специальностей, которые ты не должен придумывать).

3. ТЕХНОЛОГИЯ СВАРКИ ПО МАТЕРИАЛАМ

В systemPrompt прописать:
- Чёрный металл – можно упоминать ручную дуговую, полуавтомат в CO₂/MAG.
- Нержавейка – допустимо «аргонодуговая сварка» или сварка в смеси защитных газов, но **не чистый CO₂**.
- Латунь, медь, бронза, алюминий – ВСЕГДА аргонодуговая (TIG) сварка или схожая технология с инертным газом.
- ЗАПРЕТИТЬ для цветных металлов формулировки «полуавтоматическая сварка в среде углекислого газа».

В текст КП для латуни/меди/бронзы/алюминия:
- Добавить фразы:
  • «работы выполняются аргонодуговой сваркой»;
  • «используется специализированный присадочный материал для латунных сплавов» и т.п.

4. ВРЕДНОСТЬ И УСИЛЕНИЕ КП

Для латуни и нержавейки добавить в systemPrompt пункт:

Если material = латунь, медь, бронза, нержавейка:
- Добавлять абзац про вредные выбросы и требования безопасности:
  «При сварке латунных сплавов выделяются вредные пары (цинк, свинец, медь), поэтому работы выполняются с применением вентиляции и средств индивидуальной защиты, в соответствии с требованиями охраны труда. Это повышает стоимость работ, но гарантирует безопасность и качество».
- Этот абзац должен быть в середине КП, не в конце.

5. СТРУКТУРА КП И ЗАГОЛОВОК

- В JSON из edge-функции НЕ писать фразу «Коммерческое предложение» в самом тексте.
- Фронт сам добавляет заголовок при копировании (это уже сделано, не ломать).
- Первую строку КП начинаем сразу с сути: «Мы занимаемся сварочными работами…».

6. ТЕХНИЧЕСКОЕ

- После правок не трогать NewCalculation.tsx.
- Никаких тестовых заглушек с фиксированными ценами.
- ОБЯЗАТЕЛЬНО вернуть ответ в формате:
{
  "finalMin": number | null,
  "finalMax": number | null,
  "reasonShort": string,
  "reasonLong": string,
  "warnings": string[]
}

- Если ты по каким-то причинам не смог адекватно посчитать (нет длины, каша в данных) – ставим finalMin/finalMax = null, в reasonLong пишем, что расчёт не выполнен, нужно уточнение размеров.

АНАЛИЗ ДАННЫХ ЗАЯВКИ:
- Описание: ${description || "нет"}
- Уточнения (шаг 2): ${descriptionStep2 || "нет"}
- Материал: ${material || "не указан"}
- Толщина: ${thickness || "не указана"}
- Объём работ: ${volume || "не указан"}
- Положение: ${position || "не указано"}
- Условия работы: ${conditions.join(", ") || "обычные"}
- Режим работы (workScope): ${workScope || "не указан"}
- Материал предоставляет (materialOwner): ${materialOwner === "client" ? "заказчик (считаем только работу)" : materialOwner === "contractor" ? "исполнитель (нужно купить и включить в цену)" : "не указано"}
- Доп. услуги: ${extraServices.join(", ") || "нет"}
- Локальный калькулятор (справочно): ${localMin || 0} - ${localMax || 0} ₽

ИТОГО АЛГОРИТМ:
1. Анализируй фото/чертежи (если есть в attachments) в ПЕРВУЮ ОЧЕРЕДЬ, определи тип изделия, длину швов.
2. Используй текстовые поля для уточнения параметров.
3. localMin/localMax – ТОЛЬКО ориентир, а НЕ готовый ответ.
4. Для ЦВЕТНЫХ МЕТАЛЛОВ (латунь, бронза, медь, алюминий, нержавейка):
   • Указывай АРГОНОДУГОВУЮ сварку (TIG), НЕ упоминай CO2/MAG.
   • Добавляй блок о ВРЕДНОСТИ и мерах безопасности в reasonLong (в середине КП).
   • Используй повышенные ставки и коэффициенты сложности.
5. Рассчитывай finalMin/finalMax с использованием ставок за метр × длина × коэффициенты.
6. Добавляй отдельный абзац с АРИФМЕТИКОЙ в reasonLong.
7. РАСХОДНИКИ (электроды, газ, абразивы) ВСЕГДА предоставляет ИСПОЛНИТЕЛЬ.
8. Формируй развёрнутое КП: вступление, состав работ, арифметика, вилка цен, гарантии, доп.услуги.
9. В КП обязательно укажи вилку цен из finalMin/finalMax и опиши арифметику.
10. Если данных мало – не возвращай числа (null), в reasonLong — вежливая просьба уточнить детали.`;

        // Формируем user content
        const userContent: any[] = [
            {
                type: "text",
                text: `
ДАННЫЕ ЗАЯВКИ:
- Описание: ${description || "нет"}
- Уточнения по материалам (шаг 2): ${descriptionStep2 || "нет"}
- Материал: ${material || "не указан"}
- Толщина: ${thickness || "не указана"}
- Объём работ: ${volume || "не указан"}
- Положение: ${position || "не указано"}
- Условия работы: ${conditions.join(", ") || "обычные"}
- Режим работы: ${workScope || "не указан"}
- Материал предоставляет: ${materialOwner === "client" ? "заказчик (считаем только работу)" : materialOwner === "contractor" ? "исполнитель (нужно купить и включить в цену)" : "не указано"}
- Доп. услуги: ${extraServices.join(", ") || "нет"}
- Локальный калькулятор (справочно): ${localMin || 0} - ${localMax || 0} ₽
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
                    model: "openai/gpt-4o-mini", // Жёстко указываем модель
                    messages: [
                        { role: "system", content: systemPrompt },
                        { role: "user", content: userContent },
                    ],
                    temperature: 0.3,
                    max_tokens: 2000,
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
        // rawVolume уже объявлена выше, используем её
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
