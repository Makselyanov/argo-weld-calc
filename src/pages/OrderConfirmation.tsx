import { useNavigate } from 'react-router-dom';
import { GlassCard } from '@/components/GlassCard';
import { GlassButton } from '@/components/GlassButton';

export default function OrderConfirmation() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <GlassCard className="space-y-6 text-center">
          <div className="text-6xl mb-4">✅</div>
          
          <div>
            <h2 className="text-2xl font-bold text-foreground mb-2">
              Заявка отправлена сварщику
            </h2>
            <p className="text-muted-foreground">
              Мы свяжемся с вами для уточнения деталей
            </p>
          </div>

          <div className="space-y-3 pt-4">
            <GlassButton
              variant="primary"
              onClick={() => navigate('/')}
              className="w-full"
            >
              Вернуться на главную
            </GlassButton>
            
            <GlassButton
              onClick={() => navigate('/history')}
              className="w-full"
            >
              Открыть мои расчёты
            </GlassButton>
          </div>
        </GlassCard>
      </div>
    </div>
  );
}
