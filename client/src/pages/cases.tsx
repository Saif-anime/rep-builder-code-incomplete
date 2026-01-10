import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { 
  FolderOpen, 
  Plus, 
  Loader2, 
  Search, 
  FileImage, 
  AlertTriangle, 
  CheckCircle2, 
  Eye,
  Brain,
  Shield,
  Car,
  RefreshCw,
  ChevronRight,
  ChevronDown,
  Upload,
  Clock,
  FileVideo
} from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { PipelineAnalysisReport } from "@/components/pipeline-analysis-report";
import type { ParkingSite, Evidence, EnforcementCase, CaseAnalysis, EvidenceBundle, CaseVehicle } from "@shared/schema";

type CaseWithDetails = EnforcementCase & {
  site?: ParkingSite;
  analysis?: CaseAnalysis;
};

type CaseEvidenceWithEvidence = {
  id: number;
  caseId: string;
  evidenceId: number;
  source: string;
  keyFinding: string | null;
  evidence: Evidence;
};

type BundleWithFiles = EvidenceBundle & {
  files: Evidence[];
};

export default function CasesPage() {
  const { toast } = useToast();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [selectedCase, setSelectedCase] = useState<CaseWithDetails | null>(null);
  const [selectedSiteId, setSelectedSiteId] = useState<string>("");
  const [vrm, setVrm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [siteFilter, setSiteFilter] = useState<string>("all");
  const [addEvidenceDialogOpen, setAddEvidenceDialogOpen] = useState(false);
  const [selectedEvidenceIds, setSelectedEvidenceIds] = useState<number[]>([]);
  const [evidenceExpanded, setEvidenceExpanded] = useState(true);
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [manualVrmLookup, setManualVrmLookup] = useState("");

  const { data: cases = [], isLoading: casesLoading, refetch: refetchCases } = useQuery<CaseWithDetails[]>({
    queryKey: ["/api/cases", statusFilter, siteFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (siteFilter !== "all") params.set("siteId", siteFilter);
      const res = await fetch(`/api/cases?${params}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("auth_token")}` },
      });
      if (!res.ok) throw new Error("Failed to fetch cases");
      return res.json();
    },
  });

  const { data: sites = [] } = useQuery<ParkingSite[]>({
    queryKey: ["/api/parking-sites"],
  });

  const { data: evidenceList = [] } = useQuery<Evidence[]>({
    queryKey: ["/api/evidence"],
  });

  const { data: caseEvidence = [], refetch: refetchCaseEvidence } = useQuery<CaseEvidenceWithEvidence[]>({
    queryKey: ["/api/cases", selectedCase?.id, "evidence"],
    queryFn: async () => {
      if (!selectedCase) return [];
      const res = await fetch(`/api/cases/${selectedCase.id}/evidence`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("auth_token")}` },
      });
      if (!res.ok) throw new Error("Failed to fetch case evidence");
      return res.json();
    },
    enabled: !!selectedCase,
  });

  const { data: caseAnalysis, refetch: refetchAnalysis } = useQuery<CaseAnalysis | null>({
    queryKey: ["/api/cases", selectedCase?.id, "analysis"],
    queryFn: async () => {
      if (!selectedCase) return null;
      const res = await fetch(`/api/cases/${selectedCase.id}/analysis`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("auth_token")}` },
      });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!selectedCase,
  });

  const { data: caseBundles = [], refetch: refetchBundles } = useQuery<BundleWithFiles[]>({
    queryKey: ["/api/cases", selectedCase?.id, "bundles"],
    queryFn: async () => {
      if (!selectedCase) return [];
      const res = await fetch(`/api/cases/${selectedCase.id}/bundles`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("auth_token")}` },
      });
      if (!res.ok) throw new Error("Failed to fetch bundles");
      return res.json();
    },
    enabled: !!selectedCase,
  });

  const { data: caseVehicles = [], refetch: refetchVehicles } = useQuery<CaseVehicle[]>({
    queryKey: ["/api/cases", selectedCase?.id, "vehicles"],
    queryFn: async () => {
      if (!selectedCase) return [];
      const res = await fetch(`/api/cases/${selectedCase.id}/vehicles`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("auth_token")}` },
      });
      if (!res.ok) throw new Error("Failed to fetch case vehicles");
      return res.json();
    },
    enabled: !!selectedCase,
  });

  const createCaseMutation = useMutation({
    mutationFn: async (data: { siteId: number; vrm?: string }) => {
      return apiRequest("POST", "/api/cases", data);
    },
    onSuccess: () => {
      toast({ title: "Case created successfully" });
      setCreateDialogOpen(false);
      setSelectedSiteId("");
      setVrm("");
      queryClient.invalidateQueries({ queryKey: ["/api/cases"] });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to create case", description: error.message, variant: "destructive" });
    },
  });

  const addEvidenceMutation = useMutation({
    mutationFn: async ({ caseId, evidenceIds }: { caseId: string; evidenceIds: number[] }) => {
      return apiRequest("POST", `/api/cases/${caseId}/evidence`, { evidenceIds });
    },
    onSuccess: () => {
      toast({ title: "Evidence added to case" });
      setAddEvidenceDialogOpen(false);
      setSelectedEvidenceIds([]);
      refetchCaseEvidence();
      refetchCases();
    },
    onError: (error: Error) => {
      toast({ title: "Failed to add evidence", description: error.message, variant: "destructive" });
    },
  });

  const analyzeMutation = useMutation({
    mutationFn: async (caseId: string) => {
      return apiRequest("POST", `/api/cases/${caseId}/analyze`);
    },
    onSuccess: () => {
      toast({ title: "Analysis complete" });
      refetchAnalysis();
      refetchCases();
    },
    onError: (error: Error) => {
      toast({ title: "Analysis failed", description: error.message, variant: "destructive" });
    },
  });

  const handleCreateCase = () => {
    if (!selectedSiteId) {
      toast({ title: "Please select a site", variant: "destructive" });
      return;
    }
    createCaseMutation.mutate({
      siteId: parseInt(selectedSiteId),
      vrm: vrm || undefined,
    });
  };

  const handleAddEvidence = () => {
    if (!selectedCase || selectedEvidenceIds.length === 0) return;
    addEvidenceMutation.mutate({
      caseId: selectedCase.id,
      evidenceIds: selectedEvidenceIds,
    });
  };

  const uploadMutation = useMutation({
    mutationFn: async ({ caseId, files }: { caseId: string; files: File[] }) => {
      const formData = new FormData();
      files.forEach((file) => formData.append("files", file));
      
      const response = await fetch(`/api/cases/${caseId}/upload`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${localStorage.getItem("auth_token")}`,
        },
        body: formData,
      });
      
      if (response.status === 401) {
        throw new Error("Session expired. Please log in again.");
      }
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Upload failed");
      }
      
      return response.json();
    },
    onSuccess: (result) => {
      toast({ title: `Successfully uploaded ${result.evidenceIds.length} file(s) as bundle` });
      setUploadFiles([]);
      if (fileInputRef.current) fileInputRef.current.value = "";
      queryClient.invalidateQueries({ queryKey: ["/api/cases", selectedCase?.id, "bundles"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cases", selectedCase?.id, "evidence"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cases"] });
    },
    onError: (error: Error) => {
      toast({ title: "Upload failed", description: error.message, variant: "destructive" });
    },
  });

  const analyzeBundleMutation = useMutation({
    mutationFn: async (bundleId: number) => {
      return apiRequest("POST", `/api/bundles/${bundleId}/analyze`);
    },
    onSuccess: () => {
      toast({ title: "Bundle analyzed successfully" });
      refetchBundles();
      refetchVehicles();
      refetchCases();
    },
    onError: (error: Error) => {
      toast({ title: "Bundle analysis failed", description: error.message, variant: "destructive" });
    },
  });

  const dvlaLookupMutation = useMutation({
    mutationFn: async ({ caseId, registrationNumber }: { caseId: string; registrationNumber: string }) => {
      return apiRequest("POST", `/api/cases/${caseId}/vehicles/lookup`, { registrationNumber });
    },
    onSuccess: (result: any) => {
      if (result.success) {
        toast({ title: "Vehicle verified", description: `${result.vehicle?.make} ${result.vehicle?.model}` });
        refetchVehicles();
        refetchCases();
      } else {
        toast({ title: "Lookup failed", description: result.error, variant: "destructive" });
      }
      setManualVrmLookup("");
    },
    onError: (error: Error) => {
      toast({ title: "DVLA lookup failed", description: error.message, variant: "destructive" });
    },
  });

  const reanalyzeEvidenceMutation = useMutation({
    mutationFn: async (caseId: string) => {
      return apiRequest("POST", `/api/cases/${caseId}/reanalyze-evidence`);
    },
    onSuccess: (result: any) => {
      toast({ 
        title: "Reanalysis started", 
        description: `Analyzing ${result.reanalyzed} evidence items with Vision GPT` 
      });
      refetchCases();
      setTimeout(() => {
        refetchCaseEvidence();
        refetchVehicles();
        refetchAnalysis();
      }, 5000);
    },
    onError: (error: Error) => {
      toast({ title: "Reanalysis failed", description: error.message, variant: "destructive" });
    },
  });

  const handleFileUpload = () => {
    if (!selectedCase || uploadFiles.length === 0) return;
    uploadMutation.mutate({ caseId: selectedCase.id, files: uploadFiles });
  };

  const getBundleStatusBadge = (status: string) => {
    switch (status) {
      case "pending":
        return <Badge variant="secondary">Pending Analysis</Badge>;
      case "analyzing":
        return <Badge className="bg-blue-500/20 text-blue-700 dark:text-blue-300">Analyzing</Badge>;
      case "analyzed":
        return <Badge className="bg-green-500/20 text-green-700 dark:text-green-300">Analyzed</Badge>;
      case "failed":
        return <Badge className="bg-red-500/20 text-red-700 dark:text-red-300">Failed</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "pending":
        return <Badge variant="secondary" data-testid={`badge-status-${status}`}>Pending</Badge>;
      case "analysing":
        return <Badge className="bg-blue-500/20 text-blue-700 dark:text-blue-300" data-testid={`badge-status-${status}`}>Analysing</Badge>;
      case "complete":
        return <Badge className="bg-green-500/20 text-green-700 dark:text-green-300" data-testid={`badge-status-${status}`}>Complete</Badge>;
      case "dismissed":
        return <Badge variant="outline" data-testid={`badge-status-${status}`}>Dismissed</Badge>;
      default:
        return <Badge variant="secondary" data-testid={`badge-status-${status}`}>{status}</Badge>;
    }
  };

  const getRiskBadge = (risk: string | null) => {
    if (!risk) return null;
    switch (risk.toLowerCase()) {
      case "low":
        return <Badge className="bg-green-500/20 text-green-700 dark:text-green-300">Low Risk</Badge>;
      case "medium":
        return <Badge className="bg-yellow-500/20 text-yellow-700 dark:text-yellow-300">Medium Risk</Badge>;
      case "high":
        return <Badge className="bg-red-500/20 text-red-700 dark:text-red-300">High Risk</Badge>;
      default:
        return <Badge variant="outline">{risk}</Badge>;
    }
  };

  const alreadyLinkedIds = new Set(caseEvidence.map(ce => ce.evidenceId));
  const availableEvidence = evidenceList.filter(e => !alreadyLinkedIds.has(e.id));

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold">Enforcement Cases</h1>
          <p className="text-muted-foreground">Manage enforcement cases with AI-powered analysis</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => refetchCases()} data-testid="button-refresh-cases">
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-create-case">
                <Plus className="h-4 w-4 mr-2" />
                New Case
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create Enforcement Case</DialogTitle>
                <DialogDescription>Create a new case to group evidence for analysis</DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-4 py-4">
                <div className="flex flex-col gap-2">
                  <Label>Parking Site</Label>
                  <Select value={selectedSiteId} onValueChange={setSelectedSiteId}>
                    <SelectTrigger data-testid="select-case-site">
                      <SelectValue placeholder="Select a site" />
                    </SelectTrigger>
                    <SelectContent>
                      {sites.map((site) => (
                        <SelectItem key={site.id} value={site.id.toString()}>
                          {site.siteName} {site.city && `- ${site.city}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-2">
                  <Label>Vehicle Registration (Optional)</Label>
                  <Input
                    value={vrm}
                    onChange={(e) => setVrm(e.target.value.toUpperCase())}
                    placeholder="e.g. AB12 CDE"
                    data-testid="input-case-vrm"
                  />
                </div>
                <Button 
                  onClick={handleCreateCase} 
                  disabled={createCaseMutation.isPending}
                  data-testid="button-submit-case"
                >
                  {createCaseMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    "Create Case"
                  )}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Search className="h-5 w-5" />
            Filters
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4">
            <div className="flex flex-col gap-2 min-w-[150px]">
              <Label>Status</Label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger data-testid="select-filter-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="analysing">Analysing</SelectItem>
                  <SelectItem value="complete">Complete</SelectItem>
                  <SelectItem value="dismissed">Dismissed</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2 min-w-[150px]">
              <Label>Site</Label>
              <Select value={siteFilter} onValueChange={setSiteFilter}>
                <SelectTrigger data-testid="select-filter-site">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Sites</SelectItem>
                  {sites.map((site) => (
                    <SelectItem key={site.id} value={site.id.toString()}>
                      {site.siteName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {casesLoading ? (
        <div className="flex items-center justify-center p-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : cases.length === 0 ? (
        <Card className="p-12">
          <div className="flex flex-col items-center justify-center text-center gap-4">
            <FolderOpen className="h-12 w-12 text-muted-foreground" />
            <div>
              <h3 className="font-semibold text-lg">No Cases Found</h3>
              <p className="text-muted-foreground">Create a new case to get started</p>
            </div>
          </div>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {cases.map((caseItem) => (
            <Card 
              key={caseItem.id} 
              className="hover-elevate cursor-pointer"
              onClick={() => setSelectedCase(caseItem)}
              data-testid={`card-case-${caseItem.id}`}
            >
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-base font-medium truncate">
                    Case #{caseItem.id.slice(0, 8)}
                  </CardTitle>
                  {getStatusBadge(caseItem.status)}
                </div>
                <CardDescription>
                  {caseItem.vrm && (
                    <span className="font-mono font-semibold">{caseItem.vrm}</span>
                  )}
                  {!caseItem.vrm && <span className="italic">No VRM</span>}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <FileImage className="h-4 w-4" />
                    {caseItem.evidenceCount} evidence
                  </div>
                  <div className="flex items-center gap-1 text-primary">
                    <Eye className="h-4 w-4" />
                    View
                    <ChevronRight className="h-4 w-4" />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Sheet open={!!selectedCase} onOpenChange={(open) => !open && setSelectedCase(null)}>
        <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
          {selectedCase && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2">
                  <FolderOpen className="h-5 w-5" />
                  Case #{selectedCase.id.slice(0, 8)}
                </SheetTitle>
                <SheetDescription>
                  {selectedCase.vrm ? (
                    <span className="font-mono font-bold text-foreground">{selectedCase.vrm}</span>
                  ) : (
                    "No vehicle registration"
                  )}
                </SheetDescription>
              </SheetHeader>
              
              <div className="flex flex-col gap-6 py-6">
                <div className="flex flex-wrap items-center gap-2">
                  {getStatusBadge(selectedCase.status)}
                  {caseAnalysis?.riskAssessment && getRiskBadge(caseAnalysis.riskAssessment)}
                </div>

                {caseVehicles.length > 0 && (
                  <>
                    <Separator />
                    <div>
                      <h3 className="font-semibold flex items-center gap-2 mb-3">
                        <Car className="h-4 w-4" />
                        DVLA Verified Vehicle
                      </h3>
                      {caseVehicles.map((vehicle) => (
                        <Card key={vehicle.id} className="border-green-500/30 bg-green-500/5" data-testid={`vehicle-card-${vehicle.id}`}>
                          <CardContent className="pt-4">
                            <div className="flex items-start justify-between gap-4">
                              <div className="flex-1">
                                <div className="flex items-center gap-2 mb-2">
                                  <span className="font-mono font-bold text-lg">{vehicle.registrationNumber}</span>
                                  <Badge className="bg-green-500/20 text-green-700 dark:text-green-300">
                                    <CheckCircle2 className="h-3 w-3 mr-1" />
                                    Verified
                                  </Badge>
                                </div>
                                <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
                                  <div>
                                    <span className="text-muted-foreground">Make:</span>{" "}
                                    <span className="font-medium">{vehicle.make || "—"}</span>
                                  </div>
                                  <div>
                                    <span className="text-muted-foreground">Model:</span>{" "}
                                    <span className="font-medium">{vehicle.model || "—"}</span>
                                  </div>
                                  <div>
                                    <span className="text-muted-foreground">Colour:</span>{" "}
                                    <span className="font-medium">{vehicle.colour || "—"}</span>
                                  </div>
                                  <div>
                                    <span className="text-muted-foreground">Fuel:</span>{" "}
                                    <span className="font-medium">{vehicle.fuelType || "—"}</span>
                                  </div>
                                  {vehicle.yearOfManufacture && (
                                    <div>
                                      <span className="text-muted-foreground">Year:</span>{" "}
                                      <span className="font-medium">{vehicle.yearOfManufacture}</span>
                                    </div>
                                  )}
                                  {vehicle.engineCapacity && (
                                    <div>
                                      <span className="text-muted-foreground">Engine:</span>{" "}
                                      <span className="font-medium">{vehicle.engineCapacity}cc</span>
                                    </div>
                                  )}
                                </div>
                                <div className="flex flex-wrap gap-2 mt-3">
                                  {vehicle.taxStatus && (
                                    <Badge variant={vehicle.taxStatus === "Taxed" ? "secondary" : "destructive"}>
                                      Tax: {vehicle.taxStatus}
                                    </Badge>
                                  )}
                                  {vehicle.motStatus && (
                                    <Badge variant={vehicle.motStatus === "Valid" ? "secondary" : "destructive"}>
                                      MOT: {vehicle.motStatus}
                                    </Badge>
                                  )}
                                  {vehicle.co2Emissions && (
                                    <Badge variant="outline">{vehicle.co2Emissions}g CO2</Badge>
                                  )}
                                </div>
                                {vehicle.confidenceScore !== null && (
                                  <div className="text-xs text-muted-foreground mt-2">
                                    Detection confidence: {Math.round((vehicle.confidenceScore || 0) * 100)}%
                                  </div>
                                )}
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </>
                )}

                {caseVehicles.length === 0 && (
                  <>
                    <Separator />
                    <div>
                      <h3 className="font-semibold flex items-center gap-2 mb-3">
                        <Car className="h-4 w-4" />
                        Vehicle Lookup
                      </h3>
                      <div className="flex gap-2">
                        <Input
                          value={manualVrmLookup}
                          onChange={(e) => setManualVrmLookup(e.target.value.toUpperCase())}
                          placeholder="Enter registration (e.g. AB12 CDE)"
                          className="font-mono"
                          data-testid="input-manual-vrm-lookup"
                        />
                        <Button
                          onClick={() => {
                            if (selectedCase && manualVrmLookup) {
                              dvlaLookupMutation.mutate({ caseId: selectedCase.id, registrationNumber: manualVrmLookup });
                            }
                          }}
                          disabled={!manualVrmLookup || dvlaLookupMutation.isPending}
                          data-testid="button-dvla-lookup"
                        >
                          {dvlaLookupMutation.isPending ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Search className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground mt-2">
                        Enter a UK registration to verify vehicle details via DVLA
                      </p>
                    </div>
                  </>
                )}

                <Separator />

                <div>
                  <div className="flex flex-col gap-4">
                    <div className="border-2 border-dashed rounded-md p-4 bg-muted/20">
                      <div className="flex flex-col gap-3">
                        <div className="flex items-center gap-2">
                          <Upload className="h-5 w-5 text-muted-foreground" />
                          <span className="font-medium">Upload Evidence Files</span>
                        </div>
                        <input
                          ref={fileInputRef}
                          type="file"
                          multiple
                          accept="image/*,video/*"
                          onChange={(e) => setUploadFiles(Array.from(e.target.files || []))}
                          className="text-sm file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-primary file:text-primary-foreground hover:file:bg-primary/90"
                          data-testid="input-upload-files"
                        />
                        {uploadFiles.length > 0 && (
                          <div className="flex flex-wrap gap-2">
                            {uploadFiles.map((file, idx) => (
                              <Badge key={idx} variant="secondary" className="text-xs">
                                {file.type.startsWith("video") ? <FileVideo className="h-3 w-3 mr-1" /> : <FileImage className="h-3 w-3 mr-1" />}
                                {file.name.slice(0, 20)}{file.name.length > 20 && "..."}
                              </Badge>
                            ))}
                          </div>
                        )}
                        <Button
                          onClick={handleFileUpload}
                          disabled={uploadFiles.length === 0 || uploadMutation.isPending}
                          className="w-full"
                          data-testid="button-upload-to-case"
                        >
                          {uploadMutation.isPending ? (
                            <>
                              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                              Uploading {uploadFiles.length} file(s)...
                            </>
                          ) : (
                            <>
                              <Upload className="h-4 w-4 mr-2" />
                              Upload {uploadFiles.length > 0 ? `${uploadFiles.length} file(s)` : "Files"} to Case
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4">
                    <h3 className="font-semibold flex items-center gap-2 mb-3">
                      <FolderOpen className="h-4 w-4" />
                      Evidence Bundles ({caseBundles.length})
                    </h3>
                    
                    {caseBundles.length === 0 ? (
                      <div className="border border-dashed rounded-md p-6 text-center text-muted-foreground">
                        <FolderOpen className="h-8 w-8 mx-auto mb-2 opacity-50" />
                        <p>No evidence bundles yet</p>
                        <p className="text-xs mt-1">Upload files above to create a bundle</p>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-4">
                        {caseBundles.map((bundle) => (
                          <Card key={bundle.id} className="border" data-testid={`bundle-card-${bundle.id}`}>
                            <CardHeader className="pb-2">
                              <div className="flex items-center justify-between flex-wrap gap-2">
                                <CardTitle className="text-sm font-medium flex items-center gap-2">
                                  <FolderOpen className="h-4 w-4" />
                                  {bundle.name || `Bundle #${bundle.id}`}
                                </CardTitle>
                                {getBundleStatusBadge(bundle.status)}
                              </div>
                              <CardDescription className="text-xs">
                                {bundle.fileCount} file(s) - Created {new Date(bundle.createdAt).toLocaleDateString()}
                              </CardDescription>
                            </CardHeader>
                            <CardContent className="pt-0">
                              <div className="flex flex-wrap gap-2 mb-3">
                                {bundle.files.slice(0, 4).map((file) => (
                                  <div key={file.id} className="relative">
                                    {file.imagePath ? (
                                      <img
                                        src={file.imagePath}
                                        alt="Evidence"
                                        className="w-16 h-16 object-cover rounded border"
                                      />
                                    ) : (
                                      <div className="w-16 h-16 bg-muted rounded border flex items-center justify-center">
                                        <FileVideo className="h-6 w-6 text-muted-foreground" />
                                      </div>
                                    )}
                                  </div>
                                ))}
                                {bundle.files.length > 4 && (
                                  <div className="w-16 h-16 bg-muted/50 rounded border flex items-center justify-center">
                                    <span className="text-xs text-muted-foreground">+{bundle.files.length - 4}</span>
                                  </div>
                                )}
                              </div>

                              {bundle.status === "analyzed" && bundle.aiResult && (
                                <div className="bg-muted/30 rounded-md p-3 mb-3">
                                  <p className="text-sm font-medium mb-2">AI Analysis Result</p>
                                  <p className="text-xs text-muted-foreground mb-2">{bundle.aiResult.summary}</p>
                                  <div className="flex flex-wrap gap-2">
                                    {bundle.aiResult.recommendation && (
                                      <Badge 
                                        className={
                                          bundle.aiResult.recommendation === "Issue PCN" 
                                            ? "bg-red-500/20 text-red-700 dark:text-red-300"
                                            : bundle.aiResult.recommendation === "No Action"
                                            ? "bg-green-500/20 text-green-700 dark:text-green-300"
                                            : "bg-yellow-500/20 text-yellow-700 dark:text-yellow-300"
                                        }
                                      >
                                        {bundle.aiResult.recommendation}
                                      </Badge>
                                    )}
                                    {bundle.aiResult.riskAssessment && (
                                      <Badge variant="outline">{bundle.aiResult.riskAssessment} Risk</Badge>
                                    )}
                                    {bundle.aiResult.bayType && (
                                      <Badge variant="secondary">{bundle.aiResult.bayType}</Badge>
                                    )}
                                  </div>
                                  {bundle.aiResult.timeWindow && bundle.aiResult.timeWindow.durationMinutes > 0 && (
                                    <div className="mt-2 text-xs text-muted-foreground flex items-center gap-1">
                                      <Clock className="h-3 w-3" />
                                      Duration: {bundle.aiResult.timeWindow.durationMinutes} minutes
                                    </div>
                                  )}
                                  {bundle.aiResult.violations && bundle.aiResult.violations.length > 0 && (
                                    <div className="mt-2">
                                      {bundle.aiResult.violations.map((v: any, idx: number) => (
                                        <div key={idx} className="text-xs text-red-600 dark:text-red-400 flex items-center gap-1">
                                          <AlertTriangle className="h-3 w-3" />
                                          {v.type}: {v.explanation}
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              )}

                              <Button
                                size="sm"
                                className="w-full"
                                onClick={() => analyzeBundleMutation.mutate(bundle.id)}
                                disabled={bundle.status === "analyzing" || analyzeBundleMutation.isPending}
                                data-testid={`button-analyze-bundle-${bundle.id}`}
                              >
                                {bundle.status === "analyzing" || analyzeBundleMutation.isPending ? (
                                  <>
                                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                    Analyzing...
                                  </>
                                ) : bundle.status === "analyzed" ? (
                                  <>
                                    <RefreshCw className="h-4 w-4 mr-2" />
                                    Re-Analyze Bundle
                                  </>
                                ) : (
                                  <>
                                    <Brain className="h-4 w-4 mr-2" />
                                    Analyze Bundle
                                  </>
                                )}
                              </Button>
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    )}
                  </div>

                  <Collapsible open={evidenceExpanded} onOpenChange={setEvidenceExpanded} className="mt-4">
                    <div className="flex items-center justify-between">
                      <CollapsibleTrigger asChild>
                        <Button variant="ghost" size="sm" className="p-0 h-auto hover:bg-transparent" data-testid="button-toggle-evidence">
                          <h3 className="font-semibold flex items-center gap-2 text-muted-foreground">
                            {evidenceExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                            <FileImage className="h-4 w-4" />
                            Linked Evidence ({caseEvidence.length})
                          </h3>
                        </Button>
                      </CollapsibleTrigger>
                      <Dialog open={addEvidenceDialogOpen} onOpenChange={setAddEvidenceDialogOpen}>
                        <DialogTrigger asChild>
                          <Button variant="outline" size="sm" data-testid="button-add-evidence">
                            <Plus className="h-4 w-4 mr-1" />
                            Link Existing
                          </Button>
                        </DialogTrigger>
                        <DialogContent className="max-w-lg">
                          <DialogHeader>
                            <DialogTitle>Link Existing Evidence</DialogTitle>
                            <DialogDescription>Select evidence items already in the system to add to this case</DialogDescription>
                          </DialogHeader>
                          <ScrollArea className="h-[300px]">
                            <div className="flex flex-col gap-2">
                              {availableEvidence.length === 0 ? (
                                <p className="text-muted-foreground text-center py-4">No available evidence</p>
                              ) : (
                                availableEvidence.map((ev) => (
                                  <div
                                    key={ev.id}
                                    className={`p-3 border rounded-md cursor-pointer transition-colors ${
                                      selectedEvidenceIds.includes(ev.id)
                                        ? "border-primary bg-primary/10"
                                        : "hover:bg-muted/50"
                                    }`}
                                    onClick={() => {
                                      setSelectedEvidenceIds((prev) =>
                                        prev.includes(ev.id)
                                          ? prev.filter((id) => id !== ev.id)
                                          : [...prev, ev.id]
                                      );
                                    }}
                                    data-testid={`evidence-select-${ev.id}`}
                                  >
                                    <div className="flex items-center gap-2">
                                      <FileImage className="h-4 w-4 text-muted-foreground" />
                                      <span className="text-sm truncate">{ev.imagePath || ev.notes || `Evidence #${ev.id}`}</span>
                                    </div>
                                  </div>
                                ))
                              )}
                            </div>
                          </ScrollArea>
                          <div className="flex justify-end gap-2 pt-4">
                            <Button variant="outline" onClick={() => setAddEvidenceDialogOpen(false)}>
                              Cancel
                            </Button>
                            <Button
                              onClick={handleAddEvidence}
                              disabled={selectedEvidenceIds.length === 0 || addEvidenceMutation.isPending}
                              data-testid="button-confirm-add-evidence"
                            >
                              {addEvidenceMutation.isPending ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                `Add ${selectedEvidenceIds.length} Items`
                              )}
                            </Button>
                          </div>
                        </DialogContent>
                      </Dialog>
                    </div>
                    
                    <CollapsibleContent className="mt-3">
                      {caseEvidence.length === 0 ? (
                        <div className="border border-dashed rounded-md p-4 text-center text-muted-foreground text-sm">
                          No linked evidence
                        </div>
                      ) : (
                        <div className="grid gap-2">
                          {caseEvidence.map((ce) => (
                            <div key={ce.id} className="flex items-center gap-3 p-3 bg-muted/50 rounded-md">
                              {ce.evidence?.imagePath ? (
                                <img
                                  src={ce.evidence.imagePath}
                                  alt="Evidence"
                                  className="w-12 h-12 object-cover rounded"
                                />
                              ) : ce.evidence?.videoPath ? (
                                <div className="w-12 h-12 bg-muted rounded flex items-center justify-center">
                                  <FileVideo className="h-5 w-5 text-muted-foreground" />
                                </div>
                              ) : (
                                <div className="w-12 h-12 bg-muted rounded flex items-center justify-center">
                                  <FileImage className="h-5 w-5 text-muted-foreground" />
                                </div>
                              )}
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium truncate">
                                  {ce.evidence?.notes || `Evidence #${ce.evidenceId}`}
                                </p>
                                <p className="text-xs text-muted-foreground flex items-center gap-1">
                                  <Badge variant="outline" className="text-xs py-0">{ce.source}</Badge>
                                  {ce.evidence?.timestamp && (
                                    <span className="flex items-center gap-1">
                                      <Clock className="h-3 w-3" />
                                      {new Date(ce.evidence.timestamp).toLocaleTimeString()}
                                    </span>
                                  )}
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </CollapsibleContent>
                  </Collapsible>
                </div>

                <Separator />

                <div>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-semibold flex items-center gap-2">
                      <Brain className="h-4 w-4" />
                      AI Analysis
                    </h3>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        onClick={() => reanalyzeEvidenceMutation.mutate(selectedCase.id)}
                        disabled={reanalyzeEvidenceMutation.isPending || caseEvidence.length === 0}
                        data-testid="button-reanalyze-evidence"
                      >
                        {reanalyzeEvidenceMutation.isPending ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            Reanalyzing...
                          </>
                        ) : (
                          <>
                            <Eye className="h-4 w-4 mr-2" />
                            Vision Reanalyze
                          </>
                        )}
                      </Button>
                      <Button
                        onClick={() => analyzeMutation.mutate(selectedCase.id)}
                        disabled={analyzeMutation.isPending || caseEvidence.length === 0}
                        data-testid="button-analyze-case"
                      >
                        {analyzeMutation.isPending ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            Analyzing...
                          </>
                        ) : (
                          <>
                            <Brain className="h-4 w-4 mr-2" />
                            Run Analysis
                          </>
                        )}
                      </Button>
                    </div>
                  </div>

                  {caseAnalysis ? (
                    <div className="space-y-4">
                      {caseAnalysis.recommendation && (
                        <Card className={
                          caseAnalysis.recommendation === "Issue PCN" 
                            ? "border-red-500/50 bg-red-500/5" 
                            : caseAnalysis.recommendation === "No Action"
                            ? "border-green-500/50 bg-green-500/5"
                            : "border-yellow-500/50 bg-yellow-500/5"
                        }>
                          <CardHeader className="pb-2">
                            <CardTitle className="text-sm flex items-center gap-2">
                              <Shield className="h-4 w-4" />
                              Recommendation
                            </CardTitle>
                          </CardHeader>
                          <CardContent>
                            <p className="font-semibold">{caseAnalysis.recommendation}</p>
                            {caseAnalysis.confidenceScore && (
                              <p className="text-sm text-muted-foreground mt-1">
                                Confidence: {Math.round(caseAnalysis.confidenceScore * 100)}%
                              </p>
                            )}
                          </CardContent>
                        </Card>
                      )}

                      {caseAnalysis.summary && (
                        <div>
                          <h4 className="text-sm font-medium mb-1">Summary</h4>
                          <p className="text-sm text-muted-foreground">{caseAnalysis.summary}</p>
                        </div>
                      )}

                      {(caseAnalysis as any).timeWindow && (
                        <div>
                          <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
                            <Clock className="h-4 w-4" />
                            Time Window
                          </h4>
                          <div className="text-sm text-muted-foreground space-y-1 bg-muted/50 p-3 rounded-md">
                            <p>First seen: {new Date((caseAnalysis as any).timeWindow.firstSeen).toLocaleString()}</p>
                            <p>Last seen: {new Date((caseAnalysis as any).timeWindow.lastSeen).toLocaleString()}</p>
                            <p>Duration: {(caseAnalysis as any).timeWindow.durationMinutes} minutes</p>
                            {(caseAnalysis as any).timeWindow.gaps?.length > 0 && (
                              <div className="mt-2">
                                <span className="text-yellow-600 dark:text-yellow-400 font-medium">Gaps detected:</span>
                                <ul className="list-disc list-inside text-xs">
                                  {(caseAnalysis as any).timeWindow.gaps.map((gap: string, i: number) => (
                                    <li key={i}>{gap}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {caseAnalysis.violations && Array.isArray(caseAnalysis.violations) && caseAnalysis.violations.length > 0 && (
                        <div>
                          <h4 className="text-sm font-medium mb-2">Detected Violations</h4>
                          <div className="space-y-2">
                            {caseAnalysis.violations.map((v: any, i: number) => (
                              <div key={i} className="flex items-start gap-2 p-2 bg-red-500/10 rounded">
                                <AlertTriangle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
                                <div>
                                  <p className="text-sm font-medium">{v.type}</p>
                                  <p className="text-xs text-muted-foreground">{v.explanation}</p>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {caseAnalysis.vehicleDetails && (
                        <div>
                          <h4 className="text-sm font-medium mb-1 flex items-center gap-2">
                            <Car className="h-4 w-4" />
                            Vehicle Details
                          </h4>
                          <div className="text-sm text-muted-foreground space-y-1">
                            <p>Type: {caseAnalysis.vehicleDetails.type || "Unknown"}</p>
                            {caseAnalysis.vehicleDetails.plate && (
                              <p>Plate: <span className="font-mono">{caseAnalysis.vehicleDetails.plate}</span></p>
                            )}
                            {caseAnalysis.vehicleDetails.evIndicators && (
                              <Badge variant="outline" className="mt-1">EV Indicators</Badge>
                            )}
                          </div>
                        </div>
                      )}

                      {((caseAnalysis as any).supportingEvidenceIds || (caseAnalysis as any).partialFailures?.length > 0) && (
                        <div className="text-xs text-muted-foreground border-t pt-2 mt-4">
                          {(caseAnalysis as any).supportingEvidenceIds && (
                            <span>{(caseAnalysis as any).supportingEvidenceIds.length} files analyzed</span>
                          )}
                          {(caseAnalysis as any).partialFailures?.length > 0 && (
                            <span className="text-yellow-600"> | {(caseAnalysis as any).partialFailures.length} partial failures</span>
                          )}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="border border-dashed rounded-md p-6 text-center text-muted-foreground">
                      <Brain className="h-8 w-8 mx-auto mb-2 opacity-50" />
                      <p>No analysis yet</p>
                      <p className="text-xs mt-1">Add evidence and run analysis</p>
                    </div>
                  )}
                </div>

                <Separator />

                <div>
                  <h3 className="font-semibold flex items-center gap-2 mb-4">
                    <Shield className="h-4 w-4" />
                    6-Step Pipeline Analysis
                  </h3>
                  <PipelineAnalysisReport 
                    caseId={selectedCase.id} 
                    onPcnIssued={() => {
                      refetchCases();
                    }}
                  />
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
