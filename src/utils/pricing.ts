import type { CalculationFormData } from '@/types/calculation';
import { MATERIAL_COEFF, THICKNESS_COEFF, SEAM_TYPE_COEFF } from '@/types/calculation';

export interface PriceResult {
    baseMin: number;
    baseMax: number;
    totalMin: number;
    totalMax: number;
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

    // ============================================
    // БАЗОВЫЕ СТАВКИ ДЛЯ ЧЁРНОГО МЕТАЛЛА (steel)
    // ============================================

    // Ставки за погонный метр сварки (₽/м)
    const baseWeldRatePerMeter = 800;        // стыковые, тавровые швы
    const baseBackWeldRate = 600;            // обратная сторона шва

    // Ставки за зачистку и подготовку (₽/м)
    const baseCleanupRatePerMeter = 300;

    // Ставки за финишную обработку (₽/м²)
    const baseSatinRatePerM2 = 500;          // сатинирование
    const basePaintRatePerM2 = 400;          // покраска
    const baseVarnishRatePerM2 = 300;        // лак

    // ============================================
    // РАСЧЁТ ОБЪЁМОВ РАБОТ
    // ============================================

    // Извлекаем длину шва из объёма (например, "8 м" или "8")
    let weldLengthM = 0;
    const volumeMatch = form.volume.match(/(\d+(\.\d+)?)/);
    if (volumeMatch) {
        const length = parseFloat(volumeMatch[1]);
        if (!Number.isNaN(length) && length > 0) {
            weldLengthM = length;
        }
    }

    // Для примера, если не указано — берём минимум
    if (weldLengthM === 0) {
        weldLengthM = 1; // 1 метр по умолчанию
    }

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
    // Formula: Base * Material * Thickness * SeamType
    // ============================================

    // Сварка
    const weldCost = (weldBase + backWeldBase) * m.weld * tCoeff * sCoeff;

    // Подготовка (зачистка)
    const prepCost = cleanupBase * m.prep * tCoeff * sCoeff;

    // Финиш (сатинирование, покраска)
    // Применяем все коэффициенты, как запрошено в задании (п. 1.1)
    const finishCost = (satinBase + paintBase + varnishBase) * m.finish * tCoeff * sCoeff;

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
    // ИТОГОВАЯ ЦЕНА С ВИЛКОЙ
    // ============================================

    // Даём вилку ±10%
    const totalMin = Math.round(subtotal * 0.9);
    const totalMax = Math.round(subtotal * 1.1);

    const baseMin = totalMin;
    const baseMax = totalMax;

    return { baseMin, baseMax, totalMin, totalMax };
}
