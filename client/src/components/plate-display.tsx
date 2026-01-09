import { Badge } from "@/components/ui/badge";
import { CheckCircle2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface PlateDisplayProps {
  plateText: string;
  isValid?: boolean;
  confidence?: number;
  className?: string;
}

export function PlateDisplay({
  plateText,
  isValid = true,
  confidence,
  className,
}: PlateDisplayProps) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1 rounded-md border-2 border-yellow-400 bg-yellow-300 px-3 py-1.5 dark:border-yellow-500 dark:bg-yellow-400">
          <span className="font-mono text-lg font-bold tracking-wider text-black">
            {plateText}
          </span>
        </div>
        {isValid ? (
          <Badge variant="outline" className="gap-1 border-green-500/30 bg-green-500/10 text-green-600 dark:text-green-400">
            <CheckCircle2 className="h-3 w-3" />
            Valid UK
          </Badge>
        ) : (
          <Badge variant="outline" className="gap-1 border-orange-500/30 bg-orange-500/10 text-orange-600 dark:text-orange-400">
            <AlertCircle className="h-3 w-3" />
            Non-standard
          </Badge>
        )}
      </div>
      {confidence !== undefined && (
        <span className="text-xs text-muted-foreground">
          OCR Confidence: {Math.round(confidence * 100)}%
        </span>
      )}
    </div>
  );
}
