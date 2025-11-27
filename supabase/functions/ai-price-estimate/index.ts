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

        // Формируем промпт для AI
        const prompt = `Ты опытный мастер-сварщик и специалист по ценообразованию сварочных работ.

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
- Описание: ${data.description || "нет"}

ЗАДАНИЕ:

На основе всех полей заявки предложи честный диапазон стоимости заказа в рублях РФ:

aiMin — минимальная разумная цена, ниже которой работа невыгодна исполнителю.

aiMax — рекомендуемая цена с учётом:
- вредности материала
- сложности сварки
- риска брака и переделок
- ручного труда
- расходников
- налогов
- оплаты напарнику

Сформируй:
- reasonShort — короткий комментарий для строки под ценой (1–2 предложения, почему диапазон такой)
- reasonLong — развёрнутое коммерческое предложение для клиента
- warnings — массив предупреждений по рискам (вредные пары, деформации, сложные позиции, работа на высоте ит.п.)

ЖЁСТКИЕ ПРАВИЛА ПО ЦЕНЕ:

Латунь, медь, бронза, алюминий — сложные и дорогие материалы. Для сочетания «латунь + длинные швы + полный цикл обработки» цена должна быть кратно выше простой сварки чёрного металла.

Например, для сварки латунных полос толщиной около 3 мм, общей длиной швов ~1700 см, с зачисткой, шлифовкой, сатинированием, прорисовкой полос и покрытием лаком итоговый диапазон должен быть порядка 200 000–300 000 ₽, а не 30 000 ₽.

ЗАПРЕЩЕНО считать «за сантиметр/метр» в ответе. aiMin и aiMax — это стоимость всего заказа целиком в рублях.

ТРЕБОВАНИЯ К reasonLong:

Один цельный текст без Markdown, без списков, тире и нумерации, без emoji и без техзаданий для сварщика. Пишем только для клиента, не даём производственные инструкции.

Структура текста:
1. Коротко переформулировать задачу клиента человеческим языком
2. Понятно объяснить, почему работа стоит дороже обычной: сложный материал (латунь и её вредность), длинные швы, много операций (зачистка, шлифовка, сатинирование, окраска, лак), большой объём ручного труда, расходники, риск брака и переделок, налоги, оплата помощнику
3. Упомянуть опыт и квалификацию, аккуратность, работу по договору, гарантию качества и сроков, при необходимости — акты и документы
4. Закончить мягким призывом подтвердить расчёт и перейти к оформлению заказа или выезду на объект

reasonShort — 1–2 предложения: кратко, без воды.

ФОРМАТ ОТВЕТА:

Ответ строго одним JSON-объектом без текста до и после:

{
  "aiMin": number,
  "aiMax": number,
  "reasonShort": string,
  "reasonLong": string,
  "warnings": string[]
}

aiMin и aiMax — целые числа в рублях РФ, aiMin < aiMax. Если не можешь оценить, верни aiMin = 0, aiMax = 0 и текст-объяснение в warnings.`;

        console.log("Sending request to OpenRouter...");

        // Вызываем OpenRouter API
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);

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
                        {
                            role: "user",
                            content: prompt
                        }
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

        // Возвращаем успешный результат
        console.log("AI parse success:", { aiMin: parsed.aiMin, aiMax: parsed.aiMax });
        return new Response(
            JSON.stringify({
                aiMin: parsed.aiMin,
                aiMax: parsed.aiMax,
                aiFailed: false,
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
