import { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface GlassButtonProps {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'default' | 'primary' | 'secondary';
  disabled?: boolean;
  className?: string;
  type?: 'button' | 'submit';
}

export const GlassButton = ({ 
  children, 
  onClick, 
  variant = 'default',
  disabled = false,
  className,
  type = 'button'
}: GlassButtonProps) => {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'glass-button text-center',
        variant === 'primary' && 'glass-button-primary text-primary-foreground',
        variant === 'secondary' && 'glass-button-secondary text-secondary-foreground',
        disabled && 'opacity-50 cursor-not-allowed',
        className
      )}
    >
      {children}
    </button>
  );
};
