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

Рассчитай aiMin и aiMax в рублях, полностью сам, исходя из данных заявки.

1. Сначала оцени базовую стоимость сварки по длине швов:
   - сталь / чёрный металл: примерно 30–80 ₽ за 1 см простого стыкового шва;
   - нержавейка: 50–100 ₽ за 1 см;
   - алюминий: 60–120 ₽ за 1 см;
   - латунь / медь / бронза: 100–180 ₽ за 1 см (вредный и сложный материал, сильная токсичность при сварке).

2. Умножь ориентир за 1 см на суммарную длину швов. Это базовая цена за простую сварку без дополнительных операций.

3. Затем примени коэффициенты сложности:
   - длинные швы > 1000 см: умножь итог на 1.5–2.5;
   - много операций после сварки (зачистка, шлифовка, сатинирование, покраска, лак и т.п.): в зависимости от количества шагов умножь на 1.5–3.0;
   - неудобное положение / ограниченный доступ / работа по месту: добавь множитель 1.2–1.8;
   - вредные материалы (латунь, медь, бронза, оцинковка): добавь ещё множитель 1.3–2.0.

4. Обязательно учитывай налог, расходные материалы, амортизацию оборудования, напарника и нормальную прибыль мастера: итоговый диапазон aiMin/aiMax не должен превращать работу в убыток.

5. Очень важно: используй следующий референс-кейс для калибровки цен.
   Пример: латунные полосы, толщина 3 мм, длина швов около 1700 см, полный цикл работ (сварка, зачистка, шлифовка, сатинирование, прорисовка полос, покраска, покрытие лаком) в нормальных условиях мастерской стоит порядка 250 000–300 000 ₽. Любая похожая или более сложная работа не может стоить дешевле 200 000 ₽.

6. В aiMin и aiMax всегда давай честный диапазон, а не одну точку: обычно разброс 15–30 % от средней оценки.

Сформируй reasonShort как короткий комментарий, почему цена получилась такой (материал, длина швов, количество операций, вредность, доступ и т.п.).

Сформируй reasonLong как коммерческое предложение для клиента на русском языке.

Требования к reasonLong:
- Один цельный текст без Markdown, без списков, тире и нумераций, без emoji.
- Пишешь только для клиента, а не для сварщика. Не давай производственных инструкций.
- Коротко перескажи задачу клиента человеческим языком: что нужно сделать и с чем мы будем работать.
- Объясни, из-за чего цена выше обычной: сложный материал, длинные швы, много ручного труда, вредность, риск брака, большой объём подготовительных и отделочных операций.
- Подчеркни, что работа будет выполняться по договору, с соблюдением технологий, с использованием качественных материалов и с контролем качества.
- Упомяни, что можем предоставить все необходимые акты, протоколы и документы по результату.
- Заверши мягким призывом подтвердить расчёт и перейти к оформлению заказа или выезду на объект.

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
