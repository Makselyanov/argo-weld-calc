export interface Calculation {
  id: string;
  userId?: string;
  createdAt: string;
  updatedAt: string;
  description: string;
  photos: string[];
  typeOfWork: string;
  material: string;
  thickness: string;
  weldType: string;
  volume: string;
  position: string;
  conditions: string[];
  materialOwner: string;
  deadlineType: string;
  basePriceMin: number;
  basePriceMax: number;
  totalPriceMin: number;
  totalPriceMax: number;
  extraServices: string[];
  status: 'draft' | 'ordered';
}

export interface CalculationParams {
  typeOfWork: string;
  material: string;
  thickness: string;
  weldType: string;
  volume: string;
  position: string;
  conditions: string[];
  materialOwner: string;
  deadlineType: string;
}
