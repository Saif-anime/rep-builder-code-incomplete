import { useState, useCallback, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ChevronLeft,
  ChevronRight,
  X,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Play,
  Pause,
  FileVideo,
  FileImage,
  Maximize2,
} from "lucide-react";
import type { Evidence } from "@shared/schema";

interface EvidenceViewerProps {
  evidence: Evidence;
  allEvidence?: Evidence[];
  className?: string;
  showBadge?: boolean;
}

interface FullscreenViewerProps {
  evidence: Evidence[];
  initialIndex: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function FullscreenViewer({ evidence, initialIndex, open, onOpenChange }: FullscreenViewerProps) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [isPlaying, setIsPlaying] = useState(false);
  const [touchStart, setTouchStart] = useState<{ x: number; y: number } | null>(null);

  const currentItem = evidence[currentIndex];
  const isImage = !!currentItem?.imagePath;
  const isVideo = !!currentItem?.videoPath;
  const mediaUrl = currentItem?.imagePath || currentItem?.videoPath;

  useEffect(() => {
    setCurrentIndex(initialIndex);
  }, [initialIndex]);

  useEffect(() => {
    if (open) {
      setZoom(1);
      setPan({ x: 0, y: 0 });
      setIsPlaying(false);
    }
  }, [open, currentIndex]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!open) return;
    
    switch (e.key) {
      case "Escape":
        onOpenChange(false);
        break;
      case "ArrowLeft":
        if (currentIndex > 0) {
          setCurrentIndex(currentIndex - 1);
          setZoom(1);
          setPan({ x: 0, y: 0 });
        }
        break;
      case "ArrowRight":
        if (currentIndex < evidence.length - 1) {
          setCurrentIndex(currentIndex + 1);
          setZoom(1);
          setPan({ x: 0, y: 0 });
        }
        break;
      case "+":
      case "=":
        setZoom(z => Math.min(z + 0.25, 4));
        break;
      case "-":
        setZoom(z => Math.max(z - 0.25, 0.5));
        break;
      case "0":
        setZoom(1);
        setPan({ x: 0, y: 0 });
        break;
    }
  }, [open, currentIndex, evidence.length, onOpenChange]);

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (zoom > 1 && isImage) {
      setIsDragging(true);
      setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging) {
      setPan({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const [lastTap, setLastTap] = useState(0);
  const [initialPinchDistance, setInitialPinchDistance] = useState<number | null>(null);
  const [initialZoom, setInitialZoom] = useState(1);

  const getTouchDistance = (touches: React.TouchList) => {
    if (touches.length < 2) return 0;
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      setTouchStart({ x: e.touches[0].clientX, y: e.touches[0].clientY });
    } else if (e.touches.length === 2 && isImage) {
      const distance = getTouchDistance(e.touches);
      setInitialPinchDistance(distance);
      setInitialZoom(zoom);
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && initialPinchDistance && isImage) {
      const currentDistance = getTouchDistance(e.touches);
      const scale = currentDistance / initialPinchDistance;
      const newZoom = Math.min(Math.max(initialZoom * scale, 0.5), 4);
      setZoom(newZoom);
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (initialPinchDistance) {
      setInitialPinchDistance(null);
      return;
    }
    
    if (!touchStart) return;
    
    const touchEnd = e.changedTouches[0];
    const deltaX = touchEnd.clientX - touchStart.x;
    const deltaY = touchEnd.clientY - touchStart.y;
    
    const now = Date.now();
    const isDoubleTap = now - lastTap < 300 && Math.abs(deltaX) < 10 && Math.abs(deltaY) < 10;
    setLastTap(now);
    
    if (isDoubleTap && isImage) {
      if (zoom === 1) {
        setZoom(2);
      } else {
        setZoom(1);
        setPan({ x: 0, y: 0 });
      }
      setTouchStart(null);
      return;
    }
    
    if (zoom === 1 && Math.abs(deltaX) > 50 && Math.abs(deltaX) > Math.abs(deltaY)) {
      if (deltaX > 0 && currentIndex > 0) {
        setCurrentIndex(currentIndex - 1);
        setZoom(1);
        setPan({ x: 0, y: 0 });
      } else if (deltaX < 0 && currentIndex < evidence.length - 1) {
        setCurrentIndex(currentIndex + 1);
        setZoom(1);
        setPan({ x: 0, y: 0 });
      }
    }
    
    setTouchStart(null);
  };

  const handleDoubleClick = () => {
    if (isImage) {
      if (zoom === 1) {
        setZoom(2);
      } else {
        setZoom(1);
        setPan({ x: 0, y: 0 });
      }
    }
  };

  const goToPrevious = () => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
      setZoom(1);
      setPan({ x: 0, y: 0 });
    }
  };

  const goToNext = () => {
    if (currentIndex < evidence.length - 1) {
      setCurrentIndex(currentIndex + 1);
      setZoom(1);
      setPan({ x: 0, y: 0 });
    }
  };

  const resetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  if (!currentItem) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent 
        className="max-w-[95vw] max-h-[95vh] w-full h-full p-0 bg-black/95 border-none"
        aria-describedby={undefined}
      >
        <DialogTitle className="sr-only">Evidence Viewer - {currentIndex + 1} of {evidence.length}</DialogTitle>
        
        <div 
          className="relative w-full h-full flex items-center justify-center select-none"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onDoubleClick={handleDoubleClick}
          role="dialog"
          aria-label="Evidence viewer"
        >
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-4 right-4 z-50 text-white hover:bg-white/20"
            onClick={() => onOpenChange(false)}
            data-testid="button-close-viewer"
          >
            <X className="h-6 w-6" />
          </Button>

          <div className="absolute top-4 left-4 z-50 flex items-center gap-2">
            <Badge variant="secondary" className="bg-black/50 text-white border-none">
              {currentIndex + 1} / {evidence.length}
            </Badge>
            <Badge variant="secondary" className="bg-black/50 text-white border-none">
              #{currentItem.id}
            </Badge>
          </div>

          {isImage && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="text-white hover:bg-white/20 h-8 w-8"
                onClick={() => setZoom(z => Math.max(z - 0.25, 0.5))}
                data-testid="button-zoom-out"
              >
                <ZoomOut className="h-4 w-4" />
              </Button>
              <span className="text-white text-sm px-2 min-w-[50px] text-center">
                {Math.round(zoom * 100)}%
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="text-white hover:bg-white/20 h-8 w-8"
                onClick={() => setZoom(z => Math.min(z + 0.25, 4))}
                data-testid="button-zoom-in"
              >
                <ZoomIn className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="text-white hover:bg-white/20 h-8 w-8"
                onClick={resetView}
                data-testid="button-reset-zoom"
              >
                <RotateCcw className="h-4 w-4" />
              </Button>
            </div>
          )}

          {evidence.length > 1 && (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="absolute left-4 top-1/2 -translate-y-1/2 z-50 text-white hover:bg-white/20 h-12 w-12"
                onClick={goToPrevious}
                disabled={currentIndex === 0}
                data-testid="button-previous-evidence"
              >
                <ChevronLeft className="h-8 w-8" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-4 top-1/2 -translate-y-1/2 z-50 text-white hover:bg-white/20 h-12 w-12"
                onClick={goToNext}
                disabled={currentIndex === evidence.length - 1}
                data-testid="button-next-evidence"
              >
                <ChevronRight className="h-8 w-8" />
              </Button>
            </>
          )}

          <div className="w-full h-full flex items-center justify-center p-12 overflow-hidden">
            {isImage && mediaUrl && (
              <img
                src={mediaUrl}
                alt={`Evidence #${currentItem.id}`}
                className="max-w-full max-h-full object-contain transition-transform duration-100"
                style={{
                  transform: `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)`,
                  cursor: zoom > 1 ? (isDragging ? "grabbing" : "grab") : "default",
                }}
                draggable={false}
              />
            )}
            {isVideo && mediaUrl && (
              <div className="relative w-full h-full flex items-center justify-center">
                <video
                  src={mediaUrl}
                  className="max-w-full max-h-full object-contain"
                  controls
                  autoPlay={isPlaying}
                  onPlay={() => setIsPlaying(true)}
                  onPause={() => setIsPlaying(false)}
                  data-testid="video-player"
                >
                  Your browser does not support video playback.
                </video>
              </div>
            )}
          </div>

          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-50 flex gap-1">
            {evidence.slice(0, 10).map((item, idx) => (
              <button
                key={item.id}
                onClick={() => {
                  setCurrentIndex(idx);
                  setZoom(1);
                  setPan({ x: 0, y: 0 });
                }}
                className={`w-12 h-8 rounded overflow-hidden border-2 transition-all ${
                  idx === currentIndex 
                    ? "border-white scale-110" 
                    : "border-white/30 hover:border-white/60"
                }`}
                data-testid={`button-thumbnail-${item.id}`}
              >
                {item.imagePath ? (
                  <img 
                    src={item.imagePath} 
                    alt="" 
                    className="w-full h-full object-cover" 
                  />
                ) : (
                  <div className="w-full h-full bg-muted flex items-center justify-center">
                    <FileVideo className="h-3 w-3 text-muted-foreground" />
                  </div>
                )}
              </button>
            ))}
            {evidence.length > 10 && (
              <div className="w-12 h-8 rounded bg-black/50 flex items-center justify-center text-white text-xs">
                +{evidence.length - 10}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function EvidenceViewer({ 
  evidence, 
  allEvidence, 
  className = "",
  showBadge = true,
}: EvidenceViewerProps) {
  const [isFullscreenOpen, setIsFullscreenOpen] = useState(false);
  
  const evidenceList = allEvidence || [evidence];
  const currentIndex = evidenceList.findIndex(e => e.id === evidence.id);
  
  const isImage = !!evidence.imagePath;
  const isVideo = !!evidence.videoPath;
  const thumbnailUrl = evidence.thumbnailPath || evidence.imagePath;
  const previewUrl = evidence.imagePath || evidence.videoPath;

  const handleClick = () => {
    setIsFullscreenOpen(true);
  };

  const ThumbnailContent = (
    <div 
      className={`relative aspect-video rounded-md overflow-hidden bg-muted cursor-pointer group ${className}`}
      onClick={handleClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          handleClick();
        }
      }}
      aria-label={`View evidence #${evidence.id}`}
      data-testid={`evidence-thumbnail-${evidence.id}`}
    >
      {isImage && thumbnailUrl ? (
        <img 
          src={thumbnailUrl} 
          alt={`Evidence #${evidence.id}`}
          className="w-full h-full object-cover transition-transform group-hover:scale-105"
          loading="lazy"
        />
      ) : isVideo ? (
        <div className="w-full h-full flex items-center justify-center bg-muted">
          <FileVideo className="h-8 w-8 text-muted-foreground" />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-10 h-10 rounded-full bg-black/50 flex items-center justify-center">
              <Play className="h-4 w-4 text-white ml-0.5" />
            </div>
          </div>
        </div>
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          <FileImage className="h-8 w-8 text-muted-foreground" />
        </div>
      )}
      
      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
        <Maximize2 className="h-6 w-6 text-white drop-shadow-lg" />
      </div>
      
      {showBadge && (
        <Badge variant="secondary" className="absolute bottom-1 right-1 text-[10px]">
          #{evidence.id}
        </Badge>
      )}
    </div>
  );

  return (
    <>
      <HoverCard openDelay={300} closeDelay={100}>
        <HoverCardTrigger asChild>
          {ThumbnailContent}
        </HoverCardTrigger>
        <HoverCardContent 
          side="top" 
          className="w-auto p-2 bg-popover/95 backdrop-blur-sm shadow-lg border border-border"
          sideOffset={8}
        >
          <div className="max-w-[300px] max-h-[220px] overflow-hidden rounded-md">
            {isImage && previewUrl ? (
              <img 
                src={previewUrl} 
                alt={`Evidence #${evidence.id} preview`}
                className="w-full h-full object-contain"
                loading="lazy"
              />
            ) : isVideo && previewUrl ? (
              <div className="relative w-[300px] h-[180px] bg-muted flex items-center justify-center">
                <FileVideo className="h-12 w-12 text-muted-foreground" />
                <div className="absolute bottom-2 left-2">
                  <Badge variant="secondary" className="text-xs">
                    Video
                  </Badge>
                </div>
              </div>
            ) : (
              <div className="w-[300px] h-[180px] bg-muted flex items-center justify-center">
                <FileImage className="h-12 w-12 text-muted-foreground" />
              </div>
            )}
          </div>
          <div className="mt-2 text-xs text-muted-foreground text-center">
            Click to view full size
          </div>
        </HoverCardContent>
      </HoverCard>

      <FullscreenViewer
        evidence={evidenceList}
        initialIndex={currentIndex >= 0 ? currentIndex : 0}
        open={isFullscreenOpen}
        onOpenChange={setIsFullscreenOpen}
      />
    </>
  );
}

export function EvidenceGallery({ 
  evidence,
  maxVisible = 6,
  className = "",
}: { 
  evidence: Evidence[];
  maxVisible?: number;
  className?: string;
}) {
  const [fullscreenOpen, setFullscreenOpen] = useState(false);
  const [initialIndex, setInitialIndex] = useState(0);

  const visibleEvidence = evidence.slice(0, maxVisible);
  const remainingCount = evidence.length - maxVisible;

  const handleOpenFullscreen = (index: number) => {
    setInitialIndex(index);
    setFullscreenOpen(true);
  };

  return (
    <>
      <div className={`grid grid-cols-2 sm:grid-cols-3 gap-2 ${className}`}>
        {visibleEvidence.map((item, index) => (
          <EvidenceViewer
            key={item.id}
            evidence={item}
            allEvidence={evidence}
          />
        ))}
        {remainingCount > 0 && (
          <div 
            className="aspect-video rounded-md bg-muted flex items-center justify-center cursor-pointer hover-elevate"
            onClick={() => handleOpenFullscreen(maxVisible)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                handleOpenFullscreen(maxVisible);
              }
            }}
            data-testid="button-view-more-evidence"
          >
            <span className="text-sm text-muted-foreground">+{remainingCount} more</span>
          </div>
        )}
      </div>

      <FullscreenViewer
        evidence={evidence}
        initialIndex={initialIndex}
        open={fullscreenOpen}
        onOpenChange={setFullscreenOpen}
      />
    </>
  );
}
