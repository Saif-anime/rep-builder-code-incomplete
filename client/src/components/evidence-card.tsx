import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Eye, Download, Camera, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Evidence } from "@shared/schema";
import { format } from "date-fns";

interface EvidenceCardProps {
  evidence: Evidence;
  onClick?: () => void;
  onDownload?: () => void;
  className?: string;
}

function getStatusBadgeVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "approved":
      return "default";
    case "pending":
      return "secondary";
    case "rejected":
      return "destructive";
    default:
      return "outline";
  }
}

export function EvidenceCard({ evidence, onClick, onDownload, className }: EvidenceCardProps) {
  return (
    <Card
      className={cn(
        "group overflow-hidden hover-elevate cursor-pointer transition-all",
        className
      )}
      onClick={onClick}
      data-testid={`evidence-card-${evidence.id}`}
    >
      <div className="relative aspect-video bg-muted">
        {evidence.thumbnailPath || evidence.imagePath ? (
          <img
            src={evidence.thumbnailPath || evidence.imagePath || ""}
            alt={`Evidence ${evidence.id}`}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            {evidence.type === "camera" ? (
              <Camera className="h-12 w-12 text-muted-foreground/50" />
            ) : (
              <Upload className="h-12 w-12 text-muted-foreground/50" />
            )}
          </div>
        )}
        
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
        
        <div className="absolute bottom-2 left-2 right-2 flex items-end justify-between">
          <div className="flex flex-col gap-1">
            <span className="font-mono text-xs text-white/90">
              {format(new Date(evidence.timestamp), "dd/MM/yyyy HH:mm:ss")}
            </span>
            {evidence.cameraId && (
              <span className="text-xs text-white/70">Camera #{evidence.cameraId}</span>
            )}
          </div>
        </div>

        <Badge
          variant={getStatusBadgeVariant(evidence.status)}
          className="absolute right-2 top-2 text-[10px]"
        >
          {evidence.status.charAt(0).toUpperCase() + evidence.status.slice(1)}
        </Badge>

        <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
          <Button
            size="icon"
            variant="secondary"
            onClick={(e) => {
              e.stopPropagation();
              onClick?.();
            }}
            data-testid={`button-view-evidence-${evidence.id}`}
          >
            <Eye className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant="secondary"
            onClick={(e) => {
              e.stopPropagation();
              onDownload?.();
            }}
            data-testid={`button-download-evidence-${evidence.id}`}
          >
            <Download className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-[10px]">
              {evidence.type === "camera" ? "Camera" : "Manual"}
            </Badge>
            {evidence.bayId && (
              <Badge variant="outline" className="text-[10px]">
                Bay #{evidence.bayId}
              </Badge>
            )}
          </div>
          <span className="font-mono text-xs text-muted-foreground">
            #{evidence.id.toString().padStart(6, "0")}
          </span>
        </div>
        {evidence.notes && (
          <p className="mt-2 text-xs text-muted-foreground line-clamp-2">{evidence.notes}</p>
        )}
      </div>
    </Card>
  );
}
