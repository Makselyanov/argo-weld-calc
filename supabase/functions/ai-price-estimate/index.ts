import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY");
const OPENROUTER_MODEL = Deno.env.get("OPENROUTER_MODEL") || "openai/gpt-4o-mini";

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

/**
 * Парсит JSON из текстового ответа AI
 * Ищет первый { и последний }, парсит это как JSON
 */
function parseAiJson(content: string): { aiMin: number; aiMax: number; reasonShort: string; reasonLong: string; warnings: string[] } | null {
    try {
        // Ищем первый { и последний }
        const firstBrace = content.indexOf('{');
        const lastBrace = content.lastIndexOf('}');

        if (firstBrace === -1 || lastBrace === -1 || firstBrace >= lastBrace) {
            console.error('parseAiJson: No valid JSON braces found');
            return null;
        }

        const jsonStr = content.slice(firstBrace, lastBrace + 1);
        const parsed = JSON.parse(jsonStr);

        // Проверяем структуру
        if (
            typeof parsed.aiMin !== 'number' ||
            typeof parsed.aiMax !== 'number' ||
            typeof parsed.reasonLong !== 'string'
        ) {
            console.error('parseAiJson: Invalid structure', parsed);
            return null;
        }

        return {
            aiMin: parsed.aiMin,
            aiMax: parsed.aiMax,
            reasonShort: typeof parsed.reasonShort === 'string' ? parsed.reasonShort : '',
            reasonLong: parsed.reasonLong,
            warnings: Array.isArray(parsed.warnings) ? parsed.warnings : []
        };
    } catch (err) {
        console.error('parseAiJson: Parse error', err);
        return null;
    }
}

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        // Проверяем наличие API ключа
        if (!OPENROUTER_API_KEY) {
            console.error("Missing OPENROUTER_API_KEY");
            return new Response(
                JSON.stringify({
                    aiMin: null,
                    aiMax: null,
                    aiFailed: true,
                    reasonShort: 'API ключ не настроен',
                    reasonLong: 'Сервер не смог подключиться к ИИ. Показана базовая стоимость по внутреннему калькулятору.',
                    warnings: []
                }),
                { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // Безопасное чтение входящего запроса
        let data;
        try {
            const rawBody = await req.text();
            console.log('Raw request body (first 500 chars):', rawBody.slice(0, 500));
            data = JSON.parse(rawBody);
        } catch (err) {
            console.error('Failed to parse request JSON:', err);
            return new Response(
                JSON.stringify({
                    aiMin: null,
                    aiMax: null,
                    aiFailed: true,
                    reasonShort: 'Ошибка разбора запроса',
                    reasonLong: 'Сервер не смог прочитать данные расчёта. Показана базовая стоимость по внутреннему калькулятору.',
                    warnings: []
                }),
                { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        const { attachments = [] } = data;

        const summaryText = `
ДАННЫЕ ЗАЯВКИ:
- Тип работ: ${data.typeOfWork || "не указан"}
- Режим работы: ${data.workScope || "не указан"}
- Материал: ${data.material || "не указан"}
- Толщина: ${data.thickness || "не указана"}
- Тип шва: ${data.seamType || "не указан"}
- Длина швов: ${data.volume || "не указана"}
- Положение: ${data.position || "не указано"}
- Условия работы: ${data.conditions?.join(", ") || "обычные"}
- Дополнительные услуги: ${data.extraServices?.join(", ") || "нет"}
- Материал предоставляет: ${data.materialOwner === 'client' ? 'заказчик (считаем только работу)' : data.materialOwner === 'contractor' ? 'исполнитель (нужно купить и включить в цену)' : 'не указано'}
- Описание: ${data.description || "нет"}
- Уточнения по материалам (шаг 2): ${data.descriptionStep2 || "нет"}
- Комментарий к заказу (шаг 3): ${data.descriptionStep3 || "нет"}
- Ориентировочная цена (локальный калькулятор): ${data.localMin || 0} - ${data.localMax || 0} ₽ (использовать ТОЛЬКО как справочный ориентир, если ИИ считает иначе — ставить свою цену)
`;

        const userContent: any[] = [
            {
                type: "text",
                text: summaryText,
            },
        ];

        for (const file of attachments) {
            if (file.type === "image") {
                userContent.push({
                    type: "image_url",
                    image_url: { url: file.url },
                });
            }
        }

        // Формируем промпт для AI
        const systemPrompt = `Ты — опытный главный инженер сварочного производства и эксперт по продажам. Твоя задача — оценить стоимость заказа и составить продающее коммерческое предложение (КП).

АЛГОРИТМ РАБОТЫ:

1. АНАЛИЗ ИЗОБРАЖЕНИЙ (САМОЕ ВАЖНОЕ):
   - В первую очередь смотри на приложенные фото/чертежи.
   - Оцени реальный масштаб, сложность сборки, количество стыков, необходимость помощника.
   - Если текст противоречит фото, верь фото.

2. АНАЛИЗ ПАРАМЕТРОВ И ТЕКСТА:
   - Учитывай материал (цветмет дороже), толщину, длину швов.
   - Читай "Уточнения по материалам" — там может быть список того, что нужно купить.

3. РАСЧЁТ ЦЕНЫ (aiMin, aiMax):
   - Твоя цена — ГЛАВНАЯ. Локальный калькулятор (если передан) — это просто "глупая" формула, используй его только как sanity-check, но не бойся ставить цену в 2-3 раза выше или ниже, если видишь реальную сложность или простоту.
   - Минимальный выезд/заказ: не менее 3000-5000 ₽ (даже за "приварить петлю").
   - Сложные изделия (лестницы, баки, фермы) могут стоить 50-200 тыс. ₽ и выше. Не стесняйся высоких цен за качественную работу.

4. ЛОГИКА "МАТЕРИАЛ ЗАКАЗЧИКА" vs "МАТЕРИАЛ ИСПОЛНИТЕЛЯ":
   - Если "Материал предоставляет: заказчик":
     Цена = только стоимость РАБОТЫ (сварка, резка, монтаж, расходники типа газа/проволоки).
     В reasonLong напиши: "Стоимость указана только за работы, материал предоставляет заказчик."
   
   - Если "Материал предоставляет: исполнитель":
     Цена = РАБОТА + СТОИМОСТЬ МЕТАЛЛА.
     Оцени по тексту ("Уточнения по материалам") и фото, сколько нужно металла.
     Прикинь рыночную стоимость металла в РФ.
     В reasonLong напиши: "В стоимость включены работы (~X ₽) и ориентировочная стоимость материалов (~Y ₽). Точная смета на металл — по чекам."

5. ОТСУТСТВИЕ ДАННЫХ:
   - Если нет размеров/материала, сделай РАЗУМНОЕ ПРЕДПОЛОЖЕНИЕ (например, "считаю как для профильной трубы 40х20, размер 1х1м").
   - Обязательно укажи это допущение в reasonLong.

ФОРМАТ ОТВЕТА (JSON):
{
  "aiMin": number, // Нижняя граница итоговой цены (работа + металл, если надо)
  "aiMax": number, // Верхняя граница
  "reasonShort": string, // 5-7 слов: "Сварка каркаса, материал исполнителя, сложный доступ"
  "reasonLong": string, // Текст КП для клиента. Без markdown, просто текст с абзацами.
  "warnings": string[] // Массив предупреждений (например: "Нужен выезд на замер", "Цена без покраски")
}

ТРЕБОВАНИЯ К reasonLong (Коммерческое Предложение):
- Это текст для КЛИЕНТА, а не для сварщика.
- Не пиши "Я рассчитал...", пиши "Предлагаем...", "Стоимость составит...".
- Структура:
  1. "Предварительная стоимость: от X до Y ₽." (Сразу, первой строкой).
  2. Что входит: кратко перечисли работы и материалы.
  3. Почему такая цена (если дорого): "Сложный монтаж", "Работа с зеркальной нержавейкой", "Срочность".
  4. Призыв/Гарантии: "Гарантия на швы 3 года", "Договор, акты".
- Если материал исполнителя, обязательно распиши, что металл включен.
`;

        console.log("Sending request to OpenRouter...");

        // Вызываем OpenRouter API
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 60000); // Увеличим таймаут для анализа картинок

        let response;
        try {
            response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
                    "Content-Type": "application/json",
                    "HTTP-Referer": "https://argo-weld-calc.com",
                    "X-Title": "ARGO Weld Calculator"
                },
                body: JSON.stringify({
                    model: OPENROUTER_MODEL,
                    messages: [
                        { role: "system", content: systemPrompt },
                        { role: "user", content: userContent },
                    ],
                    temperature: 0.3,
                    max_tokens: 2000
                }),
                signal: controller.signal
            });
        } catch (fetchError) {
            clearTimeout(timeoutId);
            console.error("OpenRouter fetch error:", fetchError);
            return new Response(
                JSON.stringify({
                    aiMin: null,
                    aiMax: null,
                    aiFailed: true,
                    reasonShort: 'Ошибка подключения к ИИ',
                    reasonLong: 'Сервер не смог подключиться к ИИ. Показана базовая стоимость по внутреннему калькулятору.',
                    warnings: []
                }),
                { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        clearTimeout(timeoutId);

        if (!response.ok) {
            const errorText = await response.text();
            console.error("OpenRouter API error:", response.status, errorText);
            return new Response(
                JSON.stringify({
                    aiMin: null,
                    aiMax: null,
                    aiFailed: true,
                    reasonShort: 'Ошибка API ИИ',
                    reasonLong: 'Сервер не смог получить ответ от ИИ. Показана базовая стоимость по внутреннему калькулятору.',
                    warnings: []
                }),
                { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // Читаем ответ от OpenRouter
        const rawResponse = await response.text();
        console.log('OpenRouter raw response (first 500 chars):', rawResponse.slice(0, 500));

        let aiResponse;
        try {
            aiResponse = JSON.parse(rawResponse);
        } catch (err) {
            console.error('Failed to parse OpenRouter JSON:', err);
            return new Response(
                JSON.stringify({
                    aiMin: null,
                    aiMax: null,
                    aiFailed: true,
                    reasonShort: 'Ошибка разбора ответа OpenRouter',
                    reasonLong: 'Сервер получил некорректный ответ от OpenRouter. Показана базовая стоимость по внутреннему калькулятору.',
                    warnings: []
                }),
                { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // Извлекаем текст из aiResponse.choices[0].message.content
        const content = aiResponse.choices?.[0]?.message?.content;

        if (!content || typeof content !== 'string') {
            console.error("No content in AI response:", aiResponse);
            return new Response(
                JSON.stringify({
                    aiMin: null,
                    aiMax: null,
                    aiFailed: true,
                    reasonShort: 'Пустой ответ от ИИ',
                    reasonLong: 'ИИ вернул пустой ответ. Показана базовая стоимость по внутреннему калькулятору.',
                    warnings: []
                }),
                { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        console.log("AI raw text:", content);

        // Парсим JSON из текста
        const parsed = parseAiJson(content);

        if (!parsed) {
            console.error("Failed to parse AI JSON from content");
            return new Response(
                JSON.stringify({
                    aiMin: null,
                    aiMax: null,
                    aiFailed: true,
                    reasonShort: 'Ошибка разбора ответа ИИ',
                    reasonLong: 'ИИ вернул ответ в некорректном формате. Показана базовая стоимость по внутреннему калькулятору.',
                    warnings: []
                }),
                { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        const aiMin = Number(parsed.aiMin);
        const aiMax = Number(parsed.aiMax);
        const localMin = data.localMin ?? 0;
        const localMax = data.localMax ?? 0;

        // Проверка на валидность и адекватность цены
        // 1. Числа должны быть положительными
        const isValidNumbers = Number.isFinite(aiMin) && aiMin > 0 && Number.isFinite(aiMax) && aiMax > 0;

        // 2. Цена не должна быть подозрительно низкой (менее 1/50 от локальной), если локальная цена значимая (>1000)
        // Это защита от галлюцинаций, когда ИИ пишет "50 рублей" вместо "50000"
        const isSuspiciouslyLow = localMin > 1000 && aiMin < (localMin / 50);

        if (!isValidNumbers || isSuspiciouslyLow) {
            console.warn("AI returned invalid or suspiciously low price, falling back to local. AI:", { aiMin, aiMax }, "Local:", { localMin });
            return new Response(
                JSON.stringify({
                    aiMin: localMin,
                    aiMax: localMax,
                    aiFailed: true, // Фронт покажет желтую плашку
                    reasonShort: 'Ошибка оценки ИИ',
                    reasonLong: 'Нейросеть не смогла корректно оценить стоимость (ответ не прошел проверку безопасности). Показана базовая стоимость по внутреннему калькулятору.',
                    warnings: ["ИИ вернул некорректные данные, использован резервный расчёт"]
                }),
                { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // Возвращаем успешный результат от ИИ
        console.log("AI parse success:", { aiMin, aiMax });
        return new Response(
            JSON.stringify({
                aiMin: aiMin,
                aiMax: aiMax,
                aiFailed: false, // Фронт покажет зеленую плашку
                reasonShort: parsed.reasonShort || "Расчёт выполнен искусственным интеллектом",
                reasonLong: parsed.reasonLong,
                warnings: parsed.warnings
            }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );

    } catch (err) {
        console.error("Error in ai-price-estimate:", err);
        return new Response(
            JSON.stringify({
                aiMin: null,
                aiMax: null,
                aiFailed: true,
                reasonShort: 'Внутренняя ошибка сервера',
                reasonLong: 'Произошла непредвиденная ошибка. Показана базовая стоимость по внутреннему калькулятору.',
                warnings: []
            }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
});
