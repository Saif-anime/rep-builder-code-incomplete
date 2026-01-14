import { useState, useRef, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import {
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ZoomIn,
  ZoomOut,
  Square,
  Circle,
  Wifi,
  WifiOff,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { apiRequest } from "@/lib/queryClient";

interface PTZJoystickProps {
  cameraId: number;
  onConnectionChange?: (connected: boolean) => void;
}

export function PTZJoystick({ cameraId, onConnectionChange }: PTZJoystickProps) {
  const [connected, setConnected] = useState(true);
  const [speed, setSpeed] = useState(50);
  const [error, setError] = useState<string | null>(null);
  const [isMoving, setIsMoving] = useState(false);
  const joystickRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [joystickPos, setJoystickPos] = useState({ x: 0, y: 0 });
  const animationFrameRef = useRef<number | null>(null);
  const moveIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastCommandRef = useRef<{ pan: number; tilt: number; zoom: number } | null>(null);

  const sendPTZCommand = useCallback(async (pan: number, tilt: number, zoom: number = 0) => {
    try {
      await apiRequest("POST", "/api/ptz/move", {
        cameraId,
        pan: Math.round(pan * speed / 100),
        tilt: Math.round(tilt * speed / 100),
        zoom: Math.round(zoom * speed / 100),
      });
      setError(null);
      setConnected(true);
      onConnectionChange?.(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : "PTZ command failed";
      setError(message);
      setConnected(false);
      onConnectionChange?.(false);
    }
  }, [cameraId, speed, onConnectionChange]);

  const stop = useCallback(async () => {
    if (moveIntervalRef.current) {
      clearInterval(moveIntervalRef.current);
      moveIntervalRef.current = null;
    }
    lastCommandRef.current = null;
    setJoystickPos({ x: 0, y: 0 });
    setIsMoving(false);

    try {
      await apiRequest("POST", "/api/ptz/stop", { cameraId });
      setError(null);
    } catch (err) {
      console.error("[PTZ] Stop error:", err);
    }
  }, [cameraId]);

  const startContinuousMove = useCallback((pan: number, tilt: number, zoom: number = 0) => {
    if (moveIntervalRef.current) {
      clearInterval(moveIntervalRef.current);
    }

    lastCommandRef.current = { pan, tilt, zoom };
    setIsMoving(true);
    
    sendPTZCommand(pan, tilt, zoom);
    
    moveIntervalRef.current = setInterval(() => {
      if (lastCommandRef.current) {
        sendPTZCommand(
          lastCommandRef.current.pan,
          lastCommandRef.current.tilt,
          lastCommandRef.current.zoom
        );
      }
    }, 200);
  }, [sendPTZCommand]);

  const handleJoystickStart = useCallback((clientX: number, clientY: number) => {
    if (!joystickRef.current) return;
    setIsDragging(true);
    updateJoystickPosition(clientX, clientY);
  }, []);

  const updateJoystickPosition = useCallback((clientX: number, clientY: number) => {
    if (!joystickRef.current) return;

    const rect = joystickRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const radius = rect.width / 2 - 20;

    let dx = clientX - centerX;
    let dy = clientY - centerY;

    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance > radius) {
      dx = (dx / distance) * radius;
      dy = (dy / distance) * radius;
    }

    const normalizedX = dx / radius;
    const normalizedY = -dy / radius;

    setJoystickPos({ x: dx, y: dy });

    const pan = Math.round(normalizedX * 100);
    const tilt = Math.round(normalizedY * 100);

    if (Math.abs(pan) > 10 || Math.abs(tilt) > 10) {
      if (!lastCommandRef.current || 
          Math.abs(lastCommandRef.current.pan - pan) > 15 || 
          Math.abs(lastCommandRef.current.tilt - tilt) > 15) {
        startContinuousMove(pan, tilt);
      }
    }
  }, [startContinuousMove]);

  const handleJoystickMove = useCallback((clientX: number, clientY: number) => {
    if (!isDragging) return;
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    animationFrameRef.current = requestAnimationFrame(() => {
      updateJoystickPosition(clientX, clientY);
    });
  }, [isDragging, updateJoystickPosition]);

  const handleJoystickEnd = useCallback(() => {
    setIsDragging(false);
    stop();
  }, [stop]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => handleJoystickMove(e.clientX, e.clientY);
    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length > 0) {
        handleJoystickMove(e.touches[0].clientX, e.touches[0].clientY);
      }
    };
    const handleEnd = () => handleJoystickEnd();

    if (isDragging) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleEnd);
      window.addEventListener("touchmove", handleTouchMove);
      window.addEventListener("touchend", handleEnd);
    }

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleEnd);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handleEnd);
    };
  }, [isDragging, handleJoystickMove, handleJoystickEnd]);

  useEffect(() => {
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (moveIntervalRef.current) {
        clearInterval(moveIntervalRef.current);
      }
    };
  }, []);

  const handleButtonDown = useCallback((direction: string) => {
    switch (direction) {
      case "up": startContinuousMove(0, 100); break;
      case "down": startContinuousMove(0, -100); break;
      case "left": startContinuousMove(-100, 0); break;
      case "right": startContinuousMove(100, 0); break;
      case "zoomIn": startContinuousMove(0, 0, 100); break;
      case "zoomOut": startContinuousMove(0, 0, -100); break;
    }
  }, [startContinuousMove]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-lg">PTZ Control</CardTitle>
          <Badge variant={connected ? "default" : "secondary"}>
            {connected ? (
              <><Wifi className="h-3 w-3 mr-1" /> Ready</>
            ) : (
              <><WifiOff className="h-3 w-3 mr-1" /> Error</>
            )}
          </Badge>
        </div>
        {error && (
          <p className="text-sm text-destructive">{error}</p>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col items-center gap-4">
          <div
            ref={joystickRef}
            className="relative w-32 h-32 rounded-full bg-muted border-2 border-border cursor-pointer select-none touch-none"
            onMouseDown={(e) => handleJoystickStart(e.clientX, e.clientY)}
            onTouchStart={(e) => {
              if (e.touches.length > 0) {
                handleJoystickStart(e.touches[0].clientX, e.touches[0].clientY);
              }
            }}
            data-testid="ptz-joystick"
          >
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-16 h-16 rounded-full border border-dashed border-muted-foreground/30" />
            </div>
            <div
              className={`absolute w-10 h-10 rounded-full shadow-lg transition-transform duration-75 ${
                isMoving ? "bg-primary" : "bg-muted-foreground"
              }`}
              style={{
                left: `calc(50% + ${joystickPos.x}px - 20px)`,
                top: `calc(50% + ${joystickPos.y}px - 20px)`,
              }}
            >
              <Circle className="w-full h-full text-primary-foreground p-2" />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-1">
            <div />
            <Button
              size="icon"
              variant="outline"
              onMouseDown={() => handleButtonDown("up")}
              onMouseUp={stop}
              onMouseLeave={stop}
              onTouchStart={() => handleButtonDown("up")}
              onTouchEnd={stop}
              data-testid="ptz-up"
            >
              <ArrowUp className="h-4 w-4" />
            </Button>
            <div />
            <Button
              size="icon"
              variant="outline"
              onMouseDown={() => handleButtonDown("left")}
              onMouseUp={stop}
              onMouseLeave={stop}
              onTouchStart={() => handleButtonDown("left")}
              onTouchEnd={stop}
              data-testid="ptz-left"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <Button
              size="icon"
              variant="outline"
              onClick={stop}
              data-testid="ptz-stop"
            >
              <Square className="h-4 w-4" />
            </Button>
            <Button
              size="icon"
              variant="outline"
              onMouseDown={() => handleButtonDown("right")}
              onMouseUp={stop}
              onMouseLeave={stop}
              onTouchStart={() => handleButtonDown("right")}
              onTouchEnd={stop}
              data-testid="ptz-right"
            >
              <ArrowRight className="h-4 w-4" />
            </Button>
            <div />
            <Button
              size="icon"
              variant="outline"
              onMouseDown={() => handleButtonDown("down")}
              onMouseUp={stop}
              onMouseLeave={stop}
              onTouchStart={() => handleButtonDown("down")}
              onTouchEnd={stop}
              data-testid="ptz-down"
            >
              <ArrowDown className="h-4 w-4" />
            </Button>
            <div />
          </div>

          <div className="flex items-center gap-2">
            <Button
              size="icon"
              variant="outline"
              onMouseDown={() => handleButtonDown("zoomOut")}
              onMouseUp={stop}
              onMouseLeave={stop}
              onTouchStart={() => handleButtonDown("zoomOut")}
              onTouchEnd={stop}
              data-testid="ptz-zoom-out"
            >
              <ZoomOut className="h-4 w-4" />
            </Button>
            <div className="w-24">
              <Slider
                value={[speed]}
                onValueChange={(v) => setSpeed(v[0])}
                min={10}
                max={100}
                step={10}
                data-testid="ptz-speed-slider"
              />
            </div>
            <Button
              size="icon"
              variant="outline"
              onMouseDown={() => handleButtonDown("zoomIn")}
              onMouseUp={stop}
              onMouseLeave={stop}
              onTouchStart={() => handleButtonDown("zoomIn")}
              onTouchEnd={stop}
              data-testid="ptz-zoom-in"
            >
              <ZoomIn className="h-4 w-4" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">Speed: {speed}%</p>
        </div>
      </CardContent>
    </Card>
  );
}
