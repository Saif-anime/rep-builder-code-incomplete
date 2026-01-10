import { useState } from "react";
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
  ChevronRight
} from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { ParkingSite, Evidence, EnforcementCase, CaseAnalysis } from "@shared/schema";

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

                <Separator />

                <div>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-semibold flex items-center gap-2">
                      <FileImage className="h-4 w-4" />
                      Evidence ({caseEvidence.length})
                    </h3>
                    <Dialog open={addEvidenceDialogOpen} onOpenChange={setAddEvidenceDialogOpen}>
                      <DialogTrigger asChild>
                        <Button variant="outline" size="sm" data-testid="button-add-evidence">
                          <Plus className="h-4 w-4 mr-1" />
                          Add
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="max-w-lg">
                        <DialogHeader>
                          <DialogTitle>Add Evidence to Case</DialogTitle>
                          <DialogDescription>Select evidence items to add to this case</DialogDescription>
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
                  
                  {caseEvidence.length === 0 ? (
                    <div className="border border-dashed rounded-md p-6 text-center text-muted-foreground">
                      <FileImage className="h-8 w-8 mx-auto mb-2 opacity-50" />
                      <p>No evidence linked yet</p>
                    </div>
                  ) : (
                    <div className="grid gap-2">
                      {caseEvidence.map((ce) => (
                        <div key={ce.id} className="flex items-center gap-3 p-3 bg-muted/50 rounded-md">
                          {ce.evidence?.imagePath ? (
                            <img
                              src={`/${ce.evidence.imagePath}`}
                              alt="Evidence"
                              className="w-12 h-12 object-cover rounded"
                            />
                          ) : (
                            <div className="w-12 h-12 bg-muted rounded flex items-center justify-center">
                              <FileImage className="h-5 w-5 text-muted-foreground" />
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">
                              {ce.evidence?.notes || `Evidence #${ce.evidenceId}`}
                            </p>
                            <p className="text-xs text-muted-foreground">{ce.source}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <Separator />

                <div>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-semibold flex items-center gap-2">
                      <Brain className="h-4 w-4" />
                      AI Analysis
                    </h3>
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
                    </div>
                  ) : (
                    <div className="border border-dashed rounded-md p-6 text-center text-muted-foreground">
                      <Brain className="h-8 w-8 mx-auto mb-2 opacity-50" />
                      <p>No analysis yet</p>
                      <p className="text-xs mt-1">Add evidence and run analysis</p>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
