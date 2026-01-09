import { useState, useRef, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { EvidenceCard } from "@/components/evidence-card";
import { Upload, FileImage, Camera, Filter, Loader2, RefreshCw, MapPin } from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Evidence, Bay, ParkingSite, Camera as CameraType } from "@shared/schema";

type SourceFilter = "all" | "camera" | "manual";

export default function EvidencePage() {
  const { toast } = useToast();
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [selectedEvidence, setSelectedEvidence] = useState<Evidence | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [notes, setNotes] = useState("");
  const [selectedBayId, setSelectedBayId] = useState<string>("");
  const [selectedSiteId, setSelectedSiteId] = useState<string>("");
  const [selectedCameraId, setSelectedCameraId] = useState<string>("");

  const { data: evidenceList = [], isLoading, refetch } = useQuery<Evidence[]>({
    queryKey: ["/api/evidence"],
    refetchInterval: 10000,
  });

  const { data: bays = [] } = useQuery<Bay[]>({
    queryKey: ["/api/bays"],
  });

  const { data: parkingSites = [] } = useQuery<ParkingSite[]>({
    queryKey: ["/api/parking-sites"],
  });

  const { data: allCameras = [] } = useQuery<CameraType[]>({
    queryKey: ["/api/cameras"],
  });

  const filteredCameras = useMemo(() => {
    if (!selectedSiteId) return [];
    return allCameras.filter(c => c.siteId === selectedSiteId);
  }, [allCameras, selectedSiteId]);

  const uploadMutation = useMutation({
    mutationFn: async (formData: FormData) => {
      const response = await fetch("/api/evidence/upload", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${localStorage.getItem("auth_token")}`,
        },
        body: formData,
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Upload failed");
      }
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Evidence uploaded successfully" });
      setUploadDialogOpen(false);
      setUploadFiles([]);
      setNotes("");
      setSelectedBayId("");
      setSelectedSiteId("");
      setSelectedCameraId("");
      queryClient.invalidateQueries({ queryKey: ["/api/evidence"] });
    },
    onError: (error: Error) => {
      toast({ title: "Upload failed", description: error.message, variant: "destructive" });
    },
  });

  const handleUpload = () => {
    if (uploadFiles.length === 0) {
      toast({ title: "Please select files to upload", variant: "destructive" });
      return;
    }

    const formData = new FormData();
    uploadFiles.forEach((file) => formData.append("files", file));
    if (notes) formData.append("notes", notes);
    if (selectedBayId) formData.append("bayId", selectedBayId);
    if (selectedSiteId) formData.append("siteId", selectedSiteId);
    if (selectedCameraId) formData.append("cameraId", selectedCameraId);

    uploadMutation.mutate(formData);
  };

  const handleSiteChange = (value: string) => {
    setSelectedSiteId(value);
    setSelectedCameraId("");
  };

  const filteredEvidence = evidenceList.filter((ev) => {
    if (sourceFilter === "all") return true;
    return ev.type === sourceFilter;
  });

  const cameraCount = evidenceList.filter((e) => e.type === "camera").length;
  const manualCount = evidenceList.filter((e) => e.type === "manual").length;

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Evidence</h1>
          <p className="text-muted-foreground">View and manage all evidence from cameras and manual uploads</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => refetch()} data-testid="button-refresh-evidence">
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Dialog open={uploadDialogOpen} onOpenChange={setUploadDialogOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-upload-evidence">
                <Upload className="h-4 w-4 mr-2" />
                Upload Evidence
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Upload Evidence</DialogTitle>
              </DialogHeader>
              <div className="flex flex-col gap-4 py-4">
                <div className="flex flex-col gap-2">
                  <Label>Files (JPG, PNG, MP4, AVI)</Label>
                  <Input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept="image/jpeg,image/png,video/mp4,video/x-msvideo,video/avi,.jpg,.jpeg,.png,.mp4,.avi"
                    onChange={(e) => setUploadFiles(Array.from(e.target.files || []))}
                    data-testid="input-upload-files"
                  />
                  {uploadFiles.length > 0 && (
                    <p className="text-xs text-muted-foreground">{uploadFiles.length} file(s) selected</p>
                  )}
                </div>
                <div className="flex flex-col gap-2">
                  <Label>Parking Site</Label>
                  <Select value={selectedSiteId} onValueChange={handleSiteChange}>
                    <SelectTrigger data-testid="select-site">
                      <SelectValue placeholder="Select a parking site" />
                    </SelectTrigger>
                    <SelectContent>
                      {parkingSites.map((site) => (
                        <SelectItem key={site.id} value={site.id.toString()}>
                          {site.siteName} {site.city && `- ${site.city}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-2">
                  <Label>Camera (Optional)</Label>
                  <Select 
                    value={selectedCameraId} 
                    onValueChange={setSelectedCameraId}
                    disabled={!selectedSiteId}
                  >
                    <SelectTrigger data-testid="select-camera">
                      <SelectValue placeholder={selectedSiteId ? "Select a camera" : "Select a site first"} />
                    </SelectTrigger>
                    <SelectContent>
                      {filteredCameras.length === 0 ? (
                        <SelectItem value="_none" disabled>No cameras at this site</SelectItem>
                      ) : (
                        filteredCameras.map((camera) => (
                          <SelectItem key={camera.id} value={camera.id.toString()}>
                            {camera.name}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-2">
                  <Label>Parking Bay (Optional)</Label>
                  <Select value={selectedBayId} onValueChange={setSelectedBayId}>
                    <SelectTrigger data-testid="select-bay">
                      <SelectValue placeholder="Select a bay" />
                    </SelectTrigger>
                    <SelectContent>
                      {bays.map((bay) => (
                        <SelectItem key={bay.id} value={bay.id.toString()}>
                          {bay.name} ({bay.type})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-2">
                  <Label>Notes</Label>
                  <Textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Add any relevant notes..."
                    data-testid="input-notes"
                  />
                </div>
                <Button 
                  onClick={handleUpload} 
                  disabled={uploadMutation.isPending}
                  data-testid="button-submit-upload"
                >
                  {uploadMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Uploading...
                    </>
                  ) : (
                    "Upload"
                  )}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-4">
            <CardTitle className="flex items-center gap-2">
              <Filter className="h-5 w-5" />
              Filter Evidence
            </CardTitle>
            <div className="flex items-center gap-2">
              <Badge variant={sourceFilter === "all" ? "default" : "outline"} className="cursor-pointer" onClick={() => setSourceFilter("all")} data-testid="filter-all">
                All ({evidenceList.length})
              </Badge>
              <Badge variant={sourceFilter === "camera" ? "default" : "outline"} className="cursor-pointer" onClick={() => setSourceFilter("camera")} data-testid="filter-camera">
                <Camera className="h-3 w-3 mr-1" />
                Camera ({cameraCount})
              </Badge>
              <Badge variant={sourceFilter === "manual" ? "default" : "outline"} className="cursor-pointer" onClick={() => setSourceFilter("manual")} data-testid="filter-manual">
                <FileImage className="h-3 w-3 mr-1" />
                Manual ({manualCount})
              </Badge>
            </div>
          </div>
        </CardHeader>
      </Card>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : filteredEvidence.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <FileImage className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <p className="text-lg font-medium text-muted-foreground">No evidence found</p>
            <p className="text-sm text-muted-foreground">Upload evidence or configure cameras to capture images</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filteredEvidence.map((ev) => (
            <EvidenceCard
              key={ev.id}
              evidence={ev}
              onClick={() => setSelectedEvidence(ev)}
            />
          ))}
        </div>
      )}

      <Dialog open={!!selectedEvidence} onOpenChange={() => setSelectedEvidence(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Evidence Details</DialogTitle>
          </DialogHeader>
          {selectedEvidence && (
            <div className="flex flex-col gap-4">
              {(selectedEvidence.imagePath || selectedEvidence.thumbnailPath) && (
                <img
                  src={selectedEvidence.imagePath || selectedEvidence.thumbnailPath || ""}
                  alt={`Evidence ${selectedEvidence.id}`}
                  className="w-full rounded-lg max-h-[400px] object-contain bg-muted"
                />
              )}
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">ID:</span>
                  <span className="ml-2 font-mono">#{selectedEvidence.id.toString().padStart(6, "0")}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Type:</span>
                  <Badge variant="outline" className="ml-2">{selectedEvidence.type}</Badge>
                </div>
                <div>
                  <span className="text-muted-foreground">Status:</span>
                  <Badge variant="outline" className="ml-2">{selectedEvidence.status}</Badge>
                </div>
                <div>
                  <span className="text-muted-foreground">Timestamp:</span>
                  <span className="ml-2">{new Date(selectedEvidence.timestamp).toLocaleString()}</span>
                </div>
              </div>
              {selectedEvidence.notes && (
                <div>
                  <span className="text-muted-foreground text-sm">Notes:</span>
                  <p className="mt-1 text-sm">{selectedEvidence.notes}</p>
                </div>
              )}
              {selectedEvidence.aiResult && (
                <Card>
                  <CardHeader className="py-3">
                    <CardTitle className="text-sm">AI Analysis Result</CardTitle>
                  </CardHeader>
                  <CardContent className="py-3">
                    <div className="flex flex-col gap-2 text-sm">
                      <div className="flex items-center gap-2">
                        <Badge variant={(selectedEvidence.aiResult as any).violationDetected ? "destructive" : "default"}>
                          {(selectedEvidence.aiResult as any).violationDetected ? "Violation Detected" : "No Violation"}
                        </Badge>
                        {(selectedEvidence.aiResult as any).violationType && (
                          <Badge variant="outline">{(selectedEvidence.aiResult as any).violationType}</Badge>
                        )}
                        <Badge variant="secondary">{Math.round((selectedEvidence.aiResult as any).confidence * 100)}% Confidence</Badge>
                      </div>
                      <p className="text-muted-foreground">{(selectedEvidence.aiResult as any).explanation}</p>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
