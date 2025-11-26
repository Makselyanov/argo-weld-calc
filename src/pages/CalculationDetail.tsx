import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { GlassCard } from '@/components/GlassCard';
import { GlassButton } from '@/components/GlassButton';
import { calculationService } from '@/services/calculationService';
import { Calculation } from '@/types/calculation';
import { ArrowLeft } from 'lucide-react';
import {
  WORK_TYPES,
  MATERIALS,
  THICKNESSES,
  WELD_TYPES,
  POSITIONS,
  CONDITIONS,
  DEADLINES,
  getLabel
} from '@/constants/calculationMappings';

export default function CalculationDetail() {
  const navigate = useNavigate();
  const { id } = useParams();
  const [calculation, setCalculation] = useState<Calculation | null>(null);

  useEffect(() => {
    if (id) {
      const calc = calculationService.getById(id);
      setCalculation(calc);
    }
  }, [id]);

  if (!calculation) {
    return (
      <div className="min-h-screen p-4 py-8 flex items-center justify-center">
        <GlassCard>
          <p className="text-muted-foreground">Расчёт не найден</p>
        </GlassCard>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-4 py-8">
      <div className="max-w-2xl mx-auto">
        <button
          onClick={() => navigate('/history')}
          className="mb-4 flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft size={20} />
          <span>К списку расчётов</span>
        </button>

        <GlassCard className="space-y-6">
          <div className="flex justify-between items-start">
            <h2 className="text-2xl font-bold">Детали расчёта</h2>
            <span className={`text-xs px-3 py-1 rounded ${calculation.status === 'ordered'
                ? 'bg-primary/20 text-primary'
                : 'bg-muted/20 text-muted-foreground'
              }`}>
              {calculation.status === 'ordered' ? 'Заявка отправлена' : 'Черновик'}
            </span>
          </div>

          <div>
            <p className="text-sm text-muted-foreground mb-1">
              Создано: {new Date(calculation.createdAt).toLocaleDateString('ru-RU', {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
              })}
            </p>
          </div>

          <div className="glass-card p-6 bg-accent/10 border-accent/30 text-center">
            <div className="text-4xl font-bold text-foreground mb-2">
              {calculation.totalPriceMin.toLocaleString()} – {calculation.totalPriceMax.toLocaleString()} ₽
            </div>
            <p className="text-sm text-muted-foreground">Итоговая стоимость</p>
          </div>

          <div>
            <h3 className="text-lg font-semibold mb-2 text-foreground">Описание работ</h3>
            <p className="text-muted-foreground">{calculation.description}</p>
          </div>

          {calculation.photos.length > 0 && (
            <div>
              <h3 className="text-lg font-semibold mb-3 text-foreground">Фотографии</h3>
              <div className="grid grid-cols-3 gap-2">
                {calculation.photos.map((photo, idx) => (
                  <div key={idx} className="aspect-square rounded-lg overflow-hidden border border-border">
                    <img src={photo} alt={`Photo ${idx + 1}`} className="w-full h-full object-cover" />
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <h3 className="text-lg font-semibold mb-3 text-foreground">Параметры</h3>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <span className="text-muted-foreground">Тип работ:</span>
                <p className="text-foreground font-medium">{getLabel(calculation.typeOfWork, WORK_TYPES)}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Материал:</span>
                <p className="text-foreground font-medium">{getLabel(calculation.material, MATERIALS)}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Толщина:</span>
                <p className="text-foreground font-medium">{getLabel(calculation.thickness, THICKNESSES)}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Тип шва:</span>
                <p className="text-foreground font-medium">{getLabel(calculation.weldType, WELD_TYPES)}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Положение:</span>
                <p className="text-foreground font-medium">{getLabel(calculation.position, POSITIONS)}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Срок:</span>
                <p className="text-foreground font-medium">{getLabel(calculation.deadline, DEADLINES)}</p>
              </div>
              {calculation.volume && (
                <div className="col-span-2">
                  <span className="text-muted-foreground">Объём:</span>
                  <p className="text-foreground font-medium">{calculation.volume}</p>
                </div>
              )}
              {calculation.conditions.length > 0 && (
                <div className="col-span-2">
                  <span className="text-muted-foreground">Условия:</span>
                  <p className="text-foreground font-medium">{calculation.conditions.map(c => getLabel(c, CONDITIONS)).join(', ')}</p>
                </div>
              )}
            </div>
          </div>

          {calculation.extraServices.length > 0 && (
            <div>
              <h3 className="text-lg font-semibold mb-2 text-foreground">Дополнительные услуги</h3>
              <ul className="list-disc list-inside text-muted-foreground">
                {calculation.extraServices.map((service, idx) => (
                  <li key={idx}>{service}</li>
                ))}
              </ul>
            </div>
          )}

          <GlassButton onClick={() => navigate('/history')} className="w-full">
            Вернуться к списку
          </GlassButton>
        </GlassCard>
      </div>
    </div>
  );
}
