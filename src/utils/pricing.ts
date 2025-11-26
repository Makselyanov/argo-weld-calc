import type { CalculationFormData } from '@/types/calculation';

export interface PriceResult {
    baseMin: number;
    baseMax: number;
    totalMin: number;
    totalMax: number;
}

export function calculatePrice(form: CalculationFormData): PriceResult {
    // Простая фейковая формула, чтобы получить реалистичную вилку.
    // Не использовать никакие внешние сервисы, только локальный расчёт.

    let base = 5000; // базовая цена

    // Учитываем тип работ
    switch (form.typeOfWork) {
        case 'cutting':
            base += 2000;
            break;
        case 'overlay':
            base += 3000;
            break;
        case 'complex':
            base += 5000;
            break;
    }

    // Материал
    if (form.material === 'stainless' || form.material === 'aluminium') {
        base += 3000;
    } else if (form.material === 'cast_iron') {
        base += 4000;
    }

    // Толщина
    if (form.thickness === 'mm_6_12') {
        base += 2000;
    } else if (form.thickness === 'gt_12') {
        base += 4000;
    }

    // Положение
    if (form.position === 'vertical' || form.position === 'overhead') {
        base += 3000;
    }

    // Условия
    if (form.conditions.includes('height')) {
        base += 2000;
    }
    if (form.conditions.includes('tight_space')) {
        base += 2000;
    }

    // Срочность
    if (form.deadline === 'urgent') {
        base *= 1.2;
    } else if (form.deadline === 'night') {
        base *= 1.4;
    }

    // Объём — если указана длина в тексте вида "8 м", попробуй вытащить число и домножить
    const volumeMatch = form.volume.match(/(\d+(\.\d+)?)/);
    if (volumeMatch) {
        const length = parseFloat(volumeMatch[1]);
        if (!Number.isNaN(length) && length > 0) {
            base += length * 500;
        }
    }

    const baseMin = Math.round(base * 0.85);
    const baseMax = Math.round(base * 1.15);

    let totalMin = baseMin;
    let totalMax = baseMax;

    // Допуслуги: каждая добавляет +10% к цене
    if (form.extraServices.length > 0) {
        const factor = 1 + form.extraServices.length * 0.1;
        totalMin = Math.round(baseMin * factor);
        totalMax = Math.round(baseMax * factor);
    }

    return { baseMin, baseMax, totalMin, totalMax };
}
