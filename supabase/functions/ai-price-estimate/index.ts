import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY");
const OPENROUTER_MODEL = Deno.env.get("OPENROUTER_MODEL") || "openai/gpt-4o-mini";

serve(async (req) => {
    try {
        // Проверяем наличие API ключа
        if (!OPENROUTER_API_KEY) {
            console.error("Missing OPENROUTER_API_KEY");
            return new Response(
                JSON.stringify({ error: "Missing API configuration" }),
                { status: 500, headers: { "Content-Type": "application/json" } }
            );
        }

        const data = await req.json();

        // Формируем промт для AI
        const prompt = `Ты опытный мастер-сварщик с 20-летним стажем работы в России. 
Проанализируй заявку на сварочные работы и дай реалистичную оценку стоимости в рублях (₽).

**Данные заявки:**
- Описание работ: ${data.description || "не указано"}
- Тип работ: ${data.typeOfWork || "не указан"}
- Материал: ${data.material || "не указан"}
- Толщина: ${data.thickness || "не указана"}
- Тип шва: ${data.seamType || "не указан"}
- Положение сварки: ${data.position || "не указано"}
- Условия работы: ${data.conditions?.join(", ") || "обычные"}
- Срок выполнения: ${data.deadline || "обычный"}
- Дополнительные услуги: ${data.extraServices?.join(", ") || "нет"}
- Фотографии: ${data.photos?.length || 0} шт.

**Учитывай:**
1. Текущие рыночные цены на сварочные работы в России (2024-2025)
2. Сложность работ (материал, толщина, положение)
3. Условия работы (высота, стеснённость, улица/помещение)
4. Срочность выполнения
5. Стоимость дополнительных услуг (контроль, испытания)
6. Региональные особенности ценообразования

**Верни ТОЛЬКО JSON в формате:**
{
  "totalMin": <минимальная цена в рублях>,
  "totalMax": <максимальная цена в рублях>,
  "comment": "<краткий комментарий к оценке на русском, 1-2 предложения>"
}

Не добавляй никаких других пояснений, только чистый JSON.`;

        // Вызываем OpenRouter API
        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
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
                max_tokens: 500
            })
        });

        if (!response.ok) {
            const errorData = await response.text();
            console.error("OpenRouter API error:", errorData);
            return new Response(
                JSON.stringify({ error: "AI service unavailable" }),
                { status: 500, headers: { "Content-Type": "application/json" } }
            );
        }

        const aiResponse = await response.json();
        const content = aiResponse.choices?.[0]?.message?.content;

        if (!content) {
            console.error("No content in AI response");
            return new Response(
                JSON.stringify({ error: "Invalid AI response" }),
                { status: 500, headers: { "Content-Type": "application/json" } }
            );
        }

        // Парсим JSON из ответа AI
        let priceEstimate;
        try {
            // Пытаемся извлечь JSON из ответа (на случай если AI добавил текст до/после)
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                priceEstimate = JSON.parse(jsonMatch[0]);
            } else {
                priceEstimate = JSON.parse(content);
            }
        } catch (parseError) {
            console.error("Failed to parse AI response:", content);
            return new Response(
                JSON.stringify({ error: "Failed to parse AI response" }),
                { status: 500, headers: { "Content-Type": "application/json" } }
            );
        }

        // Валидируем результат
        if (
            typeof priceEstimate.totalMin !== "number" ||
            typeof priceEstimate.totalMax !== "number" ||
            priceEstimate.totalMin <= 0 ||
            priceEstimate.totalMax <= 0 ||
            priceEstimate.totalMin > priceEstimate.totalMax
        ) {
            console.error("Invalid price estimate:", priceEstimate);
            return new Response(
                JSON.stringify({ error: "Invalid price values" }),
                { status: 500, headers: { "Content-Type": "application/json" } }
            );
        }

        return new Response(
            JSON.stringify({
                totalMin: Math.round(priceEstimate.totalMin),
                totalMax: Math.round(priceEstimate.totalMax),
                comment: priceEstimate.comment || "Оценка выполнена AI"
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
        );

    } catch (err) {
        console.error("Error in ai-price-estimate:", err);
        return new Response(
            JSON.stringify({ error: "Internal server error" }),
            { status: 500, headers: { "Content-Type": "application/json" } }
        );
    }
});
