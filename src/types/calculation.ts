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
  description: string;
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


