import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { GlassCard } from '@/components/GlassCard';
import { GlassButton } from '@/components/GlassButton';
import { ParameterChip } from '@/components/ParameterChip';
import { ArrowLeft, ChevronDown } from 'lucide-react';
import { getAllCalculations, updateCalculationStatus, DetailedCalculation } from '@/services/calculationSupabaseService';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type StatusFilter = 'all' | 'ordered' | 'in_progress' | 'done' | 'cancelled';

const STATUS_LABELS: Record<string, string> = {
  ordered: 'Новая',
  in_progress: 'В работе',
  done: 'Выполнено',
  cancelled: 'Отменено',
};

const STATUS_COLORS: Record<string, string> = {
  ordered: 'bg-blue-500/20 text-blue-500',
  in_progress: 'bg-yellow-500/20 text-yellow-500',
  done: 'bg-green-500/20 text-green-500',
  cancelled: 'bg-red-500/20 text-red-500',
};

export default function ForWelders() {
  const navigate = useNavigate();
  const [calculations, setCalculations] = useState<DetailedCalculation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  useEffect(() => {
    loadCalculations();
  }, []);

  async function loadCalculations() {
    try {
      setIsLoading(true);
      setError(null);
      const data = await getAllCalculations();
      setCalculations(data);
    } catch (err) {
      console.error('Ошибка загрузки заявок:', err);
      setError('Не удалось загрузить заявки');
    } finally {
      setIsLoading(false);
    }
  }

  async function handleStatusChange(id: string, newStatus: 'ordered' | 'in_progress' | 'done' | 'cancelled') {
    try {
      setUpdatingId(id);
      await updateCalculationStatus(id, newStatus);

      // Обновляем локальное состояние без перезагрузки
      setCalculations(prev =>
        prev.map(calc =>
          calc.id === id ? { ...calc, status: newStatus } : calc
        )
      );
    } catch (err) {
      console.error('Ошибка обновления статуса:', err);
      alert('Не удалось обновить статус заявки');
    } finally {
      setUpdatingId(null);
    }
  }

  // Фильтрация расчётов по статусу
  const filteredCalculations = calculations.filter(calc => {
    if (statusFilter === 'all') return true;
    return calc.status === statusFilter;
  });

  return (
    <div className="min-h-screen p-4 py-8">
      <div className="max-w-6xl mx-auto">
        <button
          onClick={() => navigate('/')}
          className="mb-4 flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft size={20} />
          <span>На главную</span>
        </button>

        <GlassCard className="space-y-6">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <h2 className="text-2xl font-bold text-foreground">
              Заявки на сварочные работы
            </h2>

            {/* Фильтры по статусу */}
            <div className="flex flex-wrap gap-2">
              <ParameterChip
                label="Все"
                selected={statusFilter === 'all'}
                onClick={() => setStatusFilter('all')}
              />
              <ParameterChip
                label="Новые"
                selected={statusFilter === 'ordered'}
                onClick={() => setStatusFilter('ordered')}
              />
              <ParameterChip
                label="В работе"
                selected={statusFilter === 'in_progress'}
                onClick={() => setStatusFilter('in_progress')}
              />
              <ParameterChip
                label="Выполнено"
                selected={statusFilter === 'done'}
                onClick={() => setStatusFilter('done')}
              />
              <ParameterChip
                label="Отменено"
                selected={statusFilter === 'cancelled'}
                onClick={() => setStatusFilter('cancelled')}
              />
            </div>
          </div>

          {/* Список заявок */}
          {isLoading ? (
            <div className="text-center py-12">
              <p className="text-muted-foreground">⏳ Загрузка заявок...</p>
            </div>
          ) : error ? (
            <div className="text-center py-12">
              <p className="text-destructive mb-4">{error}</p>
              <GlassButton variant="primary" onClick={loadCalculations}>
                Попробовать снова
              </GlassButton>
            </div>
          ) : filteredCalculations.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-muted-foreground">
                {statusFilter === 'all'
                  ? 'Пока нет заявок'
                  : `Нет заявок со статусом "${STATUS_LABELS[statusFilter]}"`}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredCalculations.map((calc) => (
                <div
                  key={calc.id}
                  className="glass-card p-4 hover:bg-muted/10 transition-colors"
                >
                  <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
                    {/* Основная информация */}
                    <div className="flex-1 space-y-2">
                      <div className="flex items-center gap-3 flex-wrap">
                        <p className="text-sm text-muted-foreground">
                          {new Date(calc.createdAt).toLocaleDateString('ru-RU', {
                            day: '2-digit',
                            month: '2-digit',
                            year: 'numeric'
                          })}
                        </p>
                        <span className={`text-xs px-2 py-1 rounded ${STATUS_COLORS[calc.status] || 'bg-muted/20 text-muted-foreground'}`}>
                          {STATUS_LABELS[calc.status] || calc.status}
                        </span>
                      </div>

                      <p className="text-foreground line-clamp-2">
                        {calc.description}
                      </p>

                      {/* Дополнительные параметры */}
                      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                        {calc.typeOfWork && <span>• {calc.typeOfWork}</span>}
                        {calc.material && <span>• {calc.material}</span>}
                        {calc.thickness && <span>• {calc.thickness}</span>}
                        {calc.volume && <span>• {calc.volume}</span>}
                      </div>

                      <p className="text-lg font-semibold text-accent">
                        {calc.totalMin.toLocaleString()} – {calc.totalMax.toLocaleString()} ₽
                      </p>
                    </div>

                    {/* Управление статусом */}
                    <div className="flex items-center gap-2">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            disabled={updatingId === calc.id}
                            className="glass-button flex items-center gap-2 text-sm px-4 py-2 disabled:opacity-50"
                          >
                            {updatingId === calc.id ? '⏳' : 'Изменить статус'}
                            <ChevronDown size={16} />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="bg-card border-border">
                          <DropdownMenuItem
                            onClick={() => handleStatusChange(calc.id, 'ordered')}
                            className="cursor-pointer"
                          >
                            <span className="text-blue-500">●</span>
                            <span className="ml-2">Новая</span>
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => handleStatusChange(calc.id, 'in_progress')}
                            className="cursor-pointer"
                          >
                            <span className="text-yellow-500">●</span>
                            <span className="ml-2">В работе</span>
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => handleStatusChange(calc.id, 'done')}
                            className="cursor-pointer"
                          >
                            <span className="text-green-500">●</span>
                            <span className="ml-2">Выполнено</span>
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => handleStatusChange(calc.id, 'cancelled')}
                            className="cursor-pointer"
                          >
                            <span className="text-red-500">●</span>
                            <span className="ml-2">Отменено</span>
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
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
