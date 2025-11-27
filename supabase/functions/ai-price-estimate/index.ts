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
        const systemPrompt = `Ты — опытный главный инженер сварочного производства и эксперт по продажам. Твоя задача — оценить стоимость заказа и составить продающее коммерческое предложение (КП).

АЛГОРИТМ РАБОТЫ:

1. АНАЛИЗ ИЗОБРАЖЕНИЙ (САМОЕ ВАЖНОЕ):
   - В ПЕРВУЮ ОЧЕРЕДЬ смотри на приложенные фото/чертежи/скриншоты.
   - Оцени реальный масштаб, сложность сборки, количество стыков, необходимость помощника.
   - Если текст противоречит фото, верь фото.

2. АНАЛИЗ ПАРАМЕТРОВ И ТЕКСТА:
   - Учитывай материал (цветмет дороже), толщину, длину швов.
   - Читай описание и "Уточнения по материалам" — там может быть список того, что нужно купить.
   - Используй поля формы (material: ${material}, thickness: ${thickness}, position: ${position}, workScope: ${workScope}) как дополнительную информацию.

3. РАСЧЁТ ЦЕНЫ (finalMin, finalMax):
   - Твоя цена — ГЛАВНАЯ. 
   - Локальный калькулятор передал ${localMin}-${localMax} ₽ — это ТОЛЬКО справка, можешь отклоняться в 2-3 раза, если видишь реальную сложность или простоту.
   - Минимальный выезд/заказ: не менее 3000-5000 ₽ (даже за "приварить петлю").
   - Сложные изделия (лестницы, баки, фермы) могут стоить 50-200 тыс. ₽ и выше. Не стесняйся высоких цен за качественную работу.

4. ЛОГИКА "МАТЕРИАЛ ЗАКАЗЧИКА" vs "МАТЕРИАЛ ИСПОЛНИТЕЛЯ":
   - Если materialOwner === "client":
     Цена = только стоимость РАБОТЫ (сварка, резка, монтаж, расходники типа газа/проволоки).
     В reasonLong напиши: "Стоимость указана только за работы, материал предоставляет заказчик."
   
   - Если materialOwner === "contractor":
     Цена = РАБОТА + СТОИМОСТЬ МЕТАЛЛА.
     Оцени по тексту и фото, сколько нужно металла.
     Прикинь рыночную стоимость металла в РФ.
     В reasonLong напиши: "В стоимость включены работы (~X ₽) и ориентировочная стоимость материалов (~Y ₽). Точная смета на металл — по чекам."

5. ОТСУТСТВИЕ ДАННЫХ:
   - Если нет размеров/длин, сделай РАЗУМНОЕ ПРЕДПОЛОЖЕНИЕ (например, "считаю как для профильной трубы 40х20, размер конструкции ~1×1м").
   - Обязательно укажи это допущение в reasonLong.
   - В warnings добавь: "Нужен выезд на замер для уточнения стоимости."

ФОРМАТ ОТВЕТА (JSON):
{
  "finalMin": number, // Нижняя граница итоговой цены (работа + металл, если надо)
  "finalMax": number, // Верхняя граница
  "reasonShort": string, // 5-7 слов: "Сварка каркаса, материал исполнителя, сложный доступ"
  "reasonLong": string, // Текст КП для клиента. Без markdown, просто текст с абзацами.
  "warnings": string[] // Массив предупреждений (например: ["Нужен выезд на замер", "Цена без покраски"])
}

ТРЕБОВАНИЯ К reasonLong (Коммерческое Предложение):
- Это текст для КЛИЕНТА, а не для сварщика.
- Не пиши "Я рассчитал...", пиши "Предлагаем...", "Стоимость составит...".
- Структура:
  1. "Предварительная стоимость: от X до Y ₽." (Сразу, первой строкой).
  2. Что входит: кратко перечисли работы и материалы.
  3. Если делал допущения (размер/материал) — укажи явно.
  4. Почему такая цена (если дорого): "Сложный монтаж", "Работа с зеркальной нержавейкой", "Срочность".
  5. Призыв/Гарантии: "Гарантия на швы 3 года", "Договор, акты".
- Если материал исполнителя, обязательно распиши, что металл включен.`;

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
                    model: OPENROUTER_MODEL,
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
                reasonLong: "Сервер не смог подключиться к ИИ. Показана базовая стоимость по внутреннему калькулятору.",
                warnings: ["Расчёт выполнен без участия ИИ, только по базовым тарифам."],
            };
            return new Response(JSON.stringify(errorResponse), {
                status: 200,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        clearTimeout(timeoutId);

        if (!response.ok) {
            const errorText = await response.text();
            console.error("OpenRouter API error:", response.status, errorText);
            const errorResponse: AiResponse = {
                aiMin: null,
                aiMax: null,
                aiFailed: true,
                reasonShort: "Ошибка API ИИ",
                reasonLong: "Сервер не смог получить ответ от ИИ. Показана базовая стоимость по внутреннему калькулятору.",
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

        // Возвращаем успешный результат от ИИ
        console.log("AI parse success:", { finalMin, finalMax });
        const successResponse: AiResponse = {
            aiMin: finalMin,
            aiMax: finalMax,
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
