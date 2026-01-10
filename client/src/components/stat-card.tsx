import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { LucideIcon, TrendingUp, TrendingDown } from "lucide-react";

interface StatCardProps {
  title: string;
  value: string | number;
  icon: LucideIcon;
  trend?: {
    value: number;
    isPositive: boolean;
  };
  description?: string;
  className?: string;
}

export function StatCard({
  title,
  value,
  icon: Icon,
  trend,
  description,
  className,
}: StatCardProps) {
  return (
    <Card className={cn("hover-elevate transition-all", className)}>
      <CardContent className="p-3 sm:p-4 md:p-6">
        <div className="flex items-start justify-between gap-2 sm:gap-4">
          <div className="flex flex-col gap-0.5 sm:gap-1 min-w-0">
            <span className="text-xs sm:text-xs md:text-sm font-medium text-muted-foreground truncate">
              {title}
            </span>
            <span className="text-xl sm:text-2xl md:text-3xl font-bold tracking-tight">
              {value}
            </span>
            {trend && (
              <div className="flex items-center gap-1 mt-0.5 sm:mt-1">
                {trend.isPositive ? (
                  <TrendingUp className="h-2.5 w-2.5 sm:h-3 sm:w-3 text-green-500" />
                ) : (
                  <TrendingDown className="h-2.5 w-2.5 sm:h-3 sm:w-3 text-red-500" />
                )}
                <span
                  className={cn(
                    "text-[10px] sm:text-xs font-medium",
                    trend.isPositive ? "text-green-500" : "text-red-500"
                  )}
                >
                  {trend.value}%
                </span>
                <span className="text-[10px] sm:text-xs text-muted-foreground hidden md:inline">
                  vs last week
                </span>
              </div>
            )}
            {description && (
              <span className="text-[10px] sm:text-xs text-muted-foreground mt-0.5 sm:mt-1 hidden sm:block truncate">
                {description}
              </span>
            )}
          </div>
          <div className="flex h-8 w-8 sm:h-10 sm:w-10 md:h-12 md:w-12 shrink-0 items-center justify-center rounded-md bg-primary/10">
            <Icon className="h-4 w-4 sm:h-5 sm:w-5 md:h-6 md:w-6 text-primary" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
