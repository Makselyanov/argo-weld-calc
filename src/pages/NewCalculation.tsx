import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { GlassCard } from '@/components/GlassCard';
import { GlassButton } from '@/components/GlassButton';
import { ParameterChip } from '@/components/ParameterChip';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { calculationService, calculateBasePrice, calculateExtraServices } from '@/services/calculationService';
import { Calculation, CalculationParams } from '@/types/calculation';
import { ArrowLeft } from 'lucide-react';

export default function NewCalculation() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  
  // Step 1 data
  const [description, setDescription] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  
  // Step 2 data
  const [params, setParams] = useState<CalculationParams>({
    typeOfWork: '',
    material: '',
    thickness: '',
    weldType: '',
    volume: '',
    position: '',
    conditions: [],
    materialOwner: '',
    deadlineType: ''
  });

  // Step 3 data
  const [extraServices, setExtraServices] = useState<string[]>([]);
  const [priceRange, setPriceRange] = useState({ min: 0, max: 0 });

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files) {
      const newPhotos = Array.from(files).map(file => URL.createObjectURL(file));
      setPhotos([...photos, ...newPhotos]);
    }
  };

  const handleNext = () => {
    if (step === 2) {
      const basePrice = calculateBasePrice(params);
      setPriceRange(basePrice);
    }
    setStep(step + 1);
  };

  const handleBack = () => {
    if (step === 1) {
      navigate('/');
    } else {
      setStep(step - 1);
    }
  };

  const toggleCondition = (condition: string) => {
    setParams(prev => ({
      ...prev,
      conditions: prev.conditions.includes(condition)
        ? prev.conditions.filter(c => c !== condition)
        : [...prev.conditions, condition]
    }));
  };

  const toggleExtraService = (service: string) => {
    const newServices = extraServices.includes(service)
      ? extraServices.filter(s => s !== service)
      : [...extraServices, service];
    
    setExtraServices(newServices);
    
    // Recalculate price with extra services
    const basePrice = calculateBasePrice(params);
    const extraPrice = calculateExtraServices(newServices);
    setPriceRange({
      min: basePrice.min + extraPrice.min,
      max: basePrice.max + extraPrice.max
    });
  };

  const handleOrder = () => {
    const calculation: Calculation = {
      id: Date.now().toString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      description,
      photos,
      ...params,
      basePriceMin: calculateBasePrice(params).min,
      basePriceMax: calculateBasePrice(params).max,
      totalPriceMin: priceRange.min,
      totalPriceMax: priceRange.max,
      extraServices,
      status: 'ordered'
    };
    
    calculationService.save(calculation);
    navigate('/order-confirmation');
  };

  return (
    <div className="min-h-screen p-4 py-8">
      <div className="max-w-2xl mx-auto">
        <button
          onClick={handleBack}
          className="mb-4 flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft size={20} />
          <span>Назад</span>
        </button>

        {step === 1 && (
          <GlassCard className="space-y-6">
            <h2 className="text-2xl font-bold text-center">Шаг 1. Фото и описание</h2>
            
            <div className="space-y-4">
              <div>
                <Label className="text-foreground mb-2 block">Фотографии</Label>
                <label className="glass-button w-full cursor-pointer block text-center">
                  📸 Добавить фото
                  <input
                    type="file"
                    multiple
                    accept="image/*"
                    onChange={handlePhotoUpload}
                    className="hidden"
                  />
                </label>
                
                {photos.length > 0 && (
                  <div className="mt-4 grid grid-cols-3 gap-2">
                    {photos.map((photo, idx) => (
                      <div key={idx} className="relative aspect-square rounded-lg overflow-hidden border border-border">
                        <img src={photo} alt={`Preview ${idx + 1}`} className="w-full h-full object-cover" />
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <Label className="text-foreground mb-2 block">Описание работ</Label>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Опиши, что нужно сварить, где стоит узел, есть ли старый шов…"
                  className="min-h-[120px] bg-input/50 border-border/50 text-foreground placeholder:text-muted-foreground"
                />
              </div>
            </div>

            <GlassButton
              variant="primary"
              onClick={handleNext}
              disabled={!description.trim()}
              className="w-full"
            >
              Далее ➜ Параметры
            </GlassButton>
          </GlassCard>
        )}

        {step === 2 && (
          <GlassCard className="space-y-6">
            <h2 className="text-2xl font-bold text-center">Шаг 2. Параметры работ</h2>
            
            <div className="space-y-6">
              <div>
                <Label className="text-foreground mb-3 block">Тип работ</Label>
                <div className="flex flex-wrap gap-2">
                  {['Сварка', 'Резка', 'Наплавка', 'Зачистка', 'Комплекс'].map(type => (
                    <ParameterChip
                      key={type}
                      label={type}
                      selected={params.typeOfWork === type}
                      onClick={() => setParams({ ...params, typeOfWork: type })}
                    />
                  ))}
                </div>
              </div>

              <div>
                <Label className="text-foreground mb-3 block">Материал</Label>
                <div className="flex flex-wrap gap-2">
                  {['Черная сталь', 'Нержавейка', 'Алюминий', 'Чугун', 'Другое'].map(mat => (
                    <ParameterChip
                      key={mat}
                      label={mat}
                      selected={params.material === mat}
                      onClick={() => setParams({ ...params, material: mat })}
                    />
                  ))}
                </div>
              </div>

              <div>
                <Label className="text-foreground mb-3 block">Толщина</Label>
                <div className="flex flex-wrap gap-2">
                  {['до 3 мм', '3–6 мм', '6–12 мм', '12+ мм', 'Не знаю'].map(thick => (
                    <ParameterChip
                      key={thick}
                      label={thick}
                      selected={params.thickness === thick}
                      onClick={() => setParams({ ...params, thickness: thick })}
                    />
                  ))}
                </div>
              </div>

              <div>
                <Label className="text-foreground mb-3 block">Тип шва</Label>
                <div className="flex flex-wrap gap-2">
                  {['Стыковой', 'Угловой', 'Тавровый', 'Нахлёст', 'Труба-труба'].map(weld => (
                    <ParameterChip
                      key={weld}
                      label={weld}
                      selected={params.weldType === weld}
                      onClick={() => setParams({ ...params, weldType: weld })}
                    />
                  ))}
                </div>
              </div>

              <div>
                <Label className="text-foreground mb-2 block">Объём работ</Label>
                <Input
                  value={params.volume}
                  onChange={(e) => setParams({ ...params, volume: e.target.value })}
                  placeholder="Например: длина шва 6 метров"
                  className="bg-input/50 border-border/50 text-foreground"
                />
              </div>

              <div>
                <Label className="text-foreground mb-3 block">Положение</Label>
                <div className="flex flex-wrap gap-2">
                  {['Нижнее', 'Вертикальное', 'Потолочное', 'Смешанное'].map(pos => (
                    <ParameterChip
                      key={pos}
                      label={pos}
                      selected={params.position === pos}
                      onClick={() => setParams({ ...params, position: pos })}
                    />
                  ))}
                </div>
              </div>

              <div>
                <Label className="text-foreground mb-3 block">Условия работы</Label>
                <div className="space-y-2">
                  {['В помещении', 'На улице', 'Высота/леса', 'Стеснённый доступ'].map(cond => (
                    <label key={cond} className="flex items-center gap-3 cursor-pointer">
                      <Checkbox
                        checked={params.conditions.includes(cond)}
                        onCheckedChange={() => toggleCondition(cond)}
                      />
                      <span className="text-foreground">{cond}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <Label className="text-foreground mb-3 block">Материал</Label>
                <div className="flex flex-wrap gap-2">
                  {['Материал заказчика', 'Материал исполнителя'].map(owner => (
                    <ParameterChip
                      key={owner}
                      label={owner}
                      selected={params.materialOwner === owner}
                      onClick={() => setParams({ ...params, materialOwner: owner })}
                    />
                  ))}
                </div>
              </div>

              <div>
                <Label className="text-foreground mb-3 block">Срок выполнения</Label>
                <div className="flex flex-wrap gap-2">
                  {['Обычно', 'Срочно', 'Ночью/сменами'].map(deadline => (
                    <ParameterChip
                      key={deadline}
                      label={deadline}
                      selected={params.deadlineType === deadline}
                      onClick={() => setParams({ ...params, deadlineType: deadline })}
                    />
                  ))}
                </div>
              </div>

              <div className="glass-card p-4 bg-muted/10">
                <p className="text-sm font-medium mb-2 text-foreground">Вы выбрали:</p>
                <p className="text-sm text-muted-foreground">
                  {params.typeOfWork && `Тип: ${params.typeOfWork}. `}
                  {params.material && `Материал: ${params.material}. `}
                  {params.thickness && `Толщина: ${params.thickness}. `}
                  {params.weldType && `Шов: ${params.weldType}. `}
                  {params.position && `Положение: ${params.position}. `}
                  {params.conditions.length > 0 && `Условия: ${params.conditions.join(', ')}. `}
                  {params.materialOwner && `${params.materialOwner}. `}
                  {params.deadlineType && `Срок: ${params.deadlineType}.`}
                </p>
              </div>
            </div>

            <GlassButton
              variant="primary"
              onClick={handleNext}
              disabled={!params.typeOfWork || !params.material || !params.thickness || !params.weldType || !params.position || !params.materialOwner || !params.deadlineType}
              className="w-full"
            >
              ✅ Готово, посчитать
            </GlassButton>
          </GlassCard>
        )}

        {step === 3 && (
          <GlassCard className="space-y-6">
            <h2 className="text-2xl font-bold text-center">Оценка стоимости</h2>
            
            <div className="glass-card p-6 bg-accent/10 border-accent/30 text-center">
              <div className="text-4xl font-bold text-foreground mb-2">
                {priceRange.min.toLocaleString()} – {priceRange.max.toLocaleString()} ₽
              </div>
              <p className="text-sm text-muted-foreground">
                {params.typeOfWork}, {params.weldType.toLowerCase()} шов, {params.material.toLowerCase()}, {params.volume || 'объём не указан'}
              </p>
            </div>

            <div>
              <h3 className="text-lg font-semibold mb-4 text-foreground">Дополнительные услуги</h3>
              <div className="space-y-3">
                {['ВИК', 'УЗК', 'Опрессовка', 'Проверка мылом', 'Акты и протоколы'].map(service => (
                  <label key={service} className="flex items-center gap-3 cursor-pointer">
                    <Checkbox
                      checked={extraServices.includes(service)}
                      onCheckedChange={() => toggleExtraService(service)}
                    />
                    <span className="text-foreground">{service}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <GlassButton
                variant="secondary"
                onClick={handleOrder}
                className="w-full text-lg"
              >
                📩 Заказать работу
              </GlassButton>
              
              <GlassButton
                onClick={() => navigate('/')}
                className="w-full"
              >
                💬 Обсудить со сварщиком
              </GlassButton>
            </div>
          </GlassCard>
        )}
      </div>
    </div>
  );
}
