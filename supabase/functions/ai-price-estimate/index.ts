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
 * Расчёт цены по метрикам и тарифам (НОВАЯ ВЕРСИЯ)
 */
function calculatePriceFromMetrics(
    metrics: AiMetricsResponse,
    material: string
): {
    baseMin: number;
    baseMax: number;
    finalMin: number;
    finalMax: number;
    materialMult: number;
    difficultyMult: number;
    finishingMult: number;
} {
    const { weld_length_m, difficulty_coeff, finishing_hours, prep_hours, welding_hours } = metrics;
    const weldLengthM = weld_length_m.linear_simple + weld_length_m.corner_edges + weld_length_m.complex_areas;

    // Если швов нет вообще - возвращаем минимальную оценку по часам (fallback)
    if (weldLengthM === 0) {
        const hourlyMin = prep_hours * 800 + welding_hours * 1000 + finishing_hours * 800;
        const hourlyMax = hourlyMin * 1.3;
        return {
            baseMin: 0,
            baseMax: 0,
            finalMin: Math.round(hourlyMin),
            finalMax: Math.round(hourlyMax),
            materialMult: 1.0,
            difficultyMult: 1.0,
            finishingMult: 1.0
        };
    }

    const baseMinPerM = 600;   // базовая сталь, низ границы
    const baseMaxPerM = 1000;  // базовая сталь, верх границы

    const baseMin = weldLengthM * baseMinPerM;
    const baseMax = weldLengthM * baseMaxPerM;

    // materialMult
    const normalizedMaterial = (material || "").toLowerCase();
    let materialMult = 1.0;

    const is = (str: string) => normalizedMaterial.includes(str);

    if (is("нерж") || is("stainless") || is("inox")) {
        materialMult = 1.5;
    } else if (is("алюмин") || is("aluminum") || is("aluminium")) {
        materialMult = 1.8;
    } else if (
        is("латун") || is("brass") ||
        is("медь") || is("copper") ||
        is("бронз") || is("bronze")
    ) {
        // Цветные металлы: латунь/медь/бронза
        // КАЛИБРОВКА: Чтобы для 17.3м шва (эталон) получить ~180-300к, нужен множитель около 4.0
        // (17.3 * 600 * 4.0 * 1.5 * 3.0 = 186,840)
        materialMult = 4.0;
    } else {
        materialMult = 1.0; // steel, black_steel
    }

    // difficultyMult по коэффициенту ИИ
    let difficultyMult = difficulty_coeff ?? 1.0;
    if (difficultyMult < 1.0) difficultyMult = 1.0;
    if (difficultyMult > 1.5) difficultyMult = 1.5;

    // finishingMult по finishing_hours
    let finishingMult = 1.0;
    if (finishing_hours > 0 && finishing_hours < 4) {
        finishingMult = 1.1;
    } else if (finishing_hours >= 4 && finishing_hours < 10) {
        finishingMult = 1.5;
    } else if (finishing_hours >= 10 && finishing_hours <= 20) {
        finishingMult = 2.5;
    } else if (finishing_hours > 20) {
        finishingMult = 3.0;
    }

    const rawMin = baseMin * materialMult * difficultyMult * finishingMult;
    const rawMax = baseMax * materialMult * difficultyMult * finishingMult;

    const finalMin = Math.round(rawMin / 10) * 10;
    const finalMax = Math.round(rawMax / 10) * 10;

    return { baseMin, baseMax, finalMin, finalMax, materialMult, difficultyMult, finishingMult };
}

/**
 * Генерация текста КП на основе метрик и рассчитанных цен
 */
function generateProposal(
    metrics: AiMetricsResponse,
    material: string,
    workScope: string,
    materialOwner: string,
    priceData: {
        baseMin: number;
        baseMax: number;
        finalMin: number;
        finalMax: number;
        materialMult: number;
        difficultyMult: number;
        finishingMult: number;
    }
): { reasonShort: string; reasonLong: string } {
    const { weld_length_m, difficulty_coeff, explanation_for_client } = metrics;

    const totalLength = weld_length_m.linear_simple + weld_length_m.corner_edges + weld_length_m.complex_areas;
    const materialLower = (material || "сталь").toLowerCase();

    // Определяем, является ли материал цветным металлом
    const isColoredMetal =
        materialLower.includes("латун") ||
        materialLower.includes("медь") ||
        materialLower.includes("бронз") ||
        materialLower.includes("brass") ||
        materialLower.includes("copper") ||
        materialLower.includes("bronze");

    const isColoredOrStainless =
        isColoredMetal ||
        materialLower.includes("нерж") ||
        materialLower.includes("stainless");

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

    // 2. Описание работ
    paragraphs.push(explanation_for_client);

    // 3. Блок стоимости
    paragraphs.push(
        `Предварительная стоимость работ: от ${priceData.finalMin.toLocaleString("ru-RU")} до ${priceData.finalMax.toLocaleString("ru-RU")} ₽. ` +
        "Точная сумма зависит от объёма сварки, сложности узлов и необходимости дополнительных услуг."
    );

    // 4. Арифметика (синхронизирована с расчётом)
    const baseMinPerM = 600;
    const baseMaxPerM = 1000;

    paragraphs.push(
        `Арифметика: суммарная длина швов – ${totalLength.toFixed(1)} м. ` +
        `Базовая ставка за метр шва – ${baseMinPerM}–${baseMaxPerM} ₽/м. ` +
        `Множители: материал ×${priceData.materialMult.toFixed(1)}, сложность ×${priceData.difficultyMult.toFixed(1)}` +
        (priceData.finishingMult > 1.0 ? `, финишная обработка ×${priceData.finishingMult.toFixed(1)}` : ``) + `. ` +
        `Итоговый диапазон: ${priceData.finalMin.toLocaleString("ru-RU")}–${priceData.finalMax.toLocaleString("ru-RU")} ₽.`
    );

    // 5. Вредность для цветных металлов
    if (isColoredOrStainless) {
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

        // Формируем системный промпт
        const systemPrompt = `Ты профессиональный инженер-сварщик с опытом 15+ лет в Тюмени, Россия.
Твоя задача — по фото и описанию оценить объём и сложность сварочных работ.

ВАЖНО: ты НЕ считаешь финальную цену в рублях. Твоя задача — вернуть точные метрики (длины швов, часы работ, коэффициенты сложности). Цены рассчитает мой локальный калькулятор на основе твоих метрик.

────────────────────────────────────────────────────────────
1. СТРУКТУРА РАСЧЁТА
────────────────────────────────────────────────────────────
Внутри себя ты:
  а) анализируешь фото/чертежи/описание;
  б) определяешь длину швов (простые, угловые, сложные зоны);
  в) оцениваешь трудоёмкость (подготовка, сварка, финишная обработка);
  г) учитываешь условия работ (на высоте, в стеснённых условиях и т.п.);
  д) учитываешь вредность материала (пары цинка/свинца/меди при сварке латуни/бронзы/меди).

Наружу возвращаешь ТОЛЬКО JSON с метриками (см. ниже).

────────────────────────────────────────────────────────────
2. ФОРМУЛА РАСЧЁТА (локальный калькулятор)
────────────────────────────────────────────────────────────
Калькулятор считает по формуле:
  baseMin = weldLengthM × 600 ₽/м
  baseMax = weldLengthM × 1000 ₽/м
  finalMin = baseMin × materialMult × difficultyMult × finishingMult
  finalMax = baseMax × materialMult × difficultyMult × finishingMult

Множители материалов (materialMult):
  • Чёрная сталь: 1.0
  • Нержавейка: 1.5
  • Алюминий: 1.8
  • Латунь / медь / бронза: 4.0 (ВРЕДНОСТЬ + СЛОЖНОСТЬ)

Коэффициент сложности (difficultyMult):
  • Твой difficulty_coeff (0.8–1.5) передаётся как есть

Коэффициент финишинга (finishingMult):
  • Если finishing_hours = 0 → finishingMult = 1.0
  • Если finishing_hours < 4 → finishingMult = 1.1
  • Если finishing_hours 4-10 → finishingMult = 1.5
  • Если finishing_hours 10-20 → finishingMult = 2.5
  • Если finishing_hours > 20 → finishingMult = 3.0

────────────────────────────────────────────────────────────
3. ЭТАЛОННЫЙ КЕЙС ДЛЯ КАЛИБРОВКИ
────────────────────────────────────────────────────────────
Материал: латунь, TIG
Длина швов: 17.3 м (например: linear_simple=10, corner_edges=5, complex_areas=2.3)
Операции: резка/подгонка, зачистка, сварка с двух сторон, сатинирование, полосы, лак
Часы: prep_hours ≈ 8, welding_hours ≈ 12, finishing_hours ≈ 15-20
Коэффициент сложности: difficulty_coeff ≈ 1.4–1.5

ОЖИДАЕМЫЙ РЕЗУЛЬТАТ: итоговая цена 180,000–300,000 ₽

Проверка (для ИИ):
  base: 17.3 × 600 = 10,380
  ×4.0 (латунь) × 1.5 (сложность) × 3.0 (финишинг > 20ч) = 186,840 ₽ (Минимум)
  Это попадает в целевой диапазон!

ПРАВИЛО: Если видишь латунное изделие с ПОЛНЫМ циклом обработки (зачистка, сатинирование, лак, покраска),
то finishing_hours должны быть не менее 15-20 часов, чтобы итоговая цена была корректной.

────────────────────────────────────────────────────────────
4. ПРАВИЛА ДЛЯ ЦВЕТНЫХ МЕТАЛЛОВ
────────────────────────────────────────────────────────────
▸ Сварка латунных, медных, бронзовых швов выполняется аргонодуговой сваркой (TIG).
▸ Эти работы ВРЕДНЫЕ: выделяются пары цинка, свинца, меди → требуются СИЗ и вентиляция.
▸ Локальный калькулятор автоматически применит materialMult = 4.0 для латуни.

▸ При определении длины швов для ЛИСТОВЫХ изделий (таблички, перегородки, мемориалы):
   • считай ВСЕ стыки листов (периметр + внутренние соединения);
   • НЕ занижай длину швов, если видишь большое изделие;
   • для таблички/мемориала размером ~1×1 м длина швов обычно 15-25 м (рамка + внутренние крепления + обратная сторона).

▸ Для латунных мемориалов с ПОЛНЫМ циклом обработки:
   • difficulty_coeff: 1.4–1.5
   • finishing_hours: 15–20 (зачистка, сатинирование, покраска, лак — каждый этап занимает время!)
   • НЕ ЗАНИЖАЙ finishing_hours, иначе цена будет сильно ниже рыночной.

────────────────────────────────────────────────────────────
5. ФОРМАТ JSON-ОТВЕТА
────────────────────────────────────────────────────────────
Тебе приходят:
- город (Тюмень, Россия),
- материал ("steel" / "stainless" / "aluminum" / "brass" / "copper" / "bronze"),
- толщина,
- условия работ,
- тип задачи (from_scratch / repair / from_blanks),
- краткое текстовое описание,
- ссылка на фотографии/изображения конструкции,
- localMin/localMax (справочная база, можешь игнорировать).

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
  "finishing_hours": number,    // зачистка, сатинирование, покраска, лак и т.п. (для эталона латунь+полный цикл = 15-20 часов!)
  "risk_level": "low" | "medium" | "high",
  "uncertainty_comment": "string",   // что может измениться или чего не видно
  "explanation_for_client": "string" // развёрнутое объяснение (3–5 предложений), из чего складывается объём и сложность
}

Никаких других полей, никакого текста вне JSON.

────────────────────────────────────────────────────────────
6. ДОПОЛНИТЕЛЬНЫЕ ПРАВИЛА
────────────────────────────────────────────────────────────
• Если по фото/описанию невозможно определить длины швов, верни все числовые метрики как 0 и подробно опиши в uncertainty_comment, что требуется.
• difficulty_coeff: 0.8 (очень просто), 1.0 (норма), 1.2 (средняя сложность), 1.4 (сложно), 1.5 (очень сложно).
• Часы указывай реалистично. Например, для 5 м простых швов: prep_hours = 1.5, welding_hours = 2, finishing_hours = 1.
• finishing_hours — это РЕАЛЬНОЕ время на каждый этап: зачистка швов, шлифовка, сатинирование, покраска, лак. Для латунного мемориала с полным циклом это может быть 15-20 часов!
• В explanation_for_client напиши развёрнутый текст (3–5 предложений) о том, что именно варим, в каких условиях, какая технология используется (для цветных металлов обязательно упомяни аргонодуговую сварку TIG), какие особенности материала и конструкции.
`;

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

        // Считаем цены по метрикам локально (НОВАЯ ФОРМУЛА)
        const priceData = calculatePriceFromMetrics(metrics, material);

        console.log("Calculated prices:", priceData);

        // Генерируем текст КП
        const { reasonShort, reasonLong } = generateProposal(
            metrics,
            material,
            workScope,
            materialOwner,
            priceData
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
        // ВАЖНО: aiMin/aiMax теперь равны finalMin/finalMax
        console.log("AI calculation success:", { ...priceData, warnings });
        const successResponse: AiResponse = {
            aiMin: priceData.finalMin,
            aiMax: priceData.finalMax,
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
