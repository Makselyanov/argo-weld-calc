import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { GlassCard } from '@/components/GlassCard';
import { GlassButton } from '@/components/GlassButton';
import { calculationService } from '@/services/calculationService';
import { Calculation } from '@/types/calculation';
import { ArrowLeft } from 'lucide-react';

export default function History() {
  const navigate = useNavigate();
  const [calculations, setCalculations] = useState<Calculation[]>([]);

  useEffect(() => {
    setCalculations(calculationService.getAll());
  }, []);

  return (
    <div className="min-h-screen p-4 py-8">
      <div className="max-w-2xl mx-auto">
        <button
          onClick={() => navigate('/')}
          className="mb-4 flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft size={20} />
          <span>На главную</span>
        </button>

        <GlassCard className="space-y-6">
          <h2 className="text-2xl font-bold text-center">Мои расчёты</h2>
          
          {calculations.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-muted-foreground mb-4">У вас пока нет расчётов</p>
              <GlassButton variant="primary" onClick={() => navigate('/new-calculation')}>
                Создать первый расчёт
              </GlassButton>
            </div>
          ) : (
            <div className="space-y-4">
              {calculations.map((calc) => (
                <div
                  key={calc.id}
                  className="glass-card p-4 cursor-pointer hover:bg-muted/20 transition-colors"
                  onClick={() => navigate(`/calculation/${calc.id}`)}
                >
                  <div className="flex justify-between items-start mb-2">
                    <div className="flex-1">
                      <p className="text-sm text-muted-foreground mb-1">
                        {new Date(calc.createdAt).toLocaleDateString('ru-RU', {
                          day: 'numeric',
                          month: 'long',
                          year: 'numeric'
                        })}
                      </p>
                      <p className="text-foreground line-clamp-2 mb-2">
                        {calc.description}
                      </p>
                      <p className="text-lg font-semibold text-accent">
                        {calc.totalPriceMin.toLocaleString()} – {calc.totalPriceMax.toLocaleString()} ₽
                      </p>
                    </div>
                    <span className={`text-xs px-2 py-1 rounded ${
                      calc.status === 'ordered' 
                        ? 'bg-primary/20 text-primary' 
                        : 'bg-muted/20 text-muted-foreground'
                    }`}>
                      {calc.status === 'ordered' ? 'Заявка отправлена' : 'Черновик'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </GlassCard>
      </div>
    </div>
  );
}
