import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  Accessibility,
  Zap,
  Baby,
  Clock,
  FileWarning,
  ParkingCircle,
} from "lucide-react";

type ViolationType = "disabled_bay" | "ev_bay" | "parent_child" | "overstay" | "no_permit" | "unknown";

interface ViolationBadgeProps {
  type: ViolationType | string;
  className?: string;
  showIcon?: boolean;
}

const violationConfig: Record<ViolationType, { label: string; icon: typeof Accessibility; color: string }> = {
  disabled_bay: {
    label: "Disabled Bay",
    icon: Accessibility,
    color: "bg-blue-500/10 text-blue-600 border-blue-500/20 dark:text-blue-400",
  },
  ev_bay: {
    label: "EV Bay",
    icon: Zap,
    color: "bg-green-500/10 text-green-600 border-green-500/20 dark:text-green-400",
  },
  parent_child: {
    label: "Parent & Child",
    icon: Baby,
    color: "bg-purple-500/10 text-purple-600 border-purple-500/20 dark:text-purple-400",
  },
  overstay: {
    label: "Overstay",
    icon: Clock,
    color: "bg-orange-500/10 text-orange-600 border-orange-500/20 dark:text-orange-400",
  },
  no_permit: {
    label: "No Permit",
    icon: FileWarning,
    color: "bg-red-500/10 text-red-600 border-red-500/20 dark:text-red-400",
  },
  unknown: {
    label: "Unknown",
    icon: ParkingCircle,
    color: "bg-gray-500/10 text-gray-600 border-gray-500/20 dark:text-gray-400",
  },
};

export function ViolationBadge({ type, className, showIcon = true }: ViolationBadgeProps) {
  const config = violationConfig[type as ViolationType] || violationConfig.unknown;
  const Icon = config.icon;

  return (
    <Badge
      variant="outline"
      className={cn("gap-1 font-medium", config.color, className)}
    >
      {showIcon && <Icon className="h-3 w-3" />}
      {config.label}
    </Badge>
  );
}
