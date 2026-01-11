import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { 
  Upload, 
  FileImage, 
  Camera, 
  Filter, 
  Loader2, 
  RefreshCw, 
  MapPin, 
  Brain, 
  Car, 
  ChevronRight, 
  ChevronDown,
  Clock,
  FileVideo,
  CheckCircle2,
  AlertTriangle,
  Eye
} from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { EvidenceAnalysisReport } from "@/components/evidence-analysis-report";
import { EvidenceViewer, EvidenceGallery } from "@/components/evidence-viewer";
import type { Evidence, ParkingSite, Camera as CameraType, CaseAnalysis, CaseVehicle, BayType } from "@shared/schema";
import { BAY_TYPES } from "@shared/schema";

type SourceFilter = "all" | "camera" | "manual";
type StatusFilter = "all" | "pending" | "analysing" | "completed";

interface EvidenceBundle {
  id: string;
  caseReference: string;
  siteName: string;
  siteId: number | null;
  bayType: BayType | null;
  uploadSource: "camera" | "manual";
  evidenceCount: number;
  status: "pending" | "analysing" | "completed";
  timeWindow: { start: string; end: string } | null;
  createdAt: string;
  vrm: string | null;
  evidenceFiles: Evidence[];
  analysis: CaseAnalysis | null;
  vehicles: CaseVehicle[];
}

export default function EvidencePage() {
  const { toast } = useToast();
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [selectedBundle, setSelectedBundle] = useState<EvidenceBundle | null>(null);
  const [expandedBundles, setExpandedBundles] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState<string>("");
  const [selectedCameraId, setSelectedCameraId] = useState<string>("");
  const [selectedBayType, setSelectedBayType] = useState<string>("");
  const [manualVrmLookup, setManualVrmLookup] = useState("");
  
  // DVLA Lookup State - refactored for data-driven UI
  const [vehicleData, setVehicleData] = useState<{
    vrm: string;
    make: string;
    model?: string;
    colour: string;
    fuelType: string;
    taxStatus?: string;
    motStatus?: string;
    yearOfManufacture?: number;
    co2Emissions?: number;
  } | null>(null);
  const [lookupStatus, setLookupStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [lookupError, setLookupError] = useState<string | null>(null);

  const { data: bundles = [], isLoading, refetch } = useQuery<EvidenceBundle[]>({
    queryKey: ["/api/evidence/bundles"],
    refetchInterval: (query) => {
      const data = query.state.data as EvidenceBundle[] | undefined;
      const hasPending = data?.some(b => b.status === "pending" || b.status === "analysing");
      return hasPending ? 5000 : false;
    },
  });

  const { data: parkingSites = [] } = useQuery<ParkingSite[]>({
    queryKey: ["/api/parking-sites"],
  });

  const { data: allCameras = [] } = useQuery<CameraType[]>({
    queryKey: ["/api/cameras"],
  });

  const uploadMutation = useMutation({
    mutationFn: async (formData: FormData) => {
      const response = await fetch("/api/evidence/bundles/upload", {
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
    onSuccess: (result) => {
      toast({ title: "Evidence uploaded", description: `Created bundle with ${result.evidenceIds?.length || 0} file(s)` });
      setUploadDialogOpen(false);
      setUploadFiles([]);
      setSelectedSiteId("");
      setSelectedCameraId("");
      setSelectedBayType("");
      queryClient.invalidateQueries({ queryKey: ["/api/evidence/bundles"] });
    },
    onError: (error: Error) => {
      toast({ title: "Upload failed", description: error.message, variant: "destructive" });
    },
  });

  const analyzeMutation = useMutation({
    mutationFn: async (bundleId: string) => {
      return apiRequest("POST", `/api/evidence/bundles/${bundleId}/analyze`);
    },
    onSuccess: () => {
      toast({ title: "Analysis complete", description: "Bundle has been analyzed" });
      queryClient.invalidateQueries({ queryKey: ["/api/evidence/bundles"] });
    },
    onError: (error: Error) => {
      toast({ title: "Analysis failed", description: error.message, variant: "destructive" });
    },
  });

  // Use ref to track vehicle data for stale closure access in mutation callbacks
  const vehicleDataRef = useRef(vehicleData);
  vehicleDataRef.current = vehicleData;
  
  const dvlaLookupMutation = useMutation({
    mutationFn: async ({ bundleId, registrationNumber }: { bundleId: string; registrationNumber: string }) => {
      setLookupStatus("loading");
      setLookupError(null);
      const response = await apiRequest("POST", `/api/evidence/bundles/${bundleId}/vehicles/lookup`, { registrationNumber });
      return response.json();
    },
    onSuccess: (result: any) => {
      console.log("DVLA Lookup Response:", result);
      
      if (result.success && result.vehicle) {
        // SUCCESS: Update vehicle data and status
        console.log("Vehicle Data:", {
          make: result.vehicle.make,
          colour: result.vehicle.colour,
          fuelType: result.vehicle.fuelType
        });
        
        setVehicleData({
          vrm: result.vehicle.vrm,
          make: result.vehicle.make,
          model: result.vehicle.model,
          colour: result.vehicle.colour,
          fuelType: result.vehicle.fuelType,
          taxStatus: result.vehicle.taxStatus,
          motStatus: result.vehicle.motStatus,
          yearOfManufacture: result.vehicle.yearOfManufacture,
          co2Emissions: result.vehicle.co2Emissions
        });
        setLookupStatus("success");
        setLookupError(null);
        
        toast({ title: "Vehicle verified", description: `${result.vehicle.make} - ${result.vehicle.colour}` });
        queryClient.invalidateQueries({ queryKey: ["/api/evidence/bundles"] });
      } else {
        // FAILURE: Check ref for existing data (avoids stale closure)
        console.error("DVLA Lookup Failed:", result.error);
        
        if (vehicleDataRef.current === null) {
          // No previous data - show error
          setLookupStatus("error");
          setLookupError(result.error || "Unable to verify vehicle");
          toast({ title: "Lookup failed", description: result.error || "Unable to verify vehicle", variant: "destructive" });
        } else {
          // Previous data exists - keep it, don't show error
          setLookupStatus("success");
          console.log("Keeping existing vehicle data despite lookup failure");
        }
      }
      setManualVrmLookup("");
    },
    onError: (error: Error) => {
      console.error("DVLA Lookup Error:", error);
      
      // Check ref for existing data (avoids stale closure)
      if (vehicleDataRef.current === null) {
        setLookupStatus("error");
        setLookupError(error.message);
        toast({ title: "DVLA lookup failed", description: error.message, variant: "destructive" });
      } else {
        // Previous data exists - keep it
        setLookupStatus("success");
        console.log("Keeping existing vehicle data despite network error");
      }
    },
  });

  const handleUpload = () => {
    if (uploadFiles.length === 0) {
      toast({ title: "Please select files to upload", variant: "destructive" });
      return;
    }
    
    if (!selectedBayType || selectedBayType === "none") {
      toast({ title: "Bay type is required", description: "Please select the type of parking bay", variant: "destructive" });
      return;
    }

    const formData = new FormData();
    uploadFiles.forEach((file) => formData.append("files", file));
    if (selectedSiteId && selectedSiteId !== "none") formData.append("siteId", selectedSiteId);
    if (selectedCameraId && selectedCameraId !== "none") formData.append("cameraId", selectedCameraId);
    formData.append("bayType", selectedBayType);

    uploadMutation.mutate(formData);
  };
  
  // Helper to format bay type for display
  const formatBayType = (bayType: string): string => {
    const labels: Record<string, string> = {
      "general_parking": "General Parking",
      "disabled_bay": "Disabled Bay",
      "ev_bay": "Electric Vehicle Bay",
      "loading_bay": "Loading Bay",
      "permit_holders": "Permit Holders Only",
      "no_parking": "No Parking / Restricted",
      "drop_off_pickup": "Drop-off / Pick-up",
      "staff_parking": "Staff Parking",
    };
    return labels[bayType] || bayType.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase());
  };

  const toggleBundle = (bundleId: string) => {
    setExpandedBundles(prev => {
      const next = new Set(prev);
      if (next.has(bundleId)) {
        next.delete(bundleId);
      } else {
        next.add(bundleId);
      }
      return next;
    });
  };

  const filteredBundles = bundles.filter((bundle) => {
    if (sourceFilter !== "all" && bundle.uploadSource !== sourceFilter) return false;
    if (statusFilter !== "all" && bundle.status !== statusFilter) return false;
    return true;
  });

  const pendingCount = bundles.filter((b) => b.status === "pending").length;
  const analysingCount = bundles.filter((b) => b.status === "analysing").length;
  const completedCount = bundles.filter((b) => b.status === "completed").length;
  const cameraCount = bundles.filter((b) => b.uploadSource === "camera").length;
  const manualCount = bundles.filter((b) => b.uploadSource === "manual").length;

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "pending":
        return <Badge variant="secondary"><Clock className="h-3 w-3 mr-1" />Pending</Badge>;
      case "analysing":
        return <Badge variant="default"><Loader2 className="h-3 w-3 mr-1 animate-spin" />Analysing</Badge>;
      case "completed":
        return <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-400"><CheckCircle2 className="h-3 w-3 mr-1" />Completed</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="flex flex-col gap-4 sm:gap-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold">Evidence</h1>
          <p className="text-xs sm:text-sm text-muted-foreground">View and analyze evidence bundles</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => refetch()} data-testid="button-refresh-evidence">
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Dialog open={uploadDialogOpen} onOpenChange={setUploadDialogOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-upload-evidence" className="flex-1 sm:flex-none">
                <Upload className="h-4 w-4 mr-2" />
                <span className="sm:inline">Upload</span>
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Upload Evidence</DialogTitle>
                <DialogDescription>
                  Select multiple files to create an evidence bundle for analysis
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-4 py-4">
                <div className="flex flex-col gap-2">
                  <Label>Files (JPG, PNG, MP4, AVI)</Label>
                  <Input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept=".jpg,.jpeg,.png,.mp4,.avi,.pdf"
                    onChange={(e) => setUploadFiles(Array.from(e.target.files || []))}
                    data-testid="input-upload-files"
                  />
                  {uploadFiles.length > 0 && (
                    <p className="text-xs text-muted-foreground">{uploadFiles.length} file(s) selected</p>
                  )}
                </div>
                <div className="flex flex-col gap-2">
                  <Label>Parking Site</Label>
                  <Select value={selectedSiteId} onValueChange={setSelectedSiteId}>
                    <SelectTrigger data-testid="select-site">
                      <SelectValue placeholder="Select site" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No site selected</SelectItem>
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
                  <Select value={selectedCameraId} onValueChange={setSelectedCameraId}>
                    <SelectTrigger data-testid="select-camera">
                      <SelectValue placeholder="None - Manual upload" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None - Manual upload</SelectItem>
                      {allCameras.map((camera) => (
                        <SelectItem key={camera.id} value={camera.id.toString()}>
                          {camera.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-2">
                  <Label className="flex items-center gap-1">
                    Bay Type <span className="text-destructive">*</span>
                  </Label>
                  <Select value={selectedBayType} onValueChange={setSelectedBayType}>
                    <SelectTrigger data-testid="select-bay-type" className={!selectedBayType ? "border-destructive/50" : ""}>
                      <SelectValue placeholder="Select bay type (required)" />
                    </SelectTrigger>
                    <SelectContent>
                      {BAY_TYPES.map((bayType) => (
                        <SelectItem key={bayType} value={bayType}>
                          {formatBayType(bayType)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Analysis will be performed against rules specific to this bay type
                  </p>
                </div>
                <Button 
                  onClick={handleUpload} 
                  disabled={uploadMutation.isPending || uploadFiles.length === 0 || !selectedBayType}
                  data-testid="button-submit-upload"
                >
                  {uploadMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Uploading...
                    </>
                  ) : (
                    <>
                      <Upload className="h-4 w-4 mr-2" />
                      Create Bundle
                    </>
                  )}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3 px-3 sm:px-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
              <Filter className="h-4 w-4 sm:h-5 sm:w-5" />
              Filter Bundles
            </CardTitle>
            <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
              <Badge variant={sourceFilter === "all" ? "default" : "outline"} className="cursor-pointer text-[10px] sm:text-xs" onClick={() => setSourceFilter("all")} data-testid="filter-all">
                All ({bundles.length})
              </Badge>
              <Badge variant={sourceFilter === "camera" ? "default" : "outline"} className="cursor-pointer text-[10px] sm:text-xs" onClick={() => setSourceFilter("camera")} data-testid="filter-camera">
                <Camera className="h-3 w-3 mr-1" />
                <span className="hidden sm:inline">Camera </span>({cameraCount})
              </Badge>
              <Badge variant={sourceFilter === "manual" ? "default" : "outline"} className="cursor-pointer text-[10px] sm:text-xs" onClick={() => setSourceFilter("manual")} data-testid="filter-manual">
                <FileImage className="h-3 w-3 mr-1" />
                <span className="hidden sm:inline">Manual </span>({manualCount})
              </Badge>
              <Separator orientation="vertical" className="h-4 sm:h-6 hidden sm:block" />
              <Badge variant={statusFilter === "pending" ? "default" : "outline"} className="cursor-pointer text-[10px] sm:text-xs" onClick={() => setStatusFilter(statusFilter === "pending" ? "all" : "pending")} data-testid="filter-pending">
                <Clock className="h-3 w-3 mr-1" />
                <span className="hidden sm:inline">Pending </span>({pendingCount})
              </Badge>
              <Badge variant={statusFilter === "completed" ? "default" : "outline"} className="cursor-pointer text-[10px] sm:text-xs" onClick={() => setStatusFilter(statusFilter === "completed" ? "all" : "completed")} data-testid="filter-completed">
                <CheckCircle2 className="h-3 w-3 mr-1" />
                <span className="hidden sm:inline">Done </span>({completedCount})
              </Badge>
            </div>
          </div>
        </CardHeader>
      </Card>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : filteredBundles.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <FileImage className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <p className="text-lg font-medium text-muted-foreground">No evidence bundles found</p>
            <p className="text-sm text-muted-foreground">Upload evidence to create a new bundle</p>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-3 sm:gap-4">
          {filteredBundles.map((bundle) => (
            <Card key={bundle.id} className="hover-elevate cursor-pointer overflow-hidden" data-testid={`bundle-card-${bundle.id}`}>
              <Collapsible open={expandedBundles.has(bundle.id)} onOpenChange={() => toggleBundle(bundle.id)}>
                <CollapsibleTrigger asChild>
                  <CardHeader className="pb-3 px-3 sm:px-6">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-4">
                      <div className="flex items-center gap-2 sm:gap-3">
                        {expandedBundles.has(bundle.id) ? (
                          <ChevronDown className="h-4 w-4 sm:h-5 sm:w-5 text-muted-foreground shrink-0" />
                        ) : (
                          <ChevronRight className="h-4 w-4 sm:h-5 sm:w-5 text-muted-foreground shrink-0" />
                        )}
                        <div className="min-w-0">
                          <CardTitle className="text-sm sm:text-base flex items-center gap-2">
                            <MapPin className="h-3 w-3 sm:h-4 sm:w-4 shrink-0" />
                            <span className="truncate">{bundle.siteName}</span>
                          </CardTitle>
                          <CardDescription className="flex items-center gap-2 mt-1 flex-wrap">
                            <span className="font-mono text-[10px] sm:text-xs">REF: {bundle.caseReference.substring(0, 8)}</span>
                            {bundle.vrm && (
                              <>
                                <Separator orientation="vertical" className="h-3 hidden sm:block" />
                                <span className="font-mono text-[10px] sm:text-xs flex items-center gap-1">
                                  <Car className="h-3 w-3" />
                                  {bundle.vrm}
                                </span>
                              </>
                            )}
                          </CardDescription>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 sm:gap-3 ml-6 sm:ml-0 flex-wrap">
                        <Badge variant="outline" className="text-[10px] sm:text-xs">
                          {bundle.uploadSource === "camera" ? <Camera className="h-3 w-3 mr-1" /> : <FileImage className="h-3 w-3 mr-1" />}
                          {bundle.evidenceCount}
                        </Badge>
                        {getStatusBadge(bundle.status)}
                        <span className="text-[10px] sm:text-xs text-muted-foreground hidden sm:inline">
                          {new Date(bundle.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                  </CardHeader>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <CardContent className="pt-0">
                    <Separator className="mb-4" />
                    
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                      <div>
                        <h4 className="font-medium mb-3 flex items-center gap-2">
                          <FileImage className="h-4 w-4" />
                          Evidence Files ({bundle.evidenceFiles.length})
                        </h4>
                        <EvidenceGallery 
                          evidence={bundle.evidenceFiles} 
                          maxVisible={6}
                        />
                        
                        <div className="flex gap-2 mt-4">
                          <Button 
                            variant="outline"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedBundle(bundle);
                              // Reset lookup state for new bundle
                              setVehicleData(null);
                              setLookupStatus("idle");
                              setLookupError(null);
                            }}
                            data-testid={`button-view-${bundle.id}`}
                          >
                            <Eye className="h-4 w-4 mr-2" />
                            View Details
                          </Button>
                        </div>
                      </div>

                      <div>
                        <h4 className="font-medium mb-3 flex items-center gap-2">
                          <Brain className="h-4 w-4" />
                          Analysis Report
                        </h4>
                        {bundle.analysis ? (
                          <div className="space-y-3">
                            <div className="flex items-center gap-2">
                              <Badge variant={bundle.analysis.recommendation === "Issue PCN" ? "destructive" : "secondary"}>
                                {bundle.analysis.recommendation}
                              </Badge>
                              <Badge variant="outline">
                                {Math.round((bundle.analysis.confidenceScore || 0) * 100)}% Confidence
                              </Badge>
                            </div>
                            
                            {bundle.analysis.violations && (bundle.analysis.violations as any[]).length > 0 && (
                              <div className="p-3 rounded-md bg-destructive/10 border border-destructive/20">
                                <p className="text-sm font-medium text-destructive flex items-center gap-2">
                                  <AlertTriangle className="h-4 w-4" />
                                  Violation Detected
                                </p>
                                <p className="text-sm text-muted-foreground mt-1">
                                  {((bundle.analysis.violations as any[])[0])?.explanation}
                                </p>
                              </div>
                            )}
                            
                            {bundle.vehicles.length > 0 && (
                              <div className="space-y-2">
                                <p className="text-sm font-medium">Vehicle Details</p>
                                {bundle.vehicles.map((vehicle) => (
                                  <div key={vehicle.id} className="p-2 rounded-md bg-muted text-sm">
                                    <div className="flex items-center gap-2">
                                      <Car className="h-4 w-4" />
                                      <span className="font-mono font-medium">{vehicle.registrationNumber}</span>
                                      {vehicle.verifiedAt && <CheckCircle2 className="h-3 w-3 text-green-500" />}
                                    </div>
                                    <p className="text-muted-foreground mt-1">
                                      {vehicle.make} {vehicle.colour} • Tax: {vehicle.taxStatus} • MOT: {vehicle.motStatus}
                                    </p>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="p-4 rounded-md bg-muted/50 text-center">
                            <Brain className="h-8 w-8 mx-auto text-muted-foreground/50 mb-2" />
                            <p className="text-sm text-muted-foreground">No analysis yet</p>
                            <p className="text-xs text-muted-foreground">Click "View Details" then "Analyse Evidence" to generate report</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </CollapsibleContent>
              </Collapsible>
            </Card>
          ))}
        </div>
      )}

      <Sheet open={!!selectedBundle} onOpenChange={() => setSelectedBundle(null)}>
        <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader className="pb-2">
            <SheetTitle className="text-base sm:text-lg">Bundle Details</SheetTitle>
            <SheetDescription className="text-xs sm:text-sm break-all">
              {selectedBundle?.siteName} - REF: {selectedBundle?.caseReference.substring(0, 8)}
            </SheetDescription>
          </SheetHeader>
          
          {selectedBundle && (
            <div className="mt-4 sm:mt-6 space-y-4 sm:space-y-6">
              <div className="flex flex-wrap items-center gap-2">
                {getStatusBadge(selectedBundle.status)}
                <Badge variant="outline" className="whitespace-nowrap">
                  {selectedBundle.uploadSource === "camera" ? <Camera className="h-3 w-3 mr-1 shrink-0" /> : <FileImage className="h-3 w-3 mr-1 shrink-0" />}
                  {selectedBundle.evidenceCount} file{selectedBundle.evidenceCount !== 1 ? "s" : ""}
                </Badge>
                {selectedBundle.vrm && (
                  <Badge variant="outline" className="font-mono whitespace-nowrap">
                    <Car className="h-3 w-3 mr-1 shrink-0" />
                    {selectedBundle.vrm}
                  </Badge>
                )}
              </div>

              <Separator />

              <div>
                <h4 className="font-medium mb-3 text-sm sm:text-base">All Evidence Files</h4>
                <ScrollArea className="h-[180px] sm:h-[200px]">
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pr-4">
                    {selectedBundle.evidenceFiles.map((file) => (
                      <EvidenceViewer
                        key={file.id}
                        evidence={file}
                        allEvidence={selectedBundle.evidenceFiles}
                      />
                    ))}
                  </div>
                </ScrollArea>
              </div>

              <Separator />

              <div>
                <h4 className="font-medium mb-3 text-sm sm:text-base">DVLA Vehicle Lookup</h4>
                <div className="flex flex-col sm:flex-row gap-2">
                  <Input 
                    placeholder="Enter registration (e.g. AB12 CDE)"
                    value={manualVrmLookup}
                    onChange={(e) => setManualVrmLookup(e.target.value.toUpperCase())}
                    className="font-mono flex-1"
                    data-testid="input-vrm-lookup"
                  />
                  <Button 
                    onClick={() => {
                      if (manualVrmLookup && selectedBundle) {
                        dvlaLookupMutation.mutate({ 
                          bundleId: selectedBundle.id, 
                          registrationNumber: manualVrmLookup 
                        });
                      }
                    }}
                    disabled={dvlaLookupMutation.isPending || !manualVrmLookup}
                    className="w-full sm:w-auto"
                    data-testid="button-dvla-lookup"
                  >
                    {dvlaLookupMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        <Car className="h-4 w-4 mr-2" />
                        Lookup
                      </>
                    )}
                  </Button>
                </div>
                
                {/* Loading State */}
                {lookupStatus === "loading" && (
                  <div className="mt-3 p-4 bg-muted rounded-md flex items-center gap-3" data-testid="dvla-lookup-loading">
                    <Loader2 className="h-5 w-5 animate-spin text-primary" />
                    <span className="text-sm">Looking up vehicle details...</span>
                  </div>
                )}
                
                {/* Vehicle Data Display - ALWAYS show when data exists */}
                {vehicleData && (
                  <Card className="mt-3 border-green-500/50 bg-green-50 dark:bg-green-950/20" data-testid="dvla-lookup-result">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-2 mb-3">
                        <CheckCircle2 className="h-5 w-5 text-green-500" />
                        <span className="font-semibold text-green-700 dark:text-green-400">DVLA Vehicle Verified</span>
                        <Badge variant="outline" className="ml-auto font-mono">{vehicleData.vrm}</Badge>
                      </div>
                      <div className="grid grid-cols-3 gap-4">
                        <div className="text-center p-2 bg-background rounded-md">
                          <span className="text-xs text-muted-foreground block">Make</span>
                          <p className="font-bold text-lg">{vehicleData.make || "N/A"}</p>
                        </div>
                        <div className="text-center p-2 bg-background rounded-md">
                          <span className="text-xs text-muted-foreground block">Colour</span>
                          <p className="font-bold text-lg">{vehicleData.colour || "N/A"}</p>
                        </div>
                        <div className="text-center p-2 bg-background rounded-md">
                          <span className="text-xs text-muted-foreground block">Fuel Type</span>
                          <p className="font-bold text-lg">{vehicleData.fuelType || "N/A"}</p>
                        </div>
                      </div>
                      {(vehicleData.taxStatus || vehicleData.motStatus) && (
                        <div className="grid grid-cols-2 gap-4 mt-3">
                          {vehicleData.taxStatus && (
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-muted-foreground">Tax:</span>
                              <Badge variant={vehicleData.taxStatus === "Taxed" ? "outline" : "destructive"} className="text-xs">
                                {vehicleData.taxStatus}
                              </Badge>
                            </div>
                          )}
                          {vehicleData.motStatus && (
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-muted-foreground">MOT:</span>
                              <Badge variant={vehicleData.motStatus === "Valid" ? "outline" : "destructive"} className="text-xs">
                                {vehicleData.motStatus}
                              </Badge>
                            </div>
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}
                
                {/* Error State - ONLY show when NO vehicle data exists */}
                {lookupStatus === "error" && vehicleData === null && lookupError && (
                  <Card className="mt-3 border-destructive/50 bg-destructive/10" data-testid="dvla-lookup-error">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="h-5 w-5 text-destructive" />
                        <span className="text-sm text-destructive">{lookupError}</span>
                      </div>
                    </CardContent>
                  </Card>
                )}
                
                {selectedBundle.vehicles.length > 0 && (
                  <div className="mt-4 space-y-2">
                    {selectedBundle.vehicles.map((vehicle) => (
                      <Card key={vehicle.id}>
                        <CardContent className="p-3">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Car className="h-4 w-4" />
                              <span className="font-mono font-medium">{vehicle.registrationNumber}</span>
                              {vehicle.verifiedAt && <CheckCircle2 className="h-4 w-4 text-green-500" />}
                            </div>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2 text-sm">
                            <div className="flex flex-wrap gap-1">
                              <span className="text-muted-foreground">Make:</span> {vehicle.make || "Unknown"}
                            </div>
                            <div className="flex flex-wrap gap-1">
                              <span className="text-muted-foreground">Colour:</span> {vehicle.colour || "Unknown"}
                            </div>
                            <div className="flex flex-wrap gap-1">
                              <span className="text-muted-foreground">Fuel:</span> {vehicle.fuelType || "Unknown"}
                            </div>
                            <div className="flex flex-wrap gap-1">
                              <span className="text-muted-foreground">Year:</span> {vehicle.yearOfManufacture || "Unknown"}
                            </div>
                            <div className="flex flex-wrap items-center gap-1">
                              <span className="text-muted-foreground">Tax:</span>{" "}
                              <Badge variant={vehicle.taxStatus === "Taxed" ? "outline" : "destructive"} className="text-xs">
                                {vehicle.taxStatus || "Unknown"}
                              </Badge>
                            </div>
                            <div className="flex flex-wrap items-center gap-1">
                              <span className="text-muted-foreground">MOT:</span>{" "}
                              <Badge variant={vehicle.motStatus === "Valid" ? "outline" : "destructive"} className="text-xs">
                                {vehicle.motStatus || "Unknown"}
                              </Badge>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </div>

              <Separator />

              <EvidenceAnalysisReport
                bundleId={selectedBundle.id}
                caseReference={selectedBundle.caseReference}
                analysis={selectedBundle.analysis}
                vehicles={selectedBundle.vehicles}
                evidenceFiles={selectedBundle.evidenceFiles}
                siteName={selectedBundle.siteName}
                siteId={selectedBundle.siteId}
                bayType={selectedBundle.bayType}
                vrm={selectedBundle.vrm}
                timeWindow={selectedBundle.timeWindow}
                onPcnIssued={() => {
                  queryClient.invalidateQueries({ queryKey: ["/api/evidence/bundles"] });
                }}
              />
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
