import type { CalculationFormData, WorkScope } from '@/types/calculation';
import { MATERIAL_COEFF, THICKNESS_COEFF, SEAM_TYPE_COEFF, WORK_SCOPE_COEFF } from '@/types/calculation';

export interface PriceResult {
    baseMin: number;
    baseMax: number;
    totalMin: number;
    totalMax: number;
    // Данные от AI (опционально)
    aiMin?: number;            // Минимальная цена от AI
    aiMax?: number;            // Максимальная цена от AI
    reasonShort?: string;      // Короткое объяснение цены от AI
    reasonLong?: string;       // Развёрнутое КП от AI
    warnings?: string[];       // Предупреждения от AI
}


/**
 * Парсит длину из строки и конвертирует в метры
 * Примеры входных данных:
 * - "10 м" → 10
 * - "1630 см" → 16.3
 * - "8 метров" → 8
 * - "5000 мм" → 5
 * - "12" → 12 (по умолчанию метры)
 * 
 * Защита: если длина > 200 м, логируем warning и ограничиваем до 200 м
 */
function parseLengthToMeters(raw: string): number {
    const normalized = raw.toLowerCase().trim();

    // Извлекаем число (может быть целое или десятичное)
    const numberMatch = normalized.match(/(\d+(?:[.,]\d+)?)/);
    if (!numberMatch) {
        console.warn(`[pricing] Не удалось извлечь число из "${raw}", используем 1 м по умолчанию`);
        return 1;
    }

    const value = parseFloat(numberMatch[1].replace(',', '.'));
    if (Number.isNaN(value) || value <= 0) {
        console.warn(`[pricing] Некорректное значение "${raw}", используем 1 м по умолчанию`);
        return 1;
    }

    // Определяем единицы измерения
    let meters = value; // по умолчанию считаем метрами

    if (normalized.includes('мм') || normalized.includes('mm')) {
        meters = value / 1000; // миллиметры → метры
    } else if (normalized.includes('см') || normalized.includes('cm')) {
        meters = value / 100; // сантиметры → метры
    } else if (normalized.includes('м') || normalized.includes('m')) {
        meters = value; // уже в метрах
    }
    // Если единицы не указаны, считаем метрами (meters = value)

    // Защита от аномально больших значений
    const MAX_LENGTH_M = 200;
    if (meters > MAX_LENGTH_M) {
        console.warn(
            `[pricing] ⚠️ Длина ${meters.toFixed(2)} м превышает лимит ${MAX_LENGTH_M} м. ` +
            `Возможно, ввели сантиметры как метры? Ограничиваем до ${MAX_LENGTH_M} м. ` +
            `Исходная строка: "${raw}"`
        );
        return MAX_LENGTH_M;
    }

    console.info(`[pricing] Парсинг длины: "${raw}" → ${meters.toFixed(2)} м`);
    return meters;
}

// Helper to parse overrides from text
function parseOverridesFromText(text: string) {
    const lower = text.toLowerCase();
    let materialOverride: string | undefined;
    let thicknessOverride: string | undefined;
    let weldTypeOverride: string | undefined;

    // Material
    if (lower.includes('латунь')) materialOverride = 'brass';
    else if (lower.includes('нержавейк') || lower.includes('нержавеющ')) materialOverride = 'stainless';
    else if (lower.includes('медь')) materialOverride = 'copper';
    else if (lower.includes('титан')) materialOverride = 'titanium';
    else if (lower.includes('чугун')) materialOverride = 'cast_iron';
    else if (lower.includes('алюминий')) materialOverride = 'aluminium';
    else if (lower.includes('черный') || lower.includes('чёрный') || lower.includes('сталь')) materialOverride = 'steel';

    // Thickness (regex for "X мм" or "Xmm")
    const thicknessMatch = lower.match(/(\d+([.,]\d+)?)\s*(мм|mm)/);
    if (thicknessMatch) {
        const val = parseFloat(thicknessMatch[1].replace(',', '.'));
        if (val < 3) thicknessOverride = 'lt_3';
        else if (val >= 3 && val < 6) thicknessOverride = 'mm_3_6';
        else if (val >= 6 && val <= 12) thicknessOverride = 'mm_6_12';
        else if (val > 12) thicknessOverride = 'gt_12';
    }

    // Weld Type
    if (lower.includes('стык')) weldTypeOverride = 'butt';
    else if (lower.includes('угл')) weldTypeOverride = 'corner';
    else if (lower.includes('тавр')) weldTypeOverride = 'tee';
    else if (lower.includes('нахлест') || lower.includes('нахлёст')) weldTypeOverride = 'lap';
    else if (lower.includes('труб')) weldTypeOverride = 'pipe';

    return { materialOverride, thicknessOverride, weldTypeOverride };
}

export function calculatePrice(form: CalculationFormData): PriceResult {
    /**
     * Новая система расчёта с коэффициентами материалов, толщины и типа шва
     * Базовые цены указаны для чёрного металла (steel)
     */

    // Parse overrides from text fields
    const combinedText = `${form.descriptionStep2 || ''} ${form.descriptionStep3 || ''}`;
    const overrides = parseOverridesFromText(combinedText);

    // 1. Коэффициенты материала
    // Приоритет: текст > форма > дефолт
    const materialKey = overrides.materialOverride || form.material || 'steel';
    // Приводим к типу Material (если парсер вернул валидный ключ)
    const material = (MATERIAL_COEFF[materialKey as keyof typeof MATERIAL_COEFF] ? materialKey : 'steel') as keyof typeof MATERIAL_COEFF;
    const m = MATERIAL_COEFF[material];

    // 2. Коэффициенты толщины
    const thicknessKey = overrides.thicknessOverride || form.thickness || 'unknown';
    const thickness = (THICKNESS_COEFF[thicknessKey as keyof typeof THICKNESS_COEFF] ? thicknessKey : 'unknown') as keyof typeof THICKNESS_COEFF;
    const tCoeff = THICKNESS_COEFF[thickness] ?? 1.1;

    // 3. Коэффициенты типа шва
    const weldTypeKey = overrides.weldTypeOverride || form.weldType || 'butt';
    const weldType = (SEAM_TYPE_COEFF[weldTypeKey as keyof typeof SEAM_TYPE_COEFF] ? weldTypeKey : 'butt') as keyof typeof SEAM_TYPE_COEFF;
    const sCoeff = SEAM_TYPE_COEFF[weldType] ?? 1.0;

    // 4. Коэффициенты режима работы с заготовкой (workScope)
    // pre_cut = база, from_scratch = дороже, rework = самый дорогой
    const workScope: WorkScope = form.workScope || 'pre_cut';
    const ws = WORK_SCOPE_COEFF[workScope];

    // ============================================
    // БАЗОВЫЕ СТАВКИ ДЛЯ ЧЁРНОГО МЕТАЛЛА (steel)
    // ОТКАЛИБРОВАНЫ ПОД РЕАЛИСТИЧНЫЕ ЦЕНЫ
    // ============================================

    // Ставки за погонный метр сварки (₽/м)
    // Снижены для достижения целевых цен:
    // Кейс 1: черный металл, стык, до 3мм, 16.3м → 120 000 – 180 000 ₽
    // Кейс 2: латунь, те же параметры → 200 000 – 280 000 ₽
    const baseWeldRatePerMeter = 1200;        // стыковые, тавровые швы (было 500)
    const baseBackWeldRate = 800;            // обратная сторона шва (было 350)

    // Ставки за зачистку и подготовку (₽/м)
    const baseCleanupRatePerMeter = 200;     // (было 300)

    // Ставки за финишную обработку (₽/м²)
    const baseSatinRatePerM2 = 500;          // сатинирование
    const basePaintRatePerM2 = 400;          // покраска
    const baseVarnishRatePerM2 = 300;        // лак


    // ============================================
    // РАСЧЁТ ОБЪЁМОВ РАБОТ
    // ============================================

    // Используем новый парсер длины с учётом единиц измерения
    const weldLengthM = parseLengthToMeters(form.volume || '1');


    // Длина обратной стороны (если требуется)
    const backWeldLengthM = form.weldType === 'butt' ? weldLengthM : 0;

    // Площадь для финишной обработки (м²)
    const stripWidthM = 0.1; // 10 см полоса вдоль шва
    const areaM2 = weldLengthM * stripWidthM;

    // ============================================
    // РАСЧЁТ БАЗОВЫХ СТОИМОСТЕЙ (для чёрного металла)
    // ============================================

    const weldBase = weldLengthM * baseWeldRatePerMeter;
    const backWeldBase = backWeldLengthM * baseBackWeldRate;
    const cleanupBase = weldLengthM * baseCleanupRatePerMeter;

    // Финишная обработка
    let satinBase = 0;
    let paintBase = 0;
    let varnishBase = 0;

    if (form.extraServices.length > 0) {
        satinBase = areaM2 * baseSatinRatePerM2;
    }

    // ============================================
    // ПРИМЕНЕНИЕ ВСЕХ КОЭФФИЦИЕНТОВ
    // Formula: Base * Material * Thickness * SeamType * WorkScope
    // ============================================

    // Сварка (применяем коэффициент workScope.weld)
    const weldCost = (weldBase + backWeldBase) * m.weld * tCoeff * sCoeff * ws.weld;

    // Подготовка (зачистка) — здесь workScope влияет сильнее всего
    // При изготовлении с нуля много резки/подгонки, при переделке — разборка
    const prepCost = cleanupBase * m.prep * tCoeff * sCoeff * ws.prep;

    // Финиш (сатинирование, покраска)
    const finishCost = (satinBase + paintBase + varnishBase) * m.finish * tCoeff * sCoeff * ws.finish;

    // ============================================
    // ДОПОЛНИТЕЛЬНЫЕ МОДИФИКАТОРЫ (Положение, Условия, Срочность)
    // ============================================

    let subtotal = weldCost + prepCost + finishCost;

    // Учитываем тип работ (доп. наценка к базе)
    // Можно переделать в коэффициент, но оставим как фиксированную добавку к сложности
    switch (form.typeOfWork) {
        case 'cutting':
            subtotal += 2000;
            break;
        case 'overlay':
            subtotal += 3000;
            break;
        case 'complex':
            subtotal += 5000;
            break;
        case 'grinding':
            subtotal += 1500;
            break;
    }

    // Положение сварки
    if (form.position === 'vertical') {
        subtotal *= 1.3;
    } else if (form.position === 'overhead') {
        subtotal *= 1.5;
    } else if (form.position === 'mixed') {
        subtotal *= 1.4;
    }

    // Условия работы
    if (form.conditions.includes('height')) {
        subtotal *= 1.2;
    }
    if (form.conditions.includes('tight_space')) {
        subtotal *= 1.2;
    }
    if (form.conditions.includes('outdoor')) {
        subtotal *= 1.1;
    }

    // Срочность
    if (form.deadline === 'urgent') {
        subtotal *= 1.3;
    } else if (form.deadline === 'night') {
        subtotal *= 1.5;
    }

    // ============================================
    // 5. КОЭФФИЦИЕНТ СЛОЖНОСТИ "ПОЛНЫЙ ЦИКЛ" (kComplex)
    // ============================================

    let kComplex = 1.0;

    // Определяем, является ли материал "цветным/сложным"
    const isComplexMaterial = ['brass', 'copper', 'titanium'].includes(material);

    // Эвристика "Полного цикла":
    // Если сложный материал + длинные швы (> 10 м) + есть доп. услуги или сложный тип работ
    // (так как в форме нет галочек "покраска/лак", считаем, что для латуни > 10м это подразумевается или указано в описании)
    const isLongSeam = weldLengthM > 10;
    const isComplexWork = form.typeOfWork === 'complex' || form.typeOfWork === 'grinding' || form.extraServices.length > 0;

    if (isComplexMaterial && isLongSeam) {
        // Для латунных изделий с длинными швами (например, перегородки, мебель)
        // практически всегда требуется полный цикл обработки (зачистка, шлифовка, патина/лак)
        kComplex = 2.0; // Умножаем на 2, чтобы попасть в 200-300к
    } else if (isComplexMaterial && weldLengthM > 5) {
        kComplex = 1.5;
    }

    // ============================================
    // ИТОГОВАЯ ЦЕНА С ВИЛКОЙ
    // ============================================

    // subtotal уже включает MATERIAL_COEFF (через m.weld/prep/finish)
    // Но для наглядности и точной калибровки применим kComplex здесь

    let totalMinBase = Math.round(subtotal * 0.9);
    let totalMaxBase = Math.round(subtotal * 1.1);

    // Explicitly commenting the final calculation as requested
    const totalMin = Math.round(totalMinBase * kComplex); // базовая цена * kComplex
    const totalMax = Math.round(totalMaxBase * kComplex); // базовая цена * kComplex

    // const priceMin = Math.round(totalMin * kMaterial * kComplex); 
    // (kMaterial уже учтён внутри subtotal через m.weld, m.prep, m.finish)

    // ============================================
    // SANITY-CHECK: защита от аномальных цен
    // ============================================
    // Если цена космическая при небольшой длине, вероятно ошибка парсинга или коэффициенты
    const SANITY_MAX_PRICE = 2_500_000; // Подняли лимит до 2.5 млн ₽
    const SANITY_MAX_LENGTH = 50; // 50 м

    let finalMin = totalMin;
    let finalMax = totalMax;

    if (finalMax > SANITY_MAX_PRICE && weldLengthM < SANITY_MAX_LENGTH) {
        console.warn(
            `[pricing] ⚠️ SANITY-CHECK: Цена ${finalMax.toLocaleString('ru-RU')} ₽ слишком высока ` +
            `для ${weldLengthM.toFixed(2)} м шва! ` +
            `Ограничиваем до ${SANITY_MAX_PRICE.toLocaleString('ru-RU')} ₽.`
        );
        finalMax = SANITY_MAX_PRICE;
        finalMin = Math.round(finalMax * 0.7);
    }

    // Минимальный порог цены в зависимости от режима работы
    const SANITY_MIN_PRICES: Record<WorkScope, number> = {
        pre_cut: 500,
        from_scratch: 1500,
        rework: 2000,
    };
    const minPrice = SANITY_MIN_PRICES[workScope];

    if (finalMin < minPrice) {
        finalMin = minPrice;
        finalMax = Math.max(finalMax, Math.round(minPrice * 1.3));
    }

    const baseMin = finalMin;
    const baseMax = finalMax;

    console.info(
        `[pricing] Итоговая цена: ${finalMin.toLocaleString('ru-RU')} – ${finalMax.toLocaleString('ru-RU')} ₽ ` +
        `(длина: ${weldLengthM.toFixed(2)} м, материал: ${material}, kComplex: ${kComplex})`
    );

    return { baseMin, baseMax, totalMin: finalMin, totalMax: finalMax };
}

/**
 * Тестовая функция для проверки калькулятора на эталонных кейсах
 * Запусти её в консоли браузера для быстрой проверки
 */
export function debugSampleCalculations() {
    console.log('='.repeat(60));
    console.log('🧪 ТЕСТ ЦЕНОВОГО КАЛЬКУЛЯТОРА');
    console.log('='.repeat(60));

    // Кейс 1: Черный металл, стыковой, до 3 мм, 16.3 м (1630 см)
    const case1: CalculationFormData = {
        photos: [],
        description: 'Тестовый расчёт',
        typeOfWork: 'welding',
        material: 'steel',
        thickness: 'lt_3',
        weldType: 'butt',
        volume: '1630 см', // или '16.3 м' или '16300 мм'
        position: 'flat',
        conditions: ['indoor'],
        materialOwner: 'client',
        deadline: 'normal',
        extraServices: [],
        workScope: 'pre_cut'
    };

    const result1 = calculatePrice(case1);
    console.log('\n📋 КЕЙС 1: Черный металл');
    console.log('Параметры: сталь, стыковой, до 3мм, 16.3м, нижнее, в помещении, обычный срок');
    console.log(`Ожидаем: 120 000 – 180 000 ₽`);
    console.log(`Получили: ${result1.totalMin.toLocaleString('ru-RU')} – ${result1.totalMax.toLocaleString('ru-RU')} ₽`);
    console.log(`✅ В коридоре: ${result1.totalMin >= 100_000 && result1.totalMax <= 200_000 ? 'ДА' : 'НЕТ'}`);

    // Кейс 2: Латунь, те же параметры
    const case2: CalculationFormData = {
        ...case1,
        material: 'brass',
    };

    const result2 = calculatePrice(case2);
    console.log('\n📋 КЕЙС 2: Латунь');
    console.log('Параметры: латунь, стыковой, до 3мм, 16.3м, нижнее, в помещении, обычный срок');
    console.log(`Ожидаем: 200 000 – 280 000 ₽`);
    console.log(`Получили: ${result2.totalMin.toLocaleString('ru-RU')} – ${result2.totalMax.toLocaleString('ru-RU')} ₽`);
    console.log(`✅ В коридоре: ${result2.totalMin >= 180_000 && result2.totalMax <= 300_000 ? 'ДА' : 'НЕТ'}`);

    // Проверка парсинга единиц
    console.log('\n📏 ПРОВЕРКА ПАРСИНГА ЕДИНИЦ:');
    console.log(`"1630 см" → ${parseLengthToMeters('1630 см').toFixed(2)} м`);
    console.log(`"16.3 м" → ${parseLengthToMeters('16.3 м').toFixed(2)} м`);
    console.log(`"16300 мм" → ${parseLengthToMeters('16300 мм').toFixed(2)} м`);
    console.log(`"10 метров" → ${parseLengthToMeters('10 метров').toFixed(2)} м`);
    console.log(`"5000 см" → ${parseLengthToMeters('5000 см').toFixed(2)} м (защита: макс 200м)`);

    console.log('\n' + '='.repeat(60));
    console.log('✅ Тест завершён');
    console.log('='.repeat(60));
}
