import { Calculation, CalculationParams, ExtraService } from '@/types/calculation';

const STORAGE_KEY = 'argo72_calculations';

export const calculationService = {
  // Get all calculations from localStorage
  getAll(): Calculation[] {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  },

  // Get a single calculation by ID
  getById(id: string): Calculation | null {
    const calculations = this.getAll();
    return calculations.find(calc => calc.id === id) || null;
  },

  // Save a calculation
  save(calculation: Calculation): Calculation {
    const calculations = this.getAll();
    const existingIndex = calculations.findIndex(c => c.id === calculation.id);

    if (existingIndex >= 0) {
      calculations[existingIndex] = calculation;
    } else {
      calculations.push(calculation);
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(calculations));
    return calculation;
  },

  // Delete a calculation
  delete(id: string): void {
    const calculations = this.getAll();
    const filtered = calculations.filter(c => c.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
  }
};

// Mock price calculation based on parameters
export const calculateBasePrice = (params: CalculationParams): { min: number; max: number } => {
  let baseMin = 5000;
  let baseMax = 8000;

  // Type of work multiplier
  const workMultipliers: Record<string, number> = {
    'welding': 1.0,
    'cutting': 0.7,
    'overlay': 1.3,
    'grinding': 0.5,
    'complex': 1.5
  };
  const workMult = params.typeOfWork ? (workMultipliers[params.typeOfWork] || 1.0) : 1.0;

  // Material multiplier
  const materialMultipliers: Record<string, number> = {
    'steel': 1.0,
    'stainless': 1.5,
    'aluminium': 1.8,
    'cast_iron': 1.4,
    'other': 1.2
  };
  const materialMult = params.material ? (materialMultipliers[params.material] || 1.0) : 1.0;

  // Thickness multiplier
  const thicknessMultipliers: Record<string, number> = {
    'lt_3': 0.8,
    'mm_3_6': 1.0,
    'mm_6_12': 1.3,
    'gt_12': 1.6,
    'unknown': 1.0
  };
  const thicknessMult = params.thickness ? (thicknessMultipliers[params.thickness] || 1.0) : 1.0;

  // Position multiplier
  const positionMultipliers: Record<string, number> = {
    'flat': 1.0,
    'vertical': 1.2,
    'overhead': 1.4,
    'mixed': 1.3
  };
  const positionMult = params.position ? (positionMultipliers[params.position] || 1.0) : 1.0;

  // Conditions multiplier
  let conditionsMult = 1.0;
  if (params.conditions.includes('outdoor')) conditionsMult += 0.1;
  if (params.conditions.includes('height')) conditionsMult += 0.2;
  if (params.conditions.includes('tight_space')) conditionsMult += 0.15;

  // Material owner multiplier
  const materialOwnerMult = params.materialOwner === 'contractor' ? 1.3 : 1.0;

  // Deadline multiplier
  const deadlineMultipliers: Record<string, number> = {
    'normal': 1.0,
    'urgent': 1.3,
    'night': 1.5
  };
  const deadlineMult = params.deadline ? (deadlineMultipliers[params.deadline] || 1.0) : 1.0;

  // Calculate final price
  const totalMult = workMult * materialMult * thicknessMult * positionMult * conditionsMult * materialOwnerMult * deadlineMult;

  baseMin = Math.round(baseMin * totalMult);
  baseMax = Math.round(baseMax * totalMult);

  return { min: baseMin, max: baseMax };
};

// Calculate extra services cost
export const calculateExtraServices = (services: ExtraService[]): { min: number; max: number } => {
  const servicePrices: Record<ExtraService, { min: number; max: number }> = {
    'vik': { min: 2000, max: 3000 },
    'ut': { min: 3000, max: 5000 },
    'pressure_test': { min: 1500, max: 2500 },
    'soap_test': { min: 500, max: 1000 },
    'docs': { min: 1000, max: 2000 }
  };

  let totalMin = 0;
  let totalMax = 0;

  services.forEach(service => {
    const price = servicePrices[service];
    if (price) {
      totalMin += price.min;
      totalMax += price.max;
    }
  });

  return { min: totalMin, max: totalMax };
};
