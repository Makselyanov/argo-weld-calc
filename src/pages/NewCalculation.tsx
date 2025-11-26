import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { GlassCard } from '@/components/GlassCard';
import { GlassButton } from '@/components/GlassButton';
import { ParameterChip } from '@/components/ParameterChip';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ArrowLeft } from 'lucide-react';

import {
  CalculationFormData,
  Condition,
  ExtraService
} from '@/types/calculation';
import { calculatePrice, PriceResult } from '@/utils/pricing';
import {
  WORK_TYPES,
  MATERIALS,
  THICKNESSES,
  WELD_TYPES,
  POSITIONS,
  CONDITIONS,
  MATERIAL_OWNERS,
  DEADLINES,
  EXTRA_SERVICES,
  getLabel
} from '@/constants/calculationMappings';
import { saveCalculation } from '@/services/calculationSupabaseService';
import { supabase } from '@/lib/supabaseClient';

export default function NewCalculation() {
  const navigate = useNavigate();
  const [step, setStep] = useState<1 | 2 | 3>(1);

  const [formData, setFormData] = useState<CalculationFormData>({
    photos: [],
    description: '',
    descriptionStep2: '',
    descriptionStep3: '',
    typeOfWork: null,
    material: null,
    thickness: null,
    weldType: null,
    volume: '',
    position: null,
    conditions: [],
    materialOwner: null,
    deadline: null,
    extraServices: []
  });

  const [priceResult, setPriceResult] = useState<PriceResult | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isCalculatingPrice, setIsCalculatingPrice] = useState(false);
  const [priceCalculationMethod, setPriceCalculationMethod] = useState<'ai' | 'fallback' | null>(null);
  const [aiComment, setAiComment] = useState<string | null>(null);

  // Recalculate price when extra services change in step 3
  useEffect(() => {
    if (step === 3) {
      const result = calculatePrice(formData);
      setPriceResult(result);
    }
  }, [formData.extraServices, step]);

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const newPhotos: string[] = [];
      const fileList = Array.from(files);

      let processedCount = 0;
      fileList.forEach(file => {
        const reader = new FileReader();
        reader.onloadend = () => {
          if (typeof reader.result === 'string') {
            newPhotos.push(reader.result);
          }
          processedCount++;
          if (processedCount === fileList.length) {
            setFormData(prev => ({
              ...prev,
              photos: [...prev.photos, ...newPhotos]
            }));
          }
        };
        reader.readAsDataURL(file);
      });
    }
  };

  const handleNext = async () => {
    if (step === 1) {
      if (formData.description.trim()) {
        setStep(2);
      }
    } else if (step === 2) {
      // Validate required fields
      if (formData.typeOfWork && formData.material && formData.thickness && formData.weldType) {
        await calculatePriceWithAI();
        setStep(3);
      }
    }
  };

  // Функция расчёта цены с использованием AI и fallback
  const calculatePriceWithAI = async () => {
    setIsCalculatingPrice(true);
    setPriceCalculationMethod(null);
    setAiComment(null);

    try {
      // Пытаемся получить расчёт от AI
      const { data, error } = await supabase.functions.invoke('ai-price-estimate', {
        body: {
          description: formData.description,
          descriptionStep2: formData.descriptionStep2,
          descriptionStep3: formData.descriptionStep3,
          typeOfWork: formData.typeOfWork,
          material: formData.material,
          thickness: formData.thickness,
          seamType: formData.weldType,
          position: formData.position,
          conditions: formData.conditions,
          deadline: formData.deadline,
          extraServices: formData.extraServices,
          photos: formData.photos // DataURL или ссылки на фото
        }
      });

      if (error || !data || typeof data.totalMin !== 'number' || typeof data.totalMax !== 'number') {
        throw new Error('AI calculation failed');
      }

      // Успешный расчёт через AI
      setPriceResult({
        baseMin: data.totalMin,
        baseMax: data.totalMax,
        totalMin: data.totalMin,
        totalMax: data.totalMax
      });
      setPriceCalculationMethod('ai');
      setAiComment(data.comment || null);
    } catch (err) {
      // Fallback на локальный калькулятор
      console.warn('AI расчёт не удался, используем локальный калькулятор:', err);
      const result = calculatePrice(formData);
      setPriceResult(result);
      setPriceCalculationMethod('fallback');
    } finally {
      setIsCalculatingPrice(false);
    }
  };

  const handleBack = () => {
    if (step === 1) {
      navigate('/');
    } else {
      setStep(prev => (prev - 1) as 1 | 2 | 3);
    }
  };

  const toggleCondition = (condition: Condition) => {
    setFormData(prev => ({
      ...prev,
      conditions: prev.conditions.includes(condition)
        ? prev.conditions.filter(c => c !== condition)
        : [...prev.conditions, condition]
    }));
  };

  const toggleExtraService = (service: ExtraService) => {
    setFormData(prev => ({
      ...prev,
      extraServices: prev.extraServices.includes(service)
        ? prev.extraServices.filter(s => s !== service)
        : [...prev.extraServices, service]
    }));
  };

  const handleOrder = async () => {
    if (!priceResult) return;

    try {
      setIsSaving(true);
      setSaveError(null);

      // Сохраняем расчёт в Supabase
      await saveCalculation(formData, priceResult);

      // Перенаправляем на страницу подтверждения
      navigate('/order-confirmation');
    } catch (error) {
      console.error('Ошибка при сохранении расчёта:', error);
      setSaveError('Не удалось сохранить расчёт. Попробуйте ещё раз.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDiscuss = () => {
    console.log('Discuss clicked - link to chat will be here');
    navigate('/');
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

                {formData.photos.length > 0 && (
                  <div className="mt-4 grid grid-cols-3 gap-2">
                    {formData.photos.map((photo, idx) => (
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
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Опиши, что нужно сварить, где стоит узел, есть ли старый шов…"
                  className="min-h-[120px] bg-input/50 border-border/50 text-foreground placeholder:text-muted-foreground"
                />
              </div>
            </div>

            <GlassButton
              variant="primary"
              onClick={handleNext}
              disabled={!formData.description.trim()}
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
              {/* Type of Work */}
              <div>
                <Label className="text-foreground mb-3 block">Тип работ</Label>
                <div className="flex flex-wrap gap-2">
                  {WORK_TYPES.map(type => (
                    <ParameterChip
                      key={type.value}
                      label={type.label}
                      selected={formData.typeOfWork === type.value}
                      onClick={() => setFormData({ ...formData, typeOfWork: type.value })}
                    />
                  ))}
                </div>
              </div>

              {/* Material */}
              <div>
                <Label className="text-foreground mb-3 block">Материал</Label>
                <div className="flex flex-wrap gap-2">
                  {MATERIALS.map(mat => (
                    <ParameterChip
                      key={mat.value}
                      label={mat.label}
                      selected={formData.material === mat.value}
                      onClick={() => setFormData({ ...formData, material: mat.value })}
                    />
                  ))}
                </div>
              </div>

              {/* Thickness */}
              <div>
                <Label className="text-foreground mb-3 block">Толщина</Label>
                <div className="flex flex-wrap gap-2">
                  {THICKNESSES.map(thick => (
                    <ParameterChip
                      key={thick.value}
                      label={thick.label}
                      selected={formData.thickness === thick.value}
                      onClick={() => setFormData({ ...formData, thickness: thick.value })}
                    />
                  ))}
                </div>
              </div>

              {/* Weld Type */}
              <div>
                <Label className="text-foreground mb-3 block">Тип шва</Label>
                <div className="flex flex-wrap gap-2">
                  {WELD_TYPES.map(weld => (
                    <ParameterChip
                      key={weld.value}
                      label={weld.label}
                      selected={formData.weldType === weld.value}
                      onClick={() => setFormData({ ...formData, weldType: weld.value })}
                    />
                  ))}
                </div>
              </div>

              {/* Volume */}
              <div>
                <Label className="text-foreground mb-2 block">Объём работ</Label>
                <Input
                  value={formData.volume}
                  onChange={(e) => setFormData({ ...formData, volume: e.target.value })}
                  placeholder="Например: длина шва 6 метров"
                  className="bg-input/50 border-border/50 text-foreground"
                />
              </div>

              {/* Position */}
              <div>
                <Label className="text-foreground mb-3 block">Положение</Label>
                <div className="flex flex-wrap gap-2">
                  {POSITIONS.map(pos => (
                    <ParameterChip
                      key={pos.value}
                      label={pos.label}
                      selected={formData.position === pos.value}
                      onClick={() => setFormData({ ...formData, position: pos.value })}
                    />
                  ))}
                </div>
              </div>

              {/* Conditions */}
              <div>
                <Label className="text-foreground mb-3 block">Условия работы</Label>
                <div className="flex flex-wrap gap-2">
                  {CONDITIONS.map(cond => (
                    <ParameterChip
                      key={cond.value}
                      label={cond.label}
                      selected={formData.conditions.includes(cond.value)}
                      onClick={() => toggleCondition(cond.value)}
                    />
                  ))}
                </div>
              </div>

              {/* Material Owner */}
              <div>
                <Label className="text-foreground mb-3 block">Материал</Label>
                <div className="flex flex-wrap gap-2">
                  {MATERIAL_OWNERS.map(owner => (
                    <ParameterChip
                      key={owner.value}
                      label={owner.label}
                      selected={formData.materialOwner === owner.value}
                      onClick={() => setFormData({ ...formData, materialOwner: owner.value })}
                    />
                  ))}
                </div>
              </div>

              {/* Deadline */}
              <div>
                <Label className="text-foreground mb-3 block">Срок выполнения</Label>
                <div className="flex flex-wrap gap-2">
                  {DEADLINES.map(deadline => (
                    <ParameterChip
                      key={deadline.value}
                      label={deadline.label}
                      selected={formData.deadline === deadline.value}
                      onClick={() => setFormData({ ...formData, deadline: deadline.value })}
                    />
                  ))}
                </div>
              </div>

              {/* Step 2 Description */}
              <div>
                <Label className="text-foreground mb-2 block">Уточнения по материалам и размерам</Label>
                <Textarea
                  value={formData.descriptionStep2 || ''}
                  onChange={(e) => setFormData({ ...formData, descriptionStep2: e.target.value })}
                  placeholder="Например: толщина точно 4 мм, труба диаметром 50 мм..."
                  className="min-h-[80px] bg-input/50 border-border/50 text-foreground placeholder:text-muted-foreground"
                />
              </div>

              {/* Summary */}
              <div className="glass-card p-4 bg-muted/10">
                <p className="text-sm font-medium mb-2 text-foreground">Вы выбрали:</p>
                <p className="text-sm text-muted-foreground">
                  {formData.typeOfWork && `Тип: ${getLabel(formData.typeOfWork, WORK_TYPES)}. `}
                  {formData.material && `Материал: ${getLabel(formData.material, MATERIALS)}. `}
                  {formData.thickness && `Толщина: ${getLabel(formData.thickness, THICKNESSES)}. `}
                  {formData.weldType && `Шов: ${getLabel(formData.weldType, WELD_TYPES)}. `}
                  {formData.position && `Положение: ${getLabel(formData.position, POSITIONS)}. `}
                  {formData.conditions.length > 0 && `Условия: ${formData.conditions.map(c => getLabel(c, CONDITIONS)).join(', ')}. `}
                  {formData.materialOwner && `${getLabel(formData.materialOwner, MATERIAL_OWNERS)}. `}
                  {formData.deadline && `Срок: ${getLabel(formData.deadline, DEADLINES)}.`}
                </p>
              </div>
            </div>

            <GlassButton
              variant="primary"
              onClick={handleNext}
              disabled={!formData.typeOfWork || !formData.material || !formData.thickness || !formData.weldType || isCalculatingPrice}
              className="w-full"
            >
              {isCalculatingPrice ? '🤖 Идёт расчёт цены нейросетью...' : '✅ Готово, посчитать'}
            </GlassButton>
          </GlassCard>
        )}

        {step === 3 && priceResult && (
          <GlassCard className="space-y-6">
            <h2 className="text-2xl font-bold text-center">Оценка стоимости</h2>

            <div className="glass-card p-6 bg-accent/10 border-accent/30 text-center space-y-3">
              <div className="text-4xl font-bold text-foreground mb-2">
                {priceResult.totalMin.toLocaleString()} – {priceResult.totalMax.toLocaleString()} ₽
              </div>
              <p className="text-sm text-muted-foreground">
                {getLabel(formData.typeOfWork, WORK_TYPES)}, {getLabel(formData.weldType, WELD_TYPES)?.toLowerCase()} шов, {getLabel(formData.material, MATERIALS)?.toLowerCase()}, {formData.volume || 'объём не указан'}
              </p>

              {/* Информация о методе расчёта */}
              {priceCalculationMethod === 'ai' && (
                <div className="text-xs text-green-500 flex items-center justify-center gap-2">
                  <span>🤖</span>
                  <span>Расчёт выполнен искусственным интеллектом</span>
                </div>
              )}
              {priceCalculationMethod === 'fallback' && (
                <div className="text-xs text-yellow-500">
                  ⚠️ Не удалось рассчитать через нейросеть, использован базовый калькулятор
                </div>
              )}

              {/* Комментарий от AI */}
              {aiComment && (
                <p className="text-sm text-muted-foreground italic mt-2">
                  💬 {aiComment}
                </p>
              )}
            </div>

            <div>
              <h3 className="text-lg font-semibold mb-4 text-foreground">Дополнительные услуги</h3>
              <div className="space-y-3">
                {EXTRA_SERVICES.map(service => (
                  <label key={service.value} className="flex items-center gap-3 cursor-pointer">
                    <Checkbox
                      checked={formData.extraServices.includes(service.value)}
                      onCheckedChange={() => toggleExtraService(service.value)}
                    />
                    <span className="text-foreground">{service.label}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Step 3 Description */}
            <div>
              <Label className="text-foreground mb-2 block">Комментарий к заказу (условия доступа и т.д.)</Label>
              <Textarea
                value={formData.descriptionStep3 || ''}
                onChange={(e) => setFormData({ ...formData, descriptionStep3: e.target.value })}
                placeholder="Например: работа на высоте 3 метра, нужен пропуск..."
                className="min-h-[80px] bg-input/50 border-border/50 text-foreground placeholder:text-muted-foreground"
              />
            </div>

            <div className="space-y-3">
              {saveError && (
                <div className="glass-card p-3 bg-destructive/10 border-destructive/30 text-center">
                  <p className="text-sm text-destructive">{saveError}</p>
                </div>
              )}

              <GlassButton
                variant="secondary"
                onClick={handleOrder}
                disabled={isSaving}
                className="w-full text-lg"
              >
                {isSaving ? '⏳ Сохранение...' : '📩 Заказать работу'}
              </GlassButton>

              <GlassButton
                onClick={handleDiscuss}
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
