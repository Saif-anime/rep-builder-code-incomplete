import { cn } from "@/lib/utils";

interface UKNumberPlateProps {
  vrm: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}

export function UKNumberPlate({ vrm, size = "md", className }: UKNumberPlateProps) {
  const sizeClasses = {
    sm: "px-2 py-0.5 text-xs",
    md: "px-3 py-1 text-sm",
    lg: "px-4 py-1.5 text-base",
  };

  const formattedVrm = vrm?.toUpperCase().replace(/\s+/g, " ").trim() || "";

  return (
    <div
      className={cn(
        "inline-flex items-center justify-center",
        "bg-[#FFD200] text-black font-bold",
        "border-2 border-black rounded",
        "font-mono tracking-wider",
        "shadow-sm",
        sizeClasses[size],
        className
      )}
      style={{
        fontFamily: "'JetBrains Mono', 'Courier New', monospace",
        letterSpacing: "0.1em",
      }}
      data-testid="uk-number-plate"
    >
      {formattedVrm}
    </div>
  );
}
