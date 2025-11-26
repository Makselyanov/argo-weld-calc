export type TypeOfWork = 'welding' | 'cutting' | 'overlay' | 'grinding' | 'complex';

export type Material =
  | 'steel'        // черный металл
  | 'stainless'    // нержавейка
  | 'aluminium'    // алюминий
  | 'cast_iron'    // чугун
  | 'copper'       // медь
  | 'brass'        // латунь
  | 'titanium';    // титан

/**
 * Коэффициенты стоимости для разных материалов по типам операций
 * ОТКАЛИБРОВАНЫ ПОД РЕАЛИСТИЧНЫЕ ЦЕНЫ:
 * Кейс 1 (черный металл, стык, до 3мм, 16.3м): 120 000 – 180 000 ₽
 * Кейс 2 (латунь, те же параметры): 200 000 – 280 000 ₽
 * 
 * Латунь дороже стали в 1.5-2 раза, но НЕ в 10 раз
 * 
 * weld - сварка (включая обратную сторону)
 * prep - зачистка, подготовка
 * finish - сатинирование, покраска, лак
 */
export const MATERIAL_COEFF = {
  steel: { weld: 1.0, prep: 1.0, finish: 1.0 },
  stainless: { weld: 1.35, prep: 1.25, finish: 1.15 },
  aluminium: { weld: 1.4, prep: 1.25, finish: 1.1 },
  cast_iron: { weld: 1.6, prep: 1.4, finish: 1.1 },
  copper: { weld: 1.5, prep: 1.3, finish: 1.15 },
  brass: { weld: 1.8, prep: 1.4, finish: 1.2 }, // латунь теперь 1.8x от стали
  titanium: { weld: 2.0, prep: 1.5, finish: 1.25 },
} as const;

export const THICKNESS_COEFF = {
  "lt_3": 1.0,       // до 3 мм - БАЗА (самое частое)
  "mm_3_6": 1.15,    // 3-6 мм - немного сложнее
  "mm_6_12": 1.3,    // 6-12 мм - средняя сложность
  "gt_12": 1.5,      // 12+ мм - толстый металл
  "unknown": 1.15    // среднее значение
} as const;

export const SEAM_TYPE_COEFF = {
  butt: 1.0,         // стыковой - база
  corner: 1.1,       // угловой
  tee: 1.1,          // тавровый
  lap: 1.05,         // нахлёст (проще стыкового)
  pipe: 1.2,         // труба-труба (сложнее)
} as const;

export type Thickness =
  | 'lt_3'
  | 'mm_3_6'
  | 'mm_6_12'
  | 'gt_12'
  | 'unknown';

export type WeldType =
  | 'butt'
  | 'corner'
  | 'tee'
  | 'lap'
  | 'pipe';

export type Position =
  | 'flat'
  | 'vertical'
  | 'overhead'
  | 'mixed';

export type Condition =
  | 'indoor'
  | 'outdoor'
  | 'height'
  | 'tight_space';

export type MaterialOwner = 'client' | 'contractor';

export type DeadlineType = 'normal' | 'urgent' | 'night';

export type ExtraService =
  | 'vik'
  | 'ut'
  | 'pressure_test'
  | 'soap_test'
  | 'docs';

export interface CalculationFormData {
  photos: string[];        // пока просто dataURL превью
  description: string;     // описание с шага 1
  descriptionStep2?: string; // уточнения с шага 2
  descriptionStep3?: string; // уточнения с шага 3
  typeOfWork: TypeOfWork | null;
  material: Material | null;
  thickness: Thickness | null;
  weldType: WeldType | null;
  volume: string;          // длина шва / кол-во узлов в текстовом виде
  position: Position | null;
  conditions: Condition[];
  materialOwner: MaterialOwner | null;
  deadline: DeadlineType | null;
  extraServices: ExtraService[];
}

export interface Calculation extends CalculationFormData {
  id: string;
  createdAt: string;
  updatedAt: string;
  basePriceMin: number;
  basePriceMax: number;
  totalPriceMin: number;
  totalPriceMax: number;
  status: 'draft' | 'ordered';
}

export type CalculationParams = Pick<CalculationFormData,
  | 'typeOfWork'
  | 'material'
  | 'thickness'
  | 'weldType'
  | 'volume'
  | 'position'
  | 'conditions'
  | 'materialOwner'
  | 'deadline'
>;


