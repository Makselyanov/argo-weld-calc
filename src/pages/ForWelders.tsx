import { useNavigate } from 'react-router-dom';
import { GlassCard } from '@/components/GlassCard';
import { GlassButton } from '@/components/GlassButton';
import { ArrowLeft } from 'lucide-react';

export default function ForWelders() {
  const navigate = useNavigate();

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

        <GlassCard className="space-y-6 text-center">
          <div className="text-6xl mb-4">⚙️</div>
          
          <div>
            <h2 className="text-2xl font-bold text-foreground mb-4">
              Для сварщиков
            </h2>
            <p className="text-muted-foreground mb-6">
              Этот раздел будет использоваться для настройки прайса и ставок.
            </p>
            <p className="text-sm text-muted-foreground">
              Функционал в разработке
            </p>
          </div>

          <GlassButton
            variant="primary"
            onClick={() => navigate('/')}
            className="w-full"
          >
            Вернуться на главную
          </GlassButton>
        </GlassCard>
      </div>
    </div>
  );
}
