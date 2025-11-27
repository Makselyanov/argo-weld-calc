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
Рассчитай aiMin и aiMax на основе базового диапазона, используя следующие правила:

1. localMin и localMax – это базовая цена за простую работу: чёрный металл, стандартная сложность, только сварка.

2. Коэффициенты сложности:
- Если материал латунь, медь, бронза, алюминий, нержавейка, оцинковка, учитывай вредность и сложность: диапазон может быть в 1.5–3 раза выше базового.
- Если в описании есть много операций (зачистка швов, шлифовка, сатинирование, покраска, нанесение рисунка/полос, покрытие лаком) И (большая длина швов > 1000 см ИЛИ художественная табличка/мемориальная доска), относись к работе как к высокосложной: диапазон aiMin/aiMax может быть в 5–8 раз выше базового.
- Обязательно учитывай, что такие работы требуют медленной сварки, большой доли ручного труда и повышенного расхода материалов.

3. Если видишь сочетание цветного металла (бронза, латунь, медь) + длинные швы + несколько стадий обработки (зачистка, шлифовка, сатинирование, покраска, лак), не стесняйся поднимать цену до 5–8 раз от базового диапазона, чтобы покрыть вредность, ручной труд, материалы, налоги и работу напарника.
Сформируй reasonShort — краткий комментарий (одно предложение).
Сформируй reasonLong — полноценное коммерческое предложение для клиента.

Поле "reasonLong" — развёрнутое коммерческое предложение для клиента на русском языке.

Требования к reasonLong:
- Один цельный текст без Markdown, без списков, тире и нумерации, без emoji, без английского языка.
- Живой деловой тон: не канцелярский, без сухих фраз вида "режим работы - с нуля", "тип работы - welding" и т.п.
- нормальным языком переформулируй задачу клиента: что именно нужно сварить/собрать/зачистить/зашлифовать .
- Далее подробно опиши процесс работ: подготовка поверхности и кромок (зачистка от ржавчины, краски, загрязнений, при необходимости разделка кромок), разметка, резка или подготовка заготовок, сборка/стыковка элементов и прихватки, основная сварка, зачистка швов, финальный контроль качества. Используй только те этапы, которые логично вытекают из данных заявки.
- Значения полей заявки (тип работы, материал, толщина, тип шва, положение, условия, режим работы, выбранные доп. услуги) не перечисляй в виде "тип работы - ..., толщина - ..., режим работы - ...". Встраивай их в текст в виде нормальных фраз, без английских слов из полей (welding, flat и т.п.).
- Обязательно вплети выбранные доп. услуги (ВИК, УЗК, опрессовка, проверка мылом, акты и протоколы) в живое описание если в : какие проверки выполняются, каким образом проверяются швы, какие акты и протоколы оформляются по результатам работ.
- Внутри текста обязательно добавь отдельную фразу, начинающуюся с "Краткое ТЗ для сварщика:". В этой фразе в одном–двух предложениях опиши, что конкретно делать сварщику: что варим, из какого металла и толщины, какой тип шва, в каком положении, какие проверки и документы нужны. Без пунктов, без "тип работы - ..." и без перечислений через тире.
- В конце сделай мягкий призыв подтвердить расчёт и перейти к оформлению заказа или выезду на объект.
- Не дублируй числовой диапазон цен из aiMin/aiMax внутри reasonLong.

ФОРМАТ ОТВЕТА:
Верни ТОЛЬКО JSON без текста до и после, без \`\`\`:
{
  "aiMin": number,
  "aiMax": number,
  "reasonShort": "краткий комментарий",
  "reasonLong": "развёрнутое КП",
  "warnings": ["массив предупреждений или пустой массив"]
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
