import type { CalculationFormData } from '@/types/calculation';
import { MATERIAL_COEFF, THICKNESS_COEFF, SEAM_TYPE_COEFF } from '@/types/calculation';

export interface PriceResult {
    baseMin: number;
    baseMax: number;
    totalMin: number;
    totalMax: number;
}

export function calculatePrice(form: CalculationFormData): PriceResult {
    /**
     * Новая система расчёта с коэффициентами материалов, толщины и типа шва
     * Базовые цены указаны для чёрного металла (steel)
     */

    // 1. Коэффициенты материала
    const material = form.material ?? 'steel';
    const m = MATERIAL_COEFF[material];

    // 2. Коэффициенты толщины
    const thickness = form.thickness ?? 'unknown';
    // Если толщина не выбрана или unknown, берем 1.1 (как в константе unknown)
    const tCoeff = THICKNESS_COEFF[thickness] ?? 1.1;

    // 3. Коэффициенты типа шва
    const weldType = form.weldType ?? 'butt';
    // Если тип не выбран, считаем как стыковой (1.0)
    // В SEAM_TYPE_COEFF ключи: butt, corner, tee, lap, pipe
    // В WeldType: butt, corner, tee, lap, pipe. Совпадают.
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
