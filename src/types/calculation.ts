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
 * weld - сварка (включая обратную сторону)
 * prep - зачистка, подготовка
 * finish - сатинирование, покраска, лак
 */
export const MATERIAL_COEFF = {
  steel: { weld: 1.0, prep: 1.0, finish: 1.0 },
  stainless: { weld: 1.4, prep: 1.3, finish: 1.2 },
  aluminium: { weld: 1.5, prep: 1.3, finish: 1.1 },
  cast_iron: { weld: 1.8, prep: 1.6, finish: 1.1 },
  copper: { weld: 1.7, prep: 1.4, finish: 1.2 },
  brass: { weld: 1.4, prep: 1.2, finish: 1.1 },
  titanium: { weld: 2.2, prep: 1.7, finish: 1.3 },
} as const;

export const THICKNESS_COEFF = {
  "lt_3": 1.0,       // до 3 мм (было 0-3) - используем ключи из типа Thickness
  "mm_3_6": 1.1,     // 3-6 мм
  "mm_6_12": 1.25,   // 6-12 мм
  "gt_12": 1.5,      // 12+ мм
  "unknown": 1.1     // среднее значение
} as const;

export const SEAM_TYPE_COEFF = {
  butt: 1.0,         // стыковой
  corner: 1.15,      // угловой (используем corner вместо fillet, так как в типах corner)
  tee: 1.15,         // тавровый (используем tee вместо fillet)
  lap: 1.1,          // нахлёст (используем lap вместо overlap)
  pipe: 1.25,        // труба-труба
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


