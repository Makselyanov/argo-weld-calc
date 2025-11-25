import { Calculation, CalculationParams } from '@/types/calculation';

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
    'Сварка': 1.0,
    'Резка': 0.7,
    'Наплавка': 1.3,
    'Зачистка': 0.5,
    'Комплекс': 1.5
  };
  const workMult = workMultipliers[params.typeOfWork] || 1.0;

  // Material multiplier
  const materialMultipliers: Record<string, number> = {
    'Черная сталь': 1.0,
    'Нержавейка': 1.5,
    'Алюминий': 1.8,
    'Чугун': 1.4,
    'Другое': 1.2
  };
  const materialMult = materialMultipliers[params.material] || 1.0;

  // Thickness multiplier
  const thicknessMultipliers: Record<string, number> = {
    'до 3 мм': 0.8,
    '3–6 мм': 1.0,
    '6–12 мм': 1.3,
    '12+ мм': 1.6,
    'Не знаю': 1.0
  };
  const thicknessMult = thicknessMultipliers[params.thickness] || 1.0;

  // Position multiplier
  const positionMultipliers: Record<string, number> = {
    'Нижнее': 1.0,
    'Вертикальное': 1.2,
    'Потолочное': 1.4,
    'Смешанное': 1.3
  };
  const positionMult = positionMultipliers[params.position] || 1.0;

  // Conditions multiplier
  let conditionsMult = 1.0;
  if (params.conditions.includes('На улице')) conditionsMult += 0.1;
  if (params.conditions.includes('Высота/леса')) conditionsMult += 0.2;
  if (params.conditions.includes('Стеснённый доступ')) conditionsMult += 0.15;

  // Material owner multiplier
  const materialOwnerMult = params.materialOwner === 'Материал исполнителя' ? 1.3 : 1.0;

  // Deadline multiplier
  const deadlineMultipliers: Record<string, number> = {
    'Обычно': 1.0,
    'Срочно': 1.3,
    'Ночью/сменами': 1.5
  };
  const deadlineMult = deadlineMultipliers[params.deadlineType] || 1.0;

  // Calculate final price
  const totalMult = workMult * materialMult * thicknessMult * positionMult * conditionsMult * materialOwnerMult * deadlineMult;
  
  baseMin = Math.round(baseMin * totalMult);
  baseMax = Math.round(baseMax * totalMult);

  return { min: baseMin, max: baseMax };
};

// Calculate extra services cost
export const calculateExtraServices = (services: string[]): { min: number; max: number } => {
  const servicePrices: Record<string, { min: number; max: number }> = {
    'ВИК': { min: 2000, max: 3000 },
    'УЗК': { min: 3000, max: 5000 },
    'Опрессовка': { min: 1500, max: 2500 },
    'Проверка мылом': { min: 500, max: 1000 },
    'Акты и протоколы': { min: 1000, max: 2000 }
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
