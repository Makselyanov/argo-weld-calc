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
        const prompt = `Ты опытный мастер-сварщик. Проанализируй заявку и дай оценку стоимости в рублях.

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
- Базовый диапазон: ${data.localMin || 0} - ${data.localMax || 0} ₽

ЗАДАНИЕ:

Рассчитай aiMin и aiMax на основе базового диапазона localMin/localMax.

1. localMin и localMax — это базовая цена за простую сварку чёрного металла в удобном положении, без вредных материалов и без дополнительных операций (зачистка, шлифовка, покраска и т.п.).

2. Коэффициенты материала (K_material):
- сталь, нержавейка, чугун: 1.0–1.3
- алюминий, титан: 1.5–2.5
- латунь, медь, бронза: 3–6 (это вредные и сложные в обработке металлы, варить их надо медленно, высокий риск брака)

3. Коэффициенты сложности (K_complex), они перемножаются с коэффициентом материала:
- если суммарная длина швов > 1000 см: умножь цену ещё на 1.5–2.0
- если в описании есть много операций: зачистка, шлифовка, сатинирование, покраска, покрытие лаком, художественная обработка, восстановление фактуры — умножь ещё на 2–3
- если работа идёт в неудобном положении, на высоте, с лесами или сложным доступом — умножь ещё на 1.3–1.8
- если работа штучная, художественная, с высоким риском переделок — выбирай верхние границы коэффициентов

4. Для очень сложных цветных металлов типа: латунный лист ~3 мм, длинные швы от 1500 см, полный цикл от зачистки до лака — общий коэффициент по отношению к localMin/localMax должен быть примерно в диапазоне 7–10. Такие работы не должны быть дешевле простых сварочных работ: лучше слегка завысить цену, чем занизить.

5. Расчёт:
- посчитай общий коэффициент: K_total = K_material * K_complex, но держи его в разумных пределах: 1.0–12.0
- aiMin = округлённое значение localMin * K_total
- aiMax = округлённое значение localMax * K_total
- следи, чтобы aiMax ≥ aiMin и чтобы диапазон был не слишком узким (разница не меньше 20%)

Сформируй reasonShort — краткий комментарий (одно предложение) для карточки расчёта.

Сформируй reasonLong — развёрнутое коммерческое предложение для клиента на русском языке.

Поле "warnings" — массив текстовых предупреждений. Используй его, если есть важные риски, которые надо отдельно подчеркнуть (токсичность материала, необходимость напарника, риск переделок и т.п.).

Требования к reasonLong:

- Один цельный текст без Markdown, без списков, тире и нумерации, без emoji, без английских слов.
- Пиши деловым, но живым языком: без канцелярита, без служебных фраз типа "режим работы — с нуля", "тип шва — butt" и т.п.
- Текст пишется только для клиента, НЕ включай туда блок "Краткое ТЗ для сварщика" и не давай производственных инструкций.
- В начале коротко переформулируй задачу клиента человеческим языком: что именно нужно сделать и из какого металла.
- Далее опиши процесс работ так, чтобы клиент понимал, за что он платит: подготовка поверхности и кромок, сварка, зачистка швов, шлифовка, сатинирование, покраска, покрытие лаком, финальный контроль качества. Упоминай только те этапы, которые действительно относятся к заявке.
- Отдельным абзацем объясни, почему цена для этой работы выше обычной: вредный материал (например, латунь, цинковые испарения), длинные швы, медленная сварка, большой объём ручного труда, риск брака и переделок, необходимость напарника, расход материалов и налоговая нагрузка.
- Добавь блок про гарантии и документы: что работы выполняются по договору, с соблюдением технологий, с ответственностью за качество и срок.
- В конце сделай мягкий призыв подтвердить расчёт и перейти к оформлению заказа или выезду на объект.

ФОРМАТ ОТВЕТА:
Верни только JSON без текста до и после, без \`\`\`:

{
  "aiMin": number,
  "aiMax": number,
  "reasonShort": string,
  "reasonLong": string,
  "warnings": string[]
}`;

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
