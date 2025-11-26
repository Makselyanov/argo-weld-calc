import type { CalculationFormData } from '@/types/calculation';
import { MATERIAL_COEFF } from '@/types/calculation';

export interface PriceResult {
    baseMin: number;
    baseMax: number;
    totalMin: number;
    totalMax: number;
}

export function calculatePrice(form: CalculationFormData): PriceResult {
    /**
     * Новая система расчёта с коэффициентами материалов
     * Базовые цены указаны для чёрного металла (steel)
     * Для других материалов применяются коэффициенты из MATERIAL_COEFF
     */

    // Получаем коэффициенты материала
    const material = form.material ?? 'steel';
    const m = MATERIAL_COEFF[material];

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
    // Упрощённо: обратная сторона нужна для стыковых швов
    const backWeldLengthM = form.weldType === 'butt' ? weldLengthM : 0;

    // Площадь для финишной обработки (м²)
    // Упрощённо: считаем как ширина полосы * длина
    const stripWidthM = 0.1; // 10 см полоса вдоль шва
    const areaM2 = weldLengthM * stripWidthM;

    // ============================================
    // РАСЧЁТ БАЗОВЫХ СТОИМОСТЕЙ (для чёрного металла)
    // ============================================

    const weldBase = weldLengthM * baseWeldRatePerMeter;
    const backWeldBase = backWeldLengthM * baseBackWeldRate;
    const cleanupBase = weldLengthM * baseCleanupRatePerMeter;

    // Финишная обработка зависит от требований
    let satinBase = 0;
    let paintBase = 0;
    let varnishBase = 0;

    // Упрощённо: если есть экстра-услуги, добавляем финиш
    // В реальности это должно быть отдельное поле в форме
    if (form.extraServices.length > 0) {
        satinBase = areaM2 * baseSatinRatePerM2;
    }

    // ============================================
    // ПРИМЕНЕНИЕ КОЭФФИЦИЕНТОВ МАТЕРИАЛА
    // ============================================

    const weldCost = (weldBase + backWeldBase) * m.weld;
    const prepCost = cleanupBase * m.prep;
    const finishCost = (satinBase + paintBase + varnishBase) * m.finish;

    // ============================================
    // ДОПОЛНИТЕЛЬНЫЕ МОДИФИКАТОРЫ
    // ============================================

    let subtotal = weldCost + prepCost + finishCost;

    // Учитываем тип работ
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

    // Толщина материала
    if (form.thickness === 'mm_6_12') {
        subtotal *= 1.2;
    } else if (form.thickness === 'gt_12') {
        subtotal *= 1.5;
    } else if (form.thickness === 'lt_3') {
        subtotal *= 0.9;
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
