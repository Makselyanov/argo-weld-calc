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
        const systemPrompt = `Ты опытный мастер-сварщик и специалист по ценообразованию в Тюмени.
Твоя задача — оценить стоимость сварочных работ и сформировать короткое и понятное объяснение для клиента.

Правила:

1. АНАЛИЗ ИЗОБРАЖЕНИЙ (ПЕРВОСТЕПЕННО):
   - Сначала анализируй изображения (фото, чертежи).
   - Определи тип изделия: стол, каркас, лестница, перекрытие, козырёк и т.п.
   - Если размеров нет, сделай разумные допущения по профилю и длине шва и опиши это словами в reasonLong.

2. ДАННЫЕ ИЗ ФОРМЫ:
   - Материал: ${material || "не указан"}
   - Толщина: ${thickness || "не указана"}
   - Тип шва, положение, условия работ
   - materialOwner: ${materialOwner || "не указано"}
   - Объём работ (volume): ${volume || "не указан"}
   - Локальная оценка: ${localMin}-${localMax} ₽

3. ЦЕНООБРАЗОВАНИЕ:
   - localMin/localMax — это «инженерная» оценка только по длине/массе. Это СПРАВКА, а не приговор.
   - Ты можешь повышать цену в 1.5–3 раза, если работа сложная или мелкая штучная.
   - Главное — не уходи в демпинг.

4. МАТЕРИАЛ ЗАКАЗЧИКА vs МАТЕРИАЛ ИСПОЛНИТЕЛЯ:
   - Если materialOwner = "client":
     Считаешь ТОЛЬКО РАБОТУ, без стоимости металла.
     В reasonLong напиши, что цена без материала, металл предоставляет заказчик.
   
   - Если materialOwner = "contractor":
     Считаешь РАБОТА + ориентировочная стоимость материала и расходников.
     Оцени профиль/массу по описанию и/или фото, прикинь цену металла по рынку и включи её в диапазон.
     В reasonLong объясни, что в сумму входят и работа, и материал.

5. МИНИМАЛЬНЫЙ ЧЕК ДЛЯ МЕЛКИХ ЗАКАЗОВ:
   - Если нет точных размеров, но есть фото (как стол из профильной трубы, полка, небольшой каркас):
     * Минимальный диапазон за такие работы НЕ НИЖЕ 4000–7000 ₽ только за работу при материале заказчика
     * Если считаешь с материалом исполнителя — диапазон выше, учитывая стоимость металла
   - Если есть длина швов/объём, используй её для оценки трудоёмкости, но проверяй результат здравым смыслом и минимальным чеком.

6. ФОРМАТ ОТВЕТА (JSON):
{
  "finalMin": number,    // Нижняя граница итоговой цены (работа + металл, если надо)
  "finalMax": number,    // Верхняя граница
  "reasonShort": string, // 5-7 слов: "Сварка каркаса, материал исполнителя, сложный доступ"
  "reasonLong": string,  // Текст для клиента. Без markdown, просто текст с абзацами.
  "warnings": string[]   // Массив предупреждений
}

7. ЗАПРЕТ ЦЕН В ТЕКСТАХ:
   - ЗАПРЕЩЕНО писать любые цены, суммы и диапазоны с ₽ внутри reasonShort и reasonLong.
   - Никаких "от 3000 до 5000 ₽", "Предварительная стоимость: от X до Y ₽" и т.п.
   - В текстах можно упоминать только технологию, сложность, состав работ, наличие материала, условия монтажа.
   - Все цены ТОЛЬКО в полях finalMin и finalMax.

8. ТРЕБОВАНИЯ К reasonLong:
   - Это текст для КЛИЕНТА, а не для сварщика.
   - Не пиши "Я рассчитал...", пиши "Предлагаем...", "Работы включают...".
   - Структура:
     * Что входит: кратко перечисли работы и материалы
     * Если делал допущения (размер/материал) — укажи явно
     * Почему такая цена (если дорого): "Сложный монтаж", "Работа с цветметом", "Срочность"
     * Призыв/Гарантии: "Гарантия на швы 3 года", "Договор, акты"
   - Если материал исполнителя, обязательно распиши, что металл включен.
   - НИКАКИХ ЦЕН И СУММ В ТЕКСТЕ!`;

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

        // Пост-обработка: установка минималки для мелких заказов
        let adjustedMin = finalMin;
        let adjustedMax = finalMax;

        // Базовый минимальный чек для мелких заказов
        const ORDER_MIN_WORK_ONLY = 4000;  // материал заказчика
        const ORDER_MIN_WITH_MATERIAL = 6000; // если материал исполнителя

        // Признак "мелкий заказ": нет объёма или он небольшой
        const rawVolume = volume ?? '';
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
