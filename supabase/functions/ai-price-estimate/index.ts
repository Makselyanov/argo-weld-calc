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

// Новая структура ответа от модели (только метрики, БЕЗ цен)
type AiMetricsResponse = {
    weld_length_m: {
        linear_simple: number;
        corner_edges: number;
        complex_areas: number;
    };
    difficulty_coeff: number;
    prep_hours: number;
    welding_hours: number;
    finishing_hours: number;
    risk_level: "low" | "medium" | "high";
    uncertainty_comment: string;
    explanation_for_client: string;
};

/**
 * Парсит JSON из текстового ответа AI (новая структура с метриками)
 */
function parseAiMetrics(content: string): AiMetricsResponse | null {
    try {
        const firstBrace = content.indexOf("{");
        const lastBrace = content.lastIndexOf("}");

        if (firstBrace === -1 || lastBrace === -1 || firstBrace >= lastBrace) {
            console.error("parseAiMetrics: No valid JSON braces found");
            return null;
        }

        const jsonStr = content.slice(firstBrace, lastBrace + 1);
        const parsed = JSON.parse(jsonStr);

        // Валидация новой структуры
        if (
            !parsed.weld_length_m ||
            typeof parsed.weld_length_m.linear_simple !== "number" ||
            typeof parsed.weld_length_m.corner_edges !== "number" ||
            typeof parsed.weld_length_m.complex_areas !== "number" ||
            typeof parsed.difficulty_coeff !== "number" ||
            typeof parsed.prep_hours !== "number" ||
            typeof parsed.welding_hours !== "number" ||
            typeof parsed.finishing_hours !== "number" ||
            !parsed.risk_level ||
            typeof parsed.uncertainty_comment !== "string" ||
            typeof parsed.explanation_for_client !== "string"
        ) {
            console.error("parseAiMetrics: Invalid structure", parsed);
            return null;
        }

        return parsed as AiMetricsResponse;
    } catch (err) {
        console.error("parseAiMetrics: Parse error", err);
        return null;
    }
}

/**
 * Расчёт цены по метрикам и тарифам
 */
function calculatePriceFromMetrics(
    metrics: AiMetricsResponse,
    material: string,
    workScope: string
): { totalMin: number; totalMax: number } {
    const { weld_length_m, difficulty_coeff, prep_hours, welding_hours, finishing_hours } = metrics;

    // Суммарная длина швов
    const totalLength = weld_length_m.linear_simple + weld_length_m.corner_edges + weld_length_m.complex_areas;

    // Базовые тарифы за метр для стали (Тюмень)
    const STEEL_BASE_MIN = 400;
    const STEEL_BASE_MAX = 700;

    // Множители для разных материалов
    const materialLower = (material || "").toLowerCase();
    let materialMult = 1.0;

    if (materialLower.includes("нерж") || materialLower.includes("stainless")) {
        materialMult = 1.4;
    } else if (
        materialLower.includes("алюмин") ||
        materialLower.includes("aluminum")
    ) {
        materialMult = 1.6;
    } else if (
        materialLower.includes("латун") ||
        materialLower.includes("медь") ||
        materialLower.includes("бронз") ||
        materialLower.includes("brass") ||
        materialLower.includes("copper") ||
        materialLower.includes("bronze")
    ) {
        materialMult = 1.7;
    }

    const rateMin = STEEL_BASE_MIN * materialMult;
    const rateMax = STEEL_BASE_MAX * materialMult;

    // Стоимость сварки с учётом коэффициента сложности
    const weldCostMin = totalLength * rateMin * difficulty_coeff;
    const weldCostMax = totalLength * rateMax * difficulty_coeff;

    // Почасовые ставки
    const HOURLY = {
        prep: 800,
        weld: 1000,
        finish: 800,
    };

    const timeCostMin =
        prep_hours * HOURLY.prep +
        welding_hours * HOURLY.weld +
        finishing_hours * HOURLY.finish;

    const timeCostMax = timeCostMin * 1.2; // +20% на риск

    // Итоговые цены
    const totalMin = Math.round(weldCostMin + timeCostMin);
    const totalMax = Math.round(weldCostMax + timeCostMax);

    return { totalMin, totalMax };
}

/**
 * Генерация текста КП на основе метрик
 */
function generateProposal(
    metrics: AiMetricsResponse,
    material: string,
    workScope: string,
    materialOwner: string,
    totalMin: number,
    totalMax: number
): { reasonShort: string; reasonLong: string } {
    const { weld_length_m, difficulty_coeff, risk_level, uncertainty_comment, explanation_for_client } = metrics;

    const totalLength = weld_length_m.linear_simple + weld_length_m.corner_edges + weld_length_m.complex_areas;
    const materialLower = (material || "сталь").toLowerCase();

    // reasonShort
    let reasonShort = "";
    if (materialLower.includes("латун") || materialLower.includes("brass")) {
        reasonShort = "Сварка латунного изделия с зачисткой и финишной обработкой";
    } else if (materialLower.includes("медь") || materialLower.includes("copper")) {
        reasonShort = "Сварка медной конструкции с подготовкой и обработкой";
    } else if (materialLower.includes("бронз") || materialLower.includes("bronze")) {
        reasonShort = "Сварка бронзового изделия с финишной обработкой";
    } else if (materialLower.includes("нерж") || materialLower.includes("stainless")) {
        reasonShort = "Сварка нержавеющей стали с обработкой и полировкой";
    } else if (materialLower.includes("алюмин") || materialLower.includes("aluminum")) {
        reasonShort = "Сварка алюминиевой конструкции";
    } else {
        reasonShort = "Сварка стальной конструкции с подготовкой и обработкой";
    }

    // reasonLong (полное КП)
    const paragraphs: string[] = [];

    // 1. Вступление
    paragraphs.push(
        "Мы занимаемся профессиональной сваркой металлоконструкций в Тюмени. " +
        "Выполняем весь спектр работ: от небольших ремонтов до изготовления сложных изделий с нуля. " +
        "Наши специалисты имеют опыт работы с чёрными и цветными металлами, аттестацию и необходимое оборудование."
    );

    // 2. Описание работ (используем explanation_for_client)
    paragraphs.push(explanation_for_client);

    // 3. Блок стоимости
    paragraphs.push(
        `Предварительная стоимость работ: от ${totalMin.toLocaleString("ru-RU")} до ${totalMax.toLocaleString("ru-RU")} ₽. ` +
        "Точная сумма зависит от объёма сварки, сложности узлов и необходимости дополнительных услуг."
    );

    // 4. Арифметика
    const STEEL_BASE_MIN = 400;
    const STEEL_BASE_MAX = 700;
    let materialMult = 1.0;
    if (materialLower.includes("нерж") || materialLower.includes("stainless")) {
        materialMult = 1.4;
    } else if (materialLower.includes("алюмин") || materialLower.includes("aluminum")) {
        materialMult = 1.6;
    } else if (
        materialLower.includes("латун") ||
        materialLower.includes("медь") ||
        materialLower.includes("бронз") ||
        materialLower.includes("brass") ||
        materialLower.includes("copper") ||
        materialLower.includes("bronze")
    ) {
        materialMult = 1.7;
    }
    const rateMin = Math.round(STEEL_BASE_MIN * materialMult);
    const rateMax = Math.round(STEEL_BASE_MAX * materialMult);

    paragraphs.push(
        `Арифметика: суммарная длина швов – ${totalLength.toFixed(1)} м. ` +
        `Базовая ставка за метр шва с учётом материала и условий работ – ${rateMin}–${rateMax} ₽/м. ` +
        `С учётом коэффициента сложности (${difficulty_coeff.toFixed(1)}), подготовительных и финишных операций ` +
        `получаем диапазон ${totalMin.toLocaleString("ru-RU")}–${totalMax.toLocaleString("ru-RU")} ₽.`
    );

    // 5. Вредность для цветных металлов
    const isColoredMetal =
        materialLower.includes("латун") ||
        materialLower.includes("медь") ||
        materialLower.includes("бронз") ||
        materialLower.includes("brass") ||
        materialLower.includes("copper") ||
        materialLower.includes("bronze") ||
        materialLower.includes("нерж") ||
        materialLower.includes("stainless");

    if (isColoredMetal) {
        const metalName = materialLower.includes("нерж") || materialLower.includes("stainless")
            ? "нержавеющих"
            : materialLower.includes("латун") || materialLower.includes("brass")
                ? "латунных"
                : materialLower.includes("медь") || materialLower.includes("copper")
                    ? "медных"
                    : materialLower.includes("бронз") || materialLower.includes("bronze")
                        ? "бронзовых"
                        : "цветных";

        paragraphs.push(
            `При сварке ${metalName} сплавов выделяются вредные пары и аэрозоли (цинк, свинец, медь и др.), ` +
            "поэтому работы выполняются аргонодуговой сваркой (TIG) с применением вентиляции и средств индивидуальной защиты, " +
            "в соответствии с требованиями охраны труда. " +
            "Это усложняет процесс и повышает стоимость, но обеспечивает безопасность и стабильное качество швов."
        );
    }

    // 6. Материалы и расходники
    if (workScope === "repair") {
        paragraphs.push(
            "Вы предоставляете существующую конструкцию для ремонта. " +
            "Металл для заплат (при необходимости), электроды, газ и все расходные материалы входят в стоимость работ."
        );
    } else if (workScope === "from_blanks") {
        paragraphs.push(
            "Металл и заготовки вы предоставляете самостоятельно. " +
            "Сварочные материалы (электроды, проволока, газ, шлифовальные круги и прочие расходники) входят в стоимость работ."
        );
    } else {
        // from_scratch
        if (materialOwner === "client") {
            paragraphs.push(
                "Металл вы предоставляете самостоятельно (либо мы поможем с закупкой за отдельную плату). " +
                "Все сварочные материалы и расходники входят в стоимость работ."
            );
        } else {
            paragraphs.push(
                "Металл и все расходные материалы (электроды, газ, абразивы) включены в стоимость работ. " +
                "Вам не нужно ничего докупать — мы берём на себя всю организацию процесса."
            );
        }
    }

    // 7. Выгоды и гарантия
    paragraphs.push(
        "Все швы выполняются в соответствии с ГОСТ. Ориентировочный срок выполнения — от 1 до 5 дней в зависимости от объёма. " +
        "Предоставляем гарантию на сварные соединения. По желанию можем организовать неразрушающий контроль (ВИК, УЗК) и оформить необходимую документацию."
    );

    // 8. Дополнительные услуги
    paragraphs.push(
        "Дополнительно можем выполнить: выезд мастера на замер, доставку конструкции, монтаж и демонтаж, " +
        "покраску или антикоррозионную обработку, оформление паспортов и исполнительной документации."
    );

    // 9. Закрывающий призыв
    paragraphs.push(
        "Свяжитесь с нами для уточнения деталей, согласования сроков и окончательной стоимости. " +
        "Готовы ответить на все вопросы и приступить к работе в удобное для вас время."
    );

    const reasonLong = paragraphs.join("\n\n");

    return { reasonShort, reasonLong };
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

        // Формируем системный промпт (НОВАЯ ВЕРСИЯ: модель возвращает только метрики)
        const systemPrompt = `Ты профессиональный инженер-сварщик с опытом 15+ лет. 
Твоя задача — по фото и описанию оценить объём и сложность сварочных работ, 
НО НЕ считать финальную цену в рублях. Цены считает мой калькулятор.

Всегда сначала внимательно анализируй фото и текст. 
Если критически не хватает данных, в "uncertainty_comment" напиши, какие доп. фото или замеры нужны.

Тебе приходят:
- город (Тюмень, Россия),
- материал ("steel" / "stainless" / "aluminum" / "brass" / "copper" / "bronze"),
- толщина,
- условия работ,
- тип задачи (from_scratch / repair / from_blanks),
- краткое текстовое описание,
- ссылка на фотографии/изображения конструкции.

Твой ответ ДОЛЖЕН быть строго в формате JSON с полями:

{
  "weld_length_m": {
    "linear_simple": number,    // суммарная длина простых линейных швов, м
    "corner_edges": number,     // углы, торцы, примыкания, м
    "complex_areas": number     // труднодоступные/сложные зоны, м
  },
  "difficulty_coeff": number,   // 0.8, 1.0, 1.2, 1.4, 1.5 (коэффициент общей сложности)
  "prep_hours": number,         // часы подготовки (резка, подгонка, зачистка кромок)
  "welding_hours": number,      // чистое время сварки
  "finishing_hours": number,    // зачистка, сатинирование, покраска и т.п.
  "risk_level": "low" | "medium" | "high",
  "uncertainty_comment": "string",   // что может измениться или чего не видно
  "explanation_for_client": "string" // человеческое объяснение, из чего складывается объём и сложность
}

Никаких других полей, никакого текста вне JSON.

ВАЖНО:
- Если по фото/описанию невозможно определить длины швов, верни все числовые метрики как 0 и подробно опиши в uncertainty_comment, что требуется.
- difficulty_coeff: 0.8 (очень просто), 1.0 (норма), 1.2 (средняя сложность), 1.4 (сложно), 1.5 (очень сложно).
- Часы указывай реалистично. Например, для 5 м простых швов: prep_hours = 1.5, welding_hours = 2, finishing_hours = 1.
- В explanation_for_client напиши развёрнутый текст (3–5 предложений) о том, что именно варим, в каких условиях, какая технология используется (для цветных металлов обязательно упомяни аргонодуговую сварку TIG), какие особенности материала и конструкции.

Примеры:
• Простой ремонт стального каркаса 3 м швов: linear_simple=3, corner_edges=0, complex_areas=0, difficulty_coeff=1.0, prep_hours=1, welding_hours=1.5, finishing_hours=0.5
• Латунный лист 5 м периметр с зачисткой: linear_simple=3, corner_edges=2, complex_areas=0, difficulty_coeff=1.2, prep_hours=2, welding_hours=3, finishing_hours=2`;

        // Формируем user content
        const userContent: any[] = [
            {
                type: "text",
                text: `
ДАННЫЕ ЗАЯВКИ:
• Описание: ${description || "нет"}
• Уточнения по материалам (шаг 2): ${descriptionStep2 || "нет"}
• Материал: ${material || "не указан"}
• Толщина: ${thickness || "не указана"}
• Объём работ: ${volume || "не указан"}
• Положение: ${position || "не указано"}
• Условия работы: ${conditions.join(", ") || "обычные"}
• Режим работы: ${workScope || "не указан"}
• Материал предоставляет: ${materialOwner === "client" ? "заказчик (считаем только работу)" : materialOwner === "contractor" ? "исполнитель (нужно купить и включить в цену)" : "не указано"}
• Доп. услуги: ${extraServices.join(", ") || "нет"}
• Локальный калькулятор (справочно): ${localMin || 0} - ${localMax || 0} ₽
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
                    model: "openai/gpt-4o-mini",
                    messages: [
                        { role: "system", content: systemPrompt },
                        { role: "user", content: userContent },
                    ],
                    temperature: 0.3,
                    max_tokens: 3000,
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

        // Парсим JSON с новой структурой (метрики)
        const metrics = parseAiMetrics(content);

        if (!metrics) {
            console.error("Failed to parse AI metrics from content");
            const errorResponse: AiResponse = {
                aiMin: null,
                aiMax: null,
                aiFailed: true,
                reasonShort: "Ошибка AI-расчёта",
                reasonLong: "Не удалось корректно разобрать ответ нейросети. Расчёт не выполнен, требуется уточнение данных.",
                warnings: ["Проблема с форматом ответа AI"],
            };
            return new Response(JSON.stringify(errorResponse), {
                status: 200,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        console.log("AI metrics parsed:", metrics);

        // Считаем цены по метрикам локально
        const { totalMin, totalMax } = calculatePriceFromMetrics(metrics, material, workScope);

        console.log("Calculated prices:", { totalMin, totalMax });

        // Генерируем текст КП
        const { reasonShort, reasonLong } = generateProposal(
            metrics,
            material,
            workScope,
            materialOwner,
            totalMin,
            totalMax
        );

        // Формируем warnings
        const warnings: string[] = [];
        const totalLength =
            metrics.weld_length_m.linear_simple +
            metrics.weld_length_m.corner_edges +
            metrics.weld_length_m.complex_areas;

        if (totalLength === 0 || metrics.risk_level === "high") {
            warnings.push(
                "Оценка ориентировочная, для точного расчёта требуется выезд на объект или дополнительные фото."
            );
        }

        if (metrics.uncertainty_comment && metrics.uncertainty_comment.trim().length > 0) {
            warnings.push(metrics.uncertainty_comment);
        }

        // Возвращаем успешный результат
        console.log("AI calculation success:", { totalMin, totalMax, warnings });
        const successResponse: AiResponse = {
            aiMin: totalMin,
            aiMax: totalMax,
            aiFailed: false,
            reasonShort,
            reasonLong,
            warnings,
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
