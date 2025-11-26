import {
    TypeOfWork,
    WorkScope,
    Material,
    Thickness,
    WeldType,
    Position,
    Condition,
    MaterialOwner,
    DeadlineType,
    ExtraService
} from '@/types/calculation';

export const WORK_TYPES: { value: TypeOfWork; label: string }[] = [
    { value: 'welding', label: 'Сварка' },
    { value: 'cutting', label: 'Резка' },
    { value: 'overlay', label: 'Наплавка' },
    { value: 'grinding', label: 'Зачистка' },
    { value: 'complex', label: 'Комплекс' },
];

/**
 * Режим работы с заготовкой
 * Влияет на итоговую стоимость через коэффициенты в pricing.ts
 */
export const WORK_SCOPES: { value: WorkScope; label: string; description: string }[] = [
    { 
        value: 'from_scratch', 
        label: 'Изготовление с нуля',
        description: 'Разметка, резка, подготовка кромок, подгонка, сборка, сварка'
    },
    { 
        value: 'pre_cut', 
        label: 'Сварка из заготовок',
        description: 'Детали уже нарезаны, нужна только сборка и сварка'
    },
    { 
        value: 'rework', 
        label: 'Переделка/ремонт',
        description: 'Разборка, удаление старых швов, доработка, сварка'
    },
];

export const MATERIALS: { value: Material; label: string }[] = [
    { value: 'steel', label: 'Черный металл' },
    { value: 'stainless', label: 'Нержавейка' },
    { value: 'aluminium', label: 'Алюминий' },
    { value: 'cast_iron', label: 'Чугун' },
    { value: 'copper', label: 'Медь' },
    { value: 'brass', label: 'Латунь' },
    { value: 'titanium', label: 'Титан' },
];

export const THICKNESSES: { value: Thickness; label: string }[] = [
    { value: 'lt_3', label: 'до 3 мм' },
    { value: 'mm_3_6', label: '3–6 мм' },
    { value: 'mm_6_12', label: '6–12 мм' },
    { value: 'gt_12', label: '12+ мм' },
    { value: 'unknown', label: 'Не знаю' },
];

export const WELD_TYPES: { value: WeldType; label: string }[] = [
    { value: 'butt', label: 'Стыковой' },
    { value: 'corner', label: 'Угловой' },
    { value: 'tee', label: 'Тавровый' },
    { value: 'lap', label: 'Нахлёст' },
    { value: 'pipe', label: 'Труба-труба' },
];

export const POSITIONS: { value: Position; label: string }[] = [
    { value: 'flat', label: 'Нижнее' },
    { value: 'vertical', label: 'Вертикальное' },
    { value: 'overhead', label: 'Потолочное' },
    { value: 'mixed', label: 'Смешанное' },
];

export const CONDITIONS: { value: Condition; label: string }[] = [
    { value: 'indoor', label: 'В помещении' },
    { value: 'outdoor', label: 'На улице' },
    { value: 'height', label: 'Высота/леса' },
    { value: 'tight_space', label: 'Стеснённый доступ' },
];

export const MATERIAL_OWNERS: { value: MaterialOwner; label: string }[] = [
    { value: 'client', label: 'Материал заказчика' },
    { value: 'contractor', label: 'Материал исполнителя' },
];

export const DEADLINES: { value: DeadlineType; label: string }[] = [
    { value: 'normal', label: 'Обычно' },
    { value: 'urgent', label: 'Срочно' },
    { value: 'night', label: 'Ночью/сменами' },
];

export const EXTRA_SERVICES: { value: ExtraService; label: string }[] = [
    { value: 'vik', label: 'ВИК' },
    { value: 'ut', label: 'УЗК' },
    { value: 'pressure_test', label: 'Опрессовка' },
    { value: 'soap_test', label: 'Проверка мылом' },
    { value: 'docs', label: 'Акты и протоколы' },
];

export const getLabel = <T extends string>(value: T | null | undefined, options: { value: T; label: string }[]) => {
    if (!value) return null;
    return options.find(o => o.value === value)?.label || value;
};
