import { useNavigate } from 'react-router-dom';
import { GlassCard } from '@/components/GlassCard';
import { GlassButton } from '@/components/GlassButton';

export default function Home() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo placeholder */}
        <div className="flex justify-center mb-6">
          <div className="w-24 h-24 rounded-full bg-gradient-to-br from-accent to-primary/60 flex items-center justify-center backdrop-blur-sm border border-accent/30 shadow-[0_0_30px_rgba(64,159,191,0.3)]">
            <span className="text-4xl">⚙️</span>
          </div>
        </div>

        <GlassCard className="space-y-6">
          <div className="text-center space-y-2">
            <h1 className="text-2xl font-bold text-foreground">
              ARGO-72 | Калькулятор<br />сварочных работ
            </h1>
            <p className="text-sm text-muted-foreground">
              Загрузи фото, опиши задачу<br />и получи честную оценку стоимости
            </p>
          </div>

          <div className="space-y-3">
            <GlassButton
              variant="primary"
              onClick={() => navigate('/new-calculation')}
              className="w-full text-lg"
            >
              🔧 Новый расчёт
            </GlassButton>
            
            <GlassButton
              onClick={() => navigate('/history')}
              className="w-full text-lg"
            >
              📂 Мои расчёты
            </GlassButton>
            
            <GlassButton
              onClick={() => navigate('/for-welders')}
              className="w-full text-lg"
            >
              ⚙️ Для сварщиков
            </GlassButton>
          </div>

          <div className="text-center">
            <p className="text-xs text-muted-foreground">
              1-й расчёт бесплатный, дальше — оплата звёздами Telegram
            </p>
          </div>
        </GlassCard>
      </div>
    </div>
  );
}
