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
- Описание работ (Шаг 1): ${data.description || "не указано"}
- Уточнения по материалам (Шаг 2): ${data.descriptionStep2 || "нет"}
- Комментарий к заказу (Шаг 3): ${data.descriptionStep3 || "нет"}
- Тип работ (выбрано в меню): ${data.typeOfWork || "не указан"}
- Материал (выбрано в меню): ${data.material || "не указан"}
- Толщина (выбрано в меню): ${data.thickness || "не указана"}
- Тип шва (выбрано в меню): ${data.seamType || "не указан"}
- Положение сварки: ${data.position || "не указано"}
- Условия работы: ${data.conditions?.join(", ") || "обычные"}
- Срок выполнения: ${data.deadline || "обычный"}
- Дополнительные услуги: ${data.extraServices?.join(", ") || "нет"}
- Фотографии: ${data.photos?.length || 0} шт.

**ПРАВИЛА АНАЛИЗА ТЕКСТА (СТРОГО):**
1. **Приоритет данных:** Если в текстовых полях (Шаг 2, Шаг 3) указаны конкретные параметры (толщина, материал, тип шва), которые отличаются от выбранных в меню, ИСПОЛЬЗУЙ ДАННЫЕ ИЗ ТЕКСТА.
2. **ЗАПРЕЩЕНО выдумывать:**
   - размеры (длину шва, диаметр труб)
   - толщину металла
   - марку металла
   - количество узлов
   Используй ТОЛЬКО те цифры, которые ввёл пользователь. Если цифр нет — считай минимальный объем (1 метр) и укажи это в комментарии.
3. **Фотографии:** Используй ТОЛЬКО для:
   - оценки сложности доступа
   - определения типа конструкции
   - проверки, что это сварка
   НЕ используй фото для определения размеров или толщины "на глаз".

**СИСТЕМА РАСЧЁТА (КОЭФФИЦИЕНТЫ):**

1. **Базовые ставки (для стали):**
   - weld_base_steel = 800 ₽/м (сварка)
   - prep_base_steel = 300 ₽/м (зачистка)
   - finish_base_steel = 500 ₽/м² (финиш)

2. **Коэффициенты материалов (MATERIAL_COEFF):**
   - steel (черный металл): { weld: 1.0, prep: 1.0, finish: 1.0 }
   - stainless (нержавейка): { weld: 1.4, prep: 1.3, finish: 1.2 }
   - aluminium (алюминий): { weld: 1.5, prep: 1.3, finish: 1.1 }
   - cast_iron (чугун): { weld: 1.8, prep: 1.6, finish: 1.1 }
   - copper (медь): { weld: 1.7, prep: 1.4, finish: 1.2 }
   - brass (латунь): { weld: 1.4, prep: 1.2, finish: 1.1 }
   - titanium (титан): { weld: 2.2, prep: 1.7, finish: 1.3 }

3. **Коэффициенты толщины (THICKNESS_COEFF):**
   - lt_3 (до 3 мм): 1.0
   - mm_3_6 (3-6 мм): 1.1
   - mm_6_12 (6-12 мм): 1.25
   - gt_12 (12+ мм): 1.5
   - unknown: 1.1

4. **Коэффициенты типа шва (SEAM_TYPE_COEFF):**
   - butt (стыковой): 1.0
   - corner/tee (угловой/тавровый): 1.15
   - lap (нахлёст): 1.1
   - pipe (труба): 1.25

**ФОРМУЛЫ:**
weld_cost = weld_base_steel * material_coeff.weld * thickness_coeff * seam_type_coeff * weld_length_m
prep_cost = prep_base_steel * material_coeff.prep * thickness_coeff * seam_type_coeff * weld_length_m
finish_cost = finish_base_steel * material_coeff.finish * thickness_coeff * seam_type_coeff * weld_length_m * 0.1

total = weld_cost + prep_cost + finish_cost
totalMin = total * 0.9
totalMax = total * 1.2

**Верни ТОЛЬКО JSON в формате:**
{
  "totalMin": number,
  "totalMax": number,
  "comment": "Короткое объяснение цены. Укажи, какие параметры были взяты из текста, если они отличались."
}
`;

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
