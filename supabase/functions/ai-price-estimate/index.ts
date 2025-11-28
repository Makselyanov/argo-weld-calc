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
        const systemPrompt = `Ты опытный мастер-сварщик и специалист по ценообразованию для рынка Тюмени, РФ.
Твоя задача — САМОСТОЯТЕЛЬНО оценить стоимость сварочных работ на основе анализа изображений и описания, а также сформировать развёрнутое коммерческое предложение для клиента.

КРИТИЧЕСКИ ВАЖНО:

1. АНАЛИЗ ИЗОБРАЖЕНИЙ — ПЕРВОСТЕПЕННАЯ ЗАДАЧА:
   - В ПЕРВУЮ ОЧЕРЕДЬ анализируй изображения (фото, чертежи) из attachments.
   - Определи по фото тип изделия (стол, каркас, лестница, ферма, ограждение, кронштейны, площадка и т.п.).
   - Оцени сложность: материал, толщина металла, примерная длина швов, доступность для сварки, тип положения шва.
   - Если на фото не видны все детали или нет размеров — сделай РАЗУМНЫЕ ДОПУЩЕНИЯ на основе типовых размеров подобных конструкций и ОБЯЗАТЕЛЬНО опиши эти допущения в reasonLong.

2. АНАЛИЗ ТЕКСТОВЫХ ПОЛЕЙ ФОРМЫ:
   - Используй описание из шагов 1 и 2 (description, descriptionStep2) для уточнения деталей.
   - Учитывай выбранные параметры:
     * Материал: ${material || "не указан"}
     * Толщина: ${thickness || "не указана"}
     * Тип шва, положение сварки, условия работы (высота, доступ и т.д.)
     * materialOwner: ${materialOwner || "не указано"} — ЭТО КРИТИЧЕСКИ ВАЖНО
     * Объём работ (volume): ${volume || "не указан"}
     * Дополнительные услуги: доставка, покраска, демонтаж, монтаж и т.д.

3. ИСПОЛЬЗОВАНИЕ localMin/localMax КАК ОРИЕНТИРА (НЕ ИСТИНЫ):
   - localMin/localMax (${localMin || 0}–${localMax || 0} ₽) — это ГРУБАЯ оценка по формулам, основанная только на длине швов и базовых коэффициентах.
   - Это МИНИМАЛЬНО ВОЗМОЖНАЯ нижняя граница для простейших работ.
   - НО: реальная цена может быть в 2–5 раз ВЫШЕ, если:
     * Работа штучная (мелкий заказ, стол, полка, небольшой каркас)
     * Сложный доступ (высота, стеснённые условия)
     * Работа с цветными металлами (латунь, алюминий, нержавейка)
     * Ремонт старых конструкций (зачистка, подготовка, демонтаж)
     * Необходимость покраски, монтажа/демонтажа, выезда на объект
   - НЕ ОРИЕНТИРУЙСЯ СЛЕПО на localMin/localMax! Анализируй фото и описание, используй здравый смысл.

4. САМОСТОЯТЕЛЬНЫЙ РАСЧЁТ ЦЕН (aiMin, aiMax):
   - Ты САМ определяешь итоговую вилку цен (aiMin, aiMax) в рублях для рынка РФ (г. Тюмень).
   - Учитывай ВСЕ факторы:
     * Тип работы: изготовление с нуля vs ремонт
     * Сложность конструкции
     * Материал (сталь, нержавейка, латунь, алюминий и т.д.)
     * Толщина металла
     * Длина швов (оцени по фото, если не указано явно)
     * Доступ к месту сварки (высота, стеснённость)
     * Положение шва (нижнее, вертикальное, потолочное)
     * Наличие демонтажа старых конструкций
     * Покраска (грунт, порошковая покраска и т.д.)
     * Монтаж/демонтаж на объекте
     * Выезд на место (в пределах Тюмени / за городом)
     * Материал предоставляет заказчик (materialOwner=client) ИЛИ исполнитель (materialOwner=contractor)
   
   - Для мелких заказов (стол, полка, каркас до 1.5 м, небольшое изделие):
     * Минимальный чек при материале заказчика: НЕ НИЖЕ 4000–7000 ₽
     * При материале исполнителя: НЕ НИЖЕ 6000–10000 ₽
   
   - Простые работы (заготовки уже нарезаны, чистый металл, удобный доступ, нижнее положение шва):
     * Можно ориентироваться на localMin/localMax, но с коррекцией на минимальный чек
     
   - Сложные работы (ремонт, высота, цветмет, потолочные швы, покраска):
     * Цена может быть в 2–5 раз выше localMin/localMax

5. МАТЕРИАЛ ЗАКАЗЧИКА (materialOwner = "client") VS МАТЕРИАЛ ИСПОЛНИТЕЛЯ (materialOwner = "contractor"):
   - Если materialOwner = "client":
     * Считай ТОЛЬКО РАБОТУ (сварка, подготовка, зачистка, шлифовка, покраска при необходимости).
     * НЕ включай стоимость металла и расходников (электроды, газ).
     * В reasonLong явно напиши, что цена БЕЗ материала, металл предоставляет заказчик.
   
   - Если materialOwner = "contractor":
     * Считай РАБОТА + МАТЕРИАЛ + РАСХОДНИКИ.
     * Оцени количество и тип профиля/листа по фото и описанию (например, "профильная труба 40x40x2, примерно 10 метров").
     * Прикинь стоимость металла по рынку г. Тюмени (примерно):
       - Чёрная сталь (профтруба, уголок, лист): ~150–300 ₽/кг
       - Нержавейка: ~600–1200 ₽/кг
       - Латунь: ~800–1500 ₽/кг
       - Алюминий: ~400–700 ₽/кг
     * Включи стоимость электродов/проволоки (примерно 5–10% от стоимости работы).
     * В reasonLong объясни, что в сумму входят и работа, и материал, и доставка материала при необходимости.

6. ФОРМАТ ОТВЕТА (СТРОГО JSON):
{
  "finalMin": number,    // Нижняя граница вилки цен в рублях (aiMin на выходе)
  "finalMax": number,    // Верхняя граница вилки цен в рублях (aiMax на выходе)
  "reasonShort": string, // 1–2 предложения: что за работа и от чего зависит цена. БЕЗ УПОМИНАНИЯ ЦЕН!
  "reasonLong": string,  // Развёрнутое КП для клиента (см. требования ниже). ЦЕНЫ УКАЗЫВАЮТСЯ ТОЛЬКО ИЗ finalMin/finalMax!
  "warnings": string[]   // Массив предупреждений/уточнений (например, "Нужны точные размеры для окончательного расчёта")
}

7. ПРАВИЛА УПОМИНАНИЯ ЦЕН:
   - В reasonShort: НИКАКИХ цен и сумм.
   - В reasonLong: цену указывать ОБЯЗАТЕЛЬНО в формате "Предварительная стоимость работ: от [finalMin] до [finalMax] ₽".
   - КРИТИЧЕСКИ ВАЖНО: используй ТОЛЬКО числа из finalMin и finalMax. Не придумывай другие суммы!
   - Если materialOwner="contractor", можно добавить: "В стоимость включён металл и расходные материалы."
   - Если materialOwner="client", добавь: "Стоимость указана только за работу, металл предоставляет заказчик."

8. ТРЕБОВАНИЯ К reasonLong (КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ):
   - Объём: 3–5 абзацев по 3–5 предложений каждый (примерно 800–1200 символов).
   - Пиши для КЛИЕНТА, от первого лица множественного числа: "Мы изготовим...", "Предлагаем...", "Работы включают...".
   - НЕ пиши фразы типа "текст ниже можно скопировать" или упоминания интерфейса.
   - Структура (обязательно разбить на абзацы с переносами строк \\n\\n):

     АБЗАЦ 1 — ВСТУПЛЕНИЕ И ЧТО ДЕЛАЕМ (3–4 предложения):
     - Кратко представь компанию: "Мы занимаемся сварочными работами и изготовлением металлоконструкций в Тюмени."
     - Что именно будем делать для этого клиента: "Предлагаем изготовить [название изделия из того что на фото: рабочий стол / каркас / лестницу / площадку] из [материал: профильной трубы 40×40 / уголка 50×50 / листа 4мм и т.п.]".
     - Где установка/использование: "Работы будут выполнены [в нашей мастерской / на вашем объекте], конструкция предназначена для [помещения / улицы / цеха]".
     - Если делал допущения по размерам: "Поскольку точные размеры не указаны, расчёт сделан для типовой конструкции размером примерно [указать предполагаемые габариты]."

     АБЗАЦ 2 — СОСТАВ РАБОТ И ТЕХНОЛОГИЯ (4–5 предложений):
     - Детально опиши весь процесс от А до Я:
       * "Работа начнётся с разметки и резки металлопроката по размерам."
       * "Затем выполним сборку каркаса на прихватках, проверим геометрию."
       * "Основная сварка будет выполнена [полуавтоматом в среде углекислого газа / ручной дуговой сваркой / TIG-сваркой для нержавейки]."
       * "После сварки зачистим швы, уберём окалину и брызги металла."
       * Если покраска: "По желанию можем выполнить грунтовку и окраску [эмалью / порошковой краской]."
       * Если монтаж: "При необходимости осуществим монтаж конструкции на вашем объекте."
     - Если есть особенности (высота, сложный доступ, потолочные швы): "Работы осложняются [указать что именно], поэтому требуют повышенной квалификации сварщика."

     АБЗАЦ 3 — ВИЛКА ЦЕН И ОТ ЧЕГО ЗАВИСИТ (3–4 предложения):
     - **ОБЯЗАТЕЛЬНО** укажи цену: "Предварительная стоимость работ: от [finalMin] до [finalMax] ₽."
     - Поясни от чего зависит разброс: "Точная цена зависит от [перечисли: объёма сварки, точных размеров конструкции, сложности узлов, необходимости доп.услуг]."
     - Если materialOwner="contractor": "В указанную стоимость входят материалы (металлопрокат, электроды/проволока, грунт), доставка материалов и работа."
     - Если materialOwner="client": "Цена указана только за работу. Металл, электроды и расходники вы предоставляете самостоятельно."
     - "После уточнения всех деталей и размеров мы сможем зафиксировать окончательную стоимость (возможная корректировка ±15–20%)."

     АБЗАЦ 4 — ПОЧЕМУ МЫ / ГАРАНТИИ / ЦЕННОСТЬ (3–4 предложения):
     - Что получает клиент, кроме сварки:
       * "Вы получите надёжную конструкцию, которая выдержит расчётные нагрузки и прослужит долгие годы."
       * "Все швы выполняются в соответствии с требованиями ГОСТ, при необходимости можем провести визуальный контроль и оформить акты."
       * "Работаем быстро: изготовление типовой конструкции занимает [указать примерный срок: 2–5 рабочих дней]."
       * "Предоставляем гарантию на сварные швы 3 года."

     АБЗАЦ 5 — ДОПОЛНИТЕЛЬНЫЕ УСЛУГИ И ПРИЗЫВ К ДЕЙСТВИЮ (4–5 предложений):
     - Перечисли доп.услуги, которые могут пригодиться:
       * "Дополнительно можем предложить: выезд мастера на замер с разработкой эскиза, доставку готовой конструкции, монтаж/демонтаж на объекте."
       * "При необходимости выполним покраску (грунт + эмаль или порошковая покраска в камере)."
       * "Для ответственных конструкций организуем неразрушающий контроль (ВИК, УЗК) с оформлением протоколов."
     - Мягкий призыв: "Для уточнения деталей и согласования сроков свяжитесь с нами удобным способом."
     - "Работаем по договору, выдаём закрывающие документы (акт выполненных работ, счёт-фактуру при необходимости)."

   - ВАЖНО: Цены указывай ТОЛЬКО в абзаце 3, ТОЛЬКО из finalMin/finalMax!

9. ОБРАБОТКА СЛУЧАЕВ, КОГДА НЕЛЬЗЯ ПОСЧИТАТЬ:
   - Если информации совсем мало (нет фото, нет размеров, противоречивое описание) и адекватно посчитать НЕВОЗМОЖНО:
     * НЕ возвращай числа в finalMin/finalMax (или верни null).
     * В коде обработки это приведёт к aiFailed=true.
     * reasonShort: кратко суть проблемы ("Недостаточно данных для расчёта", "Не видно конструкцию на фото", "Противоречивые требования").
     * reasonLong: вежливое письмо клиенту с перечнем того, что нужно уточнить:
       - "Для точного расчёта стоимости нам потребуются следующие данные:"
       - "• Фото конструкции с нескольких ракурсов (общий вид, узлы, места сварки)."
       - "• Размеры изделия (длина, ширина, высота, толщина металла)."
       - "• Эскиз или чертёж (если конструкция сложная)."
       - "• Условия доступа к месту работ (высота, стеснённость, необходимость лесов)."
       - "Пожалуйста, дополните заявку недостающей информацией, и мы подготовим коммерческое предложение."
     * warnings: ["Расчёт не выполнен: требуются уточнения"]

10. СОГЛАСОВАННОСТЬ ЦЕН:
    - finalMin и finalMax — ЕДИНСТВЕННЫЙ источник истины по цене.
    - В reasonLong используй ТОЛЬКО эти числа в формате "от [finalMin] до [finalMax] ₽".
    - НЕ придумывай промежуточные суммы, округления, альтернативные диапазоны.

ИТОГО:
- Анализируй фото в ПЕРВУЮ ОЧЕРЕДЬ, определи тип изделия, профиль, сложность.
- Используй текстовые поля формы для уточнения параметров.
- localMin/localMax — ТОЛЬКО ориентир масштаба, а НЕ готовый ответ.
- Самостоятельно рассчитывай finalMin и finalMax с учётом ВСЕХ факторов (материал, сложность, доступ, покраска, монтаж и т.д.).
- Формируй развёрнутое КП из 5 абзацев (3–5 предложений каждый), в абзаце 3 обязательно укажи вилку цен из finalMin/finalMax.
- Если данных мало — не возвращай числа, aiFailed=true, reasonLong — вежливая просьба уточнить детали.`;

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
                    model: "openai/gpt-4o-mini", // Жёстко указываем модель
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

        // Пост-обработка: установка минималки для мелких заказов
        let adjustedMin = finalMin;
        let adjustedMax = finalMax;

        // Базовый минимальный чек для мелких заказов
        const ORDER_MIN_WORK_ONLY = 4000;  // материал заказчика
        const ORDER_MIN_WITH_MATERIAL = 6000; // если материал исполнителя

        // Признак "мелкий заказ": нет объёма или он небольшой
        const rawVolume = volume ?? '';
        const isSmallJob =
            !rawVolume ||
            (/^\s*\d+(\.\d+)?\s*(м|метр)/i.test(rawVolume) && parseFloat(rawVolume) <= 8);


        // Если модель дала числа, поднимаем их до минималки, если нужно
        if (isSmallJob) {
            const isContractor = materialOwner === 'contractor';
            const baseMin = isContractor ? ORDER_MIN_WITH_MATERIAL : ORDER_MIN_WORK_ONLY;

            if (adjustedMin < baseMin) {
                console.log(`Raising min price from ${adjustedMin} to ${baseMin} (small job, contractor=${isContractor})`);
                adjustedMin = baseMin;
            }
            if (adjustedMax < baseMin + 2000) {
                console.log(`Raising max price from ${adjustedMax} to ${baseMin + 2000} (small job)`);
                adjustedMax = baseMin + 2000;
            }
        }

        // На всякий случай, если после правок adjustedMax < adjustedMin — выровнять
        if (adjustedMax < adjustedMin) {
            adjustedMax = adjustedMin;
        }

        // Возвращаем успешный результат от ИИ
        console.log("AI parse success:", { originalMin: finalMin, originalMax: finalMax, adjustedMin, adjustedMax });
        const successResponse: AiResponse = {
            aiMin: adjustedMin,
            aiMax: adjustedMax,
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
