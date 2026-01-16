import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Eye, Download, Camera, Upload, Loader2, CheckCircle, XCircle, Clock, AlertTriangle, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Evidence } from "@shared/schema";
import { format } from "date-fns";

interface EvidenceCardProps {
  evidence: Evidence;
  onClick?: () => void;
  onDownload?: () => void;
  onDelete?: () => void;
  isDeleting?: boolean;
  canDelete?: boolean;
  className?: string;
}

function getStatusBadgeConfig(status: string): { 
  variant: "default" | "secondary" | "destructive" | "outline";
  className: string;
  icon?: JSX.Element;
  label: string;
} {
  switch (status) {
    case "pending":
      return { 
        variant: "secondary", 
        className: "bg-gray-500/20 text-gray-700 dark:text-gray-300",
        icon: <Clock className="h-3 w-3 mr-1" />,
        label: "Pending"
      };
    case "analyzing":
      return { 
        variant: "secondary", 
        className: "bg-yellow-500/20 text-yellow-700 dark:text-yellow-300",
        icon: <Loader2 className="h-3 w-3 mr-1 animate-spin" />,
        label: "Analyzing"
      };
    case "completed":
      return { 
        variant: "default", 
        className: "bg-green-500/20 text-green-700 dark:text-green-300",
        icon: <CheckCircle className="h-3 w-3 mr-1" />,
        label: "Completed"
      };
    case "failed":
      return { 
        variant: "destructive", 
        className: "bg-red-500/20 text-red-700 dark:text-red-300",
        icon: <XCircle className="h-3 w-3 mr-1" />,
        label: "Failed"
      };
    case "approved":
      return { 
        variant: "default", 
        className: "bg-blue-500/20 text-blue-700 dark:text-blue-300",
        icon: <CheckCircle className="h-3 w-3 mr-1" />,
        label: "Approved"
      };
    case "rejected":
      return { 
        variant: "destructive", 
        className: "bg-red-500/20 text-red-700 dark:text-red-300",
        icon: <XCircle className="h-3 w-3 mr-1" />,
        label: "Rejected"
      };
    case "reviewed":
      return { 
        variant: "outline", 
        className: "",
        icon: <Eye className="h-3 w-3 mr-1" />,
        label: "Reviewed"
      };
    default:
      return { variant: "outline", className: "", label: status };
  }
}

export function EvidenceCard({ evidence, onClick, onDownload, onDelete, isDeleting = false, canDelete = true, className }: EvidenceCardProps) {
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

        {(() => {
          const config = getStatusBadgeConfig(evidence.status);
          return (
            <Badge
              variant={config.variant}
              className={cn("absolute right-2 top-2 text-[10px] flex items-center", config.className)}
            >
              {config.icon}
              {config.label}
            </Badge>
          );
        })()}

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
          {onDelete && (
            <Button
              size="icon"
              variant="destructive"
              onClick={(e) => {
                e.stopPropagation();
                if (canDelete && !isDeleting) {
                  onDelete();
                }
              }}
              disabled={!canDelete || isDeleting}
              title={!canDelete ? "Cannot delete - analysis in progress or PCN issued" : "Delete evidence"}
              data-testid={`button-delete-evidence-${evidence.id}`}
            >
              {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            </Button>
          )}
        </div>
      </div>

      <div className="p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className="text-[10px]">
              {evidence.type === "camera" ? "Camera" : "Manual"}
            </Badge>
            {evidence.bayId && (
              <Badge variant="outline" className="text-[10px]">
                Bay #{evidence.bayId}
              </Badge>
            )}
            {evidence.confidenceScore !== null && evidence.confidenceScore !== undefined && (
              <Badge 
                variant="outline" 
                className={cn(
                  "text-[10px]",
                  evidence.confidenceScore >= 0.8 ? "text-green-600 dark:text-green-400" : 
                  evidence.confidenceScore >= 0.5 ? "text-yellow-600 dark:text-yellow-400" : 
                  "text-red-600 dark:text-red-400"
                )}
              >
                {Math.round(evidence.confidenceScore * 100)}% AI
              </Badge>
            )}
          </div>
          <span className="font-mono text-xs text-muted-foreground">
            #{evidence.id.toString().padStart(6, "0")}
          </span>
        </div>
        
        {evidence.status === "completed" && evidence.aiResult && (
          <div className="mt-2 p-2 bg-muted/50 rounded-md">
            <div className="flex items-center gap-1 mb-1">
              {(evidence.aiResult as any).violationDetected ? (
                <AlertTriangle className="h-3 w-3 text-red-500" />
              ) : (
                <CheckCircle className="h-3 w-3 text-green-500" />
              )}
              <span className="text-xs font-medium">
                {(evidence.aiResult as any).violationDetected ? "Violation Detected" : "No Violation"}
              </span>
            </div>
            <p className="text-xs text-muted-foreground line-clamp-2">
              {(evidence.aiResult as any).explanation}
            </p>
            {(evidence.aiResult as any).numberPlate && (
              <p className="text-xs font-mono mt-1">
                Plate: {(evidence.aiResult as any).numberPlate}
              </p>
            )}
          </div>
        )}
        
        {evidence.status === "failed" && evidence.analysisError && (
          <div className="mt-2 p-2 bg-red-500/10 rounded-md">
            <p className="text-xs text-red-600 dark:text-red-400 line-clamp-2">
              {evidence.analysisError}
            </p>
          </div>
        )}
        
        {evidence.notes && (
          <p className="mt-2 text-xs text-muted-foreground line-clamp-2">{evidence.notes}</p>
        )}
      </div>
    </Card>
  );
}
