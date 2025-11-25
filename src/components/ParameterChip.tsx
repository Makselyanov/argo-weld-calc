import { cn } from '@/lib/utils';

interface ParameterChipProps {
  label: string;
  selected: boolean;
  onClick: () => void;
}

export const ParameterChip = ({ label, selected, onClick }: ParameterChipProps) => {
  return (
    <button
      onClick={onClick}
      className={cn(
        'px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200',
        'border backdrop-blur-md',
        selected 
          ? 'bg-accent/30 border-accent text-accent-foreground shadow-[0_0_15px_rgba(64,159,191,0.4)]' 
          : 'bg-muted/20 border-border/30 text-muted-foreground hover:bg-muted/30 hover:border-border/50'
      )}
    >
      {label}
    </button>
  );
};
