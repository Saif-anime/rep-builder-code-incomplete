import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

interface ActivityItemProps {
  action: string;
  entityType: string;
  entityId?: string;
  userName?: string;
  timestamp: Date;
  details?: string;
  className?: string;
}

function getActionColor(action: string): string {
  switch (action) {
    case "create":
      return "bg-green-500";
    case "update":
      return "bg-blue-500";
    case "delete":
      return "bg-red-500";
    case "approve":
      return "bg-emerald-500";
    case "reject":
      return "bg-orange-500";
    case "view":
      return "bg-gray-400";
    default:
      return "bg-gray-400";
  }
}

export function ActivityItem({
  action,
  entityType,
  entityId,
  userName,
  timestamp,
  details,
  className,
}: ActivityItemProps) {
  return (
    <div className={cn("flex items-start gap-3 py-3", className)}>
      <div className="relative flex flex-col items-center">
        <Avatar className="h-8 w-8">
          <AvatarFallback className="bg-muted text-xs">
            {userName?.split(" ").map((n) => n[0]).join("").toUpperCase() || "S"}
          </AvatarFallback>
        </Avatar>
        <div className={cn("absolute -bottom-1 -right-1 h-3 w-3 rounded-full border-2 border-background", getActionColor(action))} />
      </div>
      <div className="flex-1 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium">{userName || "System"}</span>
          <Badge variant="outline" className="text-[10px] px-1.5">
            {action.charAt(0).toUpperCase() + action.slice(1)}
          </Badge>
          <span className="text-sm text-muted-foreground">
            {entityType}
            {entityId && (
              <span className="font-mono ml-1 text-xs">#{entityId}</span>
            )}
          </span>
        </div>
        {details && (
          <p className="text-xs text-muted-foreground">{details}</p>
        )}
        <span className="font-mono text-[10px] text-muted-foreground">
          {format(timestamp, "dd/MM/yyyy HH:mm:ss")}
        </span>
      </div>
    </div>
  );
}
