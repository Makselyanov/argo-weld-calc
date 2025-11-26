export type TypeOfWork = 'welding' | 'cutting' | 'overlay' | 'grinding' | 'complex';

export type Material =
  | 'black_metal'
  | 'stainless'
  | 'aluminium'
  | 'cast_iron'
  | 'copper'
  | 'brass'
  | 'titanium';

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


