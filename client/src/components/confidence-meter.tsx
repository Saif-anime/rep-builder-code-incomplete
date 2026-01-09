import { cn } from "@/lib/utils";

interface ConfidenceMeterProps {
  value: number;
  className?: string;
  showLabel?: boolean;
  size?: "sm" | "md" | "lg";
}

function getConfidenceColor(value: number): string {
  if (value >= 0.8) return "bg-green-500";
  if (value >= 0.6) return "bg-yellow-500";
  if (value >= 0.4) return "bg-orange-500";
  return "bg-red-500";
}

function getConfidenceLabel(value: number): string {
  if (value >= 0.8) return "High";
  if (value >= 0.6) return "Medium";
  if (value >= 0.4) return "Low";
  return "Very Low";
}

export function ConfidenceMeter({
  value,
  className,
  showLabel = true,
  size = "md",
}: ConfidenceMeterProps) {
  const percentage = Math.round(value * 100);
  const sizeClasses = {
    sm: "h-1.5",
    md: "h-2",
    lg: "h-3",
  };

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      {showLabel && (
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">AI Confidence</span>
          <span className="font-medium">
            {percentage}% ({getConfidenceLabel(value)})
          </span>
        </div>
      )}
      <div className={cn("w-full rounded-full bg-muted", sizeClasses[size])}>
        <div
          className={cn(
            "rounded-full transition-all duration-500",
            sizeClasses[size],
            getConfidenceColor(value)
          )}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}
