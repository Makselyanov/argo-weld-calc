import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { GlassCard } from '@/components/GlassCard';
import { GlassButton } from '@/components/GlassButton';
import { getCalculations, StoredCalculationSummary } from '@/services/calculationSupabaseService';
import { ArrowLeft } from 'lucide-react';

export default function History() {
  const navigate = useNavigate();
  const [calculations, setCalculations] = useState<StoredCalculationSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadCalculations() {
      try {
        setIsLoading(true);
        setError(null);
        const data = await getCalculations();
        setCalculations(data);
      } catch (err) {
        console.error('Ошибка загрузки расчётов:', err);
        setError('Не удалось загрузить расчёты');
      } finally {
        setIsLoading(false);
      }
    }

    loadCalculations();
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

          {isLoading ? (
            <div className="text-center py-8">
              <p className="text-muted-foreground">⏳ Загрузка расчётов...</p>
            </div>
          ) : error ? (
            <div className="text-center py-8">
              <p className="text-destructive mb-4">{error}</p>
              <GlassButton variant="primary" onClick={() => window.location.reload()}>
                Попробовать снова
              </GlassButton>
            </div>
          ) : calculations.length === 0 ? (
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
                          day: '2-digit',
                          month: '2-digit',
                          year: 'numeric'
                        })}
                      </p>
                      <p className="text-foreground line-clamp-2 mb-2">
                        {calc.description}
                      </p>
                      <p className="text-lg font-semibold text-accent">
                        {calc.totalMin.toLocaleString()} – {calc.totalMax.toLocaleString()} ₽
                      </p>
                    </div>
                    <span className={`text-xs px-2 py-1 rounded ${calc.status === 'ordered'
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
