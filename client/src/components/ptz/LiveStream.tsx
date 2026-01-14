import { useState, useRef, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Video,
  VideoOff,
  Maximize2,
  Minimize2,
  RefreshCw,
  Camera,
} from "lucide-react";

interface LiveStreamProps {
  cameraId: number;
  cameraName?: string;
  webrtcUrl?: string;
  onFullscreen?: () => void;
}

export function LiveStream({
  cameraId,
  cameraName = "Camera",
  webrtcUrl,
  onFullscreen,
}: LiveStreamProps) {
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);

  const connectStream = async () => {
    if (!webrtcUrl) {
      setError("WebRTC URL not configured");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      });

      pc.ontrack = (event) => {
        if (videoRef.current && event.streams[0]) {
          videoRef.current.srcObject = event.streams[0];
          setIsConnected(true);
        }
      };

      pc.oniceconnectionstatechange = () => {
        if (pc.iceConnectionState === "disconnected" || pc.iceConnectionState === "failed") {
          setIsConnected(false);
          setError("Stream disconnected");
        }
      };

      pc.addTransceiver("video", { direction: "recvonly" });
      pc.addTransceiver("audio", { direction: "recvonly" });

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const response = await fetch(webrtcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/sdp" },
        body: offer.sdp,
      });

      if (!response.ok) {
        throw new Error(`Failed to connect: ${response.status}`);
      }

      const answerSdp = await response.text();
      await pc.setRemoteDescription({
        type: "answer",
        sdp: answerSdp,
      });

      peerConnectionRef.current = pc;
    } catch (err) {
      console.error("[LiveStream] Connection error:", err);
      setError(err instanceof Error ? err.message : "Connection failed");
      setIsConnected(false);
    } finally {
      setIsLoading(false);
    }
  };

  const disconnectStream = () => {
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsConnected(false);
  };

  const toggleFullscreen = () => {
    if (!containerRef.current) return;

    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
    onFullscreen?.();
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      disconnectStream();
    };
  }, []);

  return (
    <Card ref={containerRef} className={isFullscreen ? "fixed inset-0 z-50 rounded-none" : ""}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-lg flex items-center gap-2">
            <Camera className="h-4 w-4" />
            {cameraName}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant={isConnected ? "default" : "secondary"}>
              {isConnected ? (
                <><Video className="h-3 w-3 mr-1" /> Live</>
              ) : (
                <><VideoOff className="h-3 w-3 mr-1" /> Offline</>
              )}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="relative aspect-video bg-black rounded-md overflow-hidden">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-contain"
            data-testid="live-stream-video"
          />

          {!isConnected && !isLoading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-white bg-black/80">
              <VideoOff className="h-12 w-12 mb-4 opacity-50" />
              <p className="text-sm text-muted-foreground mb-4">
                {error || "Stream not connected"}
              </p>
              {webrtcUrl ? (
                <Button
                  variant="outline"
                  onClick={connectStream}
                  disabled={isLoading}
                  data-testid="connect-stream-button"
                >
                  <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
                  Connect
                </Button>
              ) : (
                <div className="text-center px-4">
                  <p className="text-xs text-muted-foreground">
                    Live streaming requires MediaMTX server.
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Configure WebRTC URL to enable streaming.
                  </p>
                </div>
              )}
            </div>
          )}

          {isLoading && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/80">
              <RefreshCw className="h-8 w-8 animate-spin text-white" />
            </div>
          )}

          <div className="absolute bottom-2 right-2 flex gap-1">
            <Button
              size="icon"
              variant="secondary"
              className="h-8 w-8 bg-black/50 hover:bg-black/70"
              onClick={toggleFullscreen}
              data-testid="fullscreen-button"
            >
              {isFullscreen ? (
                <Minimize2 className="h-4 w-4 text-white" />
              ) : (
                <Maximize2 className="h-4 w-4 text-white" />
              )}
            </Button>
          </div>
        </div>

        <div className="mt-3 text-xs text-muted-foreground">
          <p>Camera ID: {cameraId}</p>
          {!webrtcUrl && (
            <p className="mt-1">
              To enable live streaming, set up MediaMTX with your camera's RTSP stream.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
