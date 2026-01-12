import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { 
  FileText, 
  AlertTriangle,
  CheckCircle2,
  Clock,
  Car,
  MapPin,
  RefreshCw,
  Loader2,
  ChevronRight,
  ChevronDown,
  Scale,
  Image,
  Shield,
  XCircle,
  Info,
  BarChart3
} from "lucide-react";
import type { ParkingSite } from "@shared/schema";

interface AnalysisReport {
  caseId: string;
  caseReference: string;
  siteName: string;
  siteId: number;
  vrm: string | null;
  evidenceCount: number;
  analysisTimestamp: string;
  pipelineResults: {
    pipelineStatus: string;
    evidenceTimeline?: any;
    visionResults?: any;
    dvlaResults?: any;
    regulationEvaluation?: any;
    signageCompliance?: any;
    decisionEngine?: any;
    riskAssessment?: any;
    [key: string]: any;
  };
}

export default function RecommendationsPage() {
  const [selectedSiteId, setSelectedSiteId] = useState<string>("all");
  const [actionFilter, setActionFilter] = useState<string>("all");
  const [selectedReport, setSelectedReport] = useState<AnalysisReport | null>(null);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(["summary", "decision"]));

  const { data: sites = [] } = useQuery<ParkingSite[]>({
    queryKey: ["/api/parking-sites"],
  });

  const { data: reports = [], isLoading, refetch } = useQuery<AnalysisReport[]>({
    queryKey: ["/api/analysis-reports", selectedSiteId, actionFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedSiteId && selectedSiteId !== "all") params.append("siteId", selectedSiteId);
      if (actionFilter !== "all") params.append("action", actionFilter);
      const url = params.toString() ? `/api/analysis-reports?${params}` : "/api/analysis-reports";
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${localStorage.getItem("auth_token")}` },
      });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const toggleSection = (section: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(section)) {
        next.delete(section);
      } else {
        next.add(section);
      }
      return next;
    });
  };

  const getDecisionBadge = (status: string) => {
    switch (status) {
      case "ISSUE_PCN":
      case "PROCEED_PCN":
        return <Badge variant="destructive">Issue PCN</Badge>;
      case "HOLD_PCN":
      case "HOLD":
        return <Badge className="bg-amber-500 hover:bg-amber-600">Hold</Badge>;
      case "REVIEW_REQUIRED":
      case "REVIEW":
        return <Badge variant="secondary">Review</Badge>;
      case "DISMISS":
      case "AUTO_DISMISS":
        return <Badge variant="outline" className="text-green-600 border-green-600">Dismissed</Badge>;
      default:
        return <Badge variant="outline">{status || "Pending"}</Badge>;
    }
  };

  const getRiskBadge = (level: string) => {
    switch (level?.toLowerCase()) {
      case "high":
        return <Badge variant="destructive">High Risk</Badge>;
      case "medium":
        return <Badge className="bg-amber-500">Medium Risk</Badge>;
      case "low":
        return <Badge variant="outline" className="text-green-600 border-green-600">Low Risk</Badge>;
      default:
        return <Badge variant="outline">{level || "Unknown"}</Badge>;
    }
  };

  const formatDuration = (minutes?: number) => {
    if (!minutes && minutes !== 0) return "N/A";
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return "N/A";
    return new Date(dateStr).toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const stats = {
    total: reports.length,
    issue: reports.filter(r => {
      const decision = r.pipelineResults?.decisionEngine as any;
      return decision?.status === "ISSUE_PCN" || decision?.status === "PROCEED_PCN";
    }).length,
    hold: reports.filter(r => {
      const decision = r.pipelineResults?.decisionEngine as any;
      return decision?.status === "HOLD_PCN" || decision?.status === "HOLD";
    }).length,
    review: reports.filter(r => {
      const decision = r.pipelineResults?.decisionEngine as any;
      return decision?.status === "REVIEW_REQUIRED" || decision?.status === "REVIEW";
    }).length,
    dismissed: reports.filter(r => {
      const decision = r.pipelineResults?.decisionEngine as any;
      return decision?.status === "DISMISS" || decision?.status === "AUTO_DISMISS";
    }).length,
  };

  return (
    <div className="flex flex-col gap-4 sm:gap-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
            <FileText className="h-5 w-5 sm:h-6 sm:w-6" />
            Analysis Reports
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground">Evidence-based enforcement assessments</p>
        </div>
        <Button variant="outline" size="icon" onClick={() => refetch()} data-testid="button-refresh">
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
        <SearchableSelect
          value={selectedSiteId}
          onValueChange={setSelectedSiteId}
          placeholder="All Sites"
          searchPlaceholder="Search sites..."
          emptyMessage="No sites found"
          triggerClassName="w-full sm:w-[280px]"
          data-testid="select-site"
          options={[
            { value: "all", label: "All Sites" },
            ...sites.map((site) => ({
              value: String(site.id),
              label: site.siteName,
            })),
          ]}
        />

        <Select value={actionFilter} onValueChange={setActionFilter}>
          <SelectTrigger className="w-full sm:w-[180px]" data-testid="select-action-filter">
            <SelectValue placeholder="Filter by action" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Actions</SelectItem>
            <SelectItem value="ISSUE_PCN">Issue PCN</SelectItem>
            <SelectItem value="HOLD_PCN">Hold</SelectItem>
            <SelectItem value="REVIEW_REQUIRED">Review Required</SelectItem>
            <SelectItem value="DISMISS">Dismissed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 sm:gap-4">
        <Card>
          <CardContent className="p-2 sm:p-4 text-center">
            <p className="text-lg sm:text-2xl font-bold">{stats.total}</p>
            <p className="text-xs sm:text-sm text-muted-foreground">Total</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-2 sm:p-4 text-center">
            <p className="text-lg sm:text-2xl font-bold text-red-600">{stats.issue}</p>
            <p className="text-xs sm:text-sm text-muted-foreground">Issue</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-2 sm:p-4 text-center">
            <p className="text-lg sm:text-2xl font-bold text-amber-600">{stats.hold}</p>
            <p className="text-xs sm:text-sm text-muted-foreground">Hold</p>
          </CardContent>
        </Card>
        <Card className="hidden sm:block">
          <CardContent className="p-2 sm:p-4 text-center">
            <p className="text-lg sm:text-2xl font-bold text-blue-600">{stats.review}</p>
            <p className="text-xs sm:text-sm text-muted-foreground">Review</p>
          </CardContent>
        </Card>
        <Card className="hidden sm:block">
          <CardContent className="p-2 sm:p-4 text-center">
            <p className="text-lg sm:text-2xl font-bold text-green-600">{stats.dismissed}</p>
            <p className="text-xs sm:text-sm text-muted-foreground">Dismissed</p>
          </CardContent>
        </Card>
      </div>

      {isLoading ? (
        <Card>
          <CardContent className="p-12 text-center">
            <Loader2 className="h-12 w-12 mx-auto animate-spin text-muted-foreground/50 mb-4" />
            <p className="text-lg font-medium">Loading analysis reports...</p>
          </CardContent>
        </Card>
      ) : reports.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <FileText className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
            <p className="text-lg font-medium">No completed analysis found</p>
            <p className="text-sm text-muted-foreground">
              Analyse evidence bundles in the Evidence section to generate reports
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:gap-4">
          {reports.map((report) => {
            const decision = report.pipelineResults?.decisionEngine as any;
            const evidence = report.pipelineResults?.evidenceTimeline as any;
            const riskLevel = report.pipelineResults?.riskAssessment as any;
            
            return (
              <Card 
                key={report.caseId} 
                className="hover-elevate cursor-pointer overflow-hidden"
                onClick={() => setSelectedReport(report)}
                data-testid={`report-card-${report.caseId}`}
              >
                <CardContent className="p-3 sm:p-4">
                  <div className="flex items-start justify-between gap-2 sm:gap-4">
                    <div className="flex-1 min-w-0 space-y-2 sm:space-y-3">
                      <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                        {getDecisionBadge(decision?.status)}
                        {riskLevel?.level && getRiskBadge(riskLevel.level)}
                        <Badge variant="outline" className="font-mono text-[10px] sm:text-xs">
                          <Car className="h-3 w-3 mr-1" />
                          {report.vrm || "Unknown VRM"}
                        </Badge>
                        <Badge variant="outline" className="text-[10px] sm:text-xs">
                          {Math.round((decision?.overallConfidence || 0) * 100)}%
                        </Badge>
                      </div>
                      
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span className="font-mono">{report.caseReference?.substring(0, 12)}</span>
                        <span>•</span>
                        <span>{report.siteName}</span>
                      </div>
                      
                      <p className="text-xs sm:text-sm line-clamp-2">
                        {decision?.explanation || decision?.reasoning || "Analysis completed"}
                      </p>
                      
                      <div className="flex items-center gap-2 sm:gap-4 text-[10px] sm:text-xs text-muted-foreground flex-wrap">
                        <span className="flex items-center gap-1">
                          <Image className="h-3 w-3" />
                          {report.evidenceCount} file{report.evidenceCount !== 1 ? "s" : ""}
                        </span>
                        {evidence?.timeRange?.durationMinutes && (
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {formatDuration(evidence.timeRange.durationMinutes)}
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {formatDate(report.analysisTimestamp)}
                        </span>
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 sm:h-5 sm:w-5 text-muted-foreground shrink-0" />
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={!!selectedReport} onOpenChange={() => setSelectedReport(null)}>
        <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Analysis Report
            </DialogTitle>
          </DialogHeader>
          
          {selectedReport && (
            <ScrollArea className="flex-1 pr-4">
              <div className="space-y-4">
                {(() => {
                  const decision = selectedReport.pipelineResults?.decisionEngine as any;
                  const evidence = selectedReport.pipelineResults?.evidenceTimeline as any;
                  const vision = selectedReport.pipelineResults?.visionResults as any;
                  const dvla = selectedReport.pipelineResults?.dvlaResults as any;
                  const regulations = selectedReport.pipelineResults?.regulationEvaluation as any;
                  const signage = selectedReport.pipelineResults?.signageCompliance as any;
                  const riskLevel = selectedReport.pipelineResults?.riskAssessment as any;

                  return (
                    <>
                      <div className="flex items-center gap-2 flex-wrap">
                        {getDecisionBadge(decision?.status)}
                        {riskLevel?.level && getRiskBadge(riskLevel.level)}
                        <Badge variant="outline" className="font-mono">
                          <Car className="h-4 w-4 mr-1" />
                          {selectedReport.vrm || "Unknown"}
                        </Badge>
                        <Badge variant="outline">
                          {Math.round((decision?.overallConfidence || 0) * 100)}% Confidence
                        </Badge>
                        {(selectedReport.pipelineResults as any)?.pipelineStatus !== "completed" && (
                          <Badge variant="secondary" className="bg-amber-100 text-amber-800">
                            <AlertTriangle className="h-3 w-3 mr-1" />
                            Partial Data
                          </Badge>
                        )}
                      </div>

                      <Collapsible open={expandedSections.has("summary")} onOpenChange={() => toggleSection("summary")}>
                        <Card>
                          <CollapsibleTrigger asChild>
                            <CardHeader className="cursor-pointer hover-elevate py-3">
                              <CardTitle className="flex items-center justify-between text-sm">
                                <span className="flex items-center gap-2">
                                  <Info className="h-4 w-4" />
                                  Section 1: Evidence Summary
                                </span>
                                {expandedSections.has("summary") ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                              </CardTitle>
                            </CardHeader>
                          </CollapsibleTrigger>
                          <CollapsibleContent>
                            <CardContent className="pt-0">
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                                <div>
                                  <span className="text-muted-foreground">Case Reference:</span>{" "}
                                  <span className="font-mono">{selectedReport.caseReference?.substring(0, 12) || "Pending"}</span>
                                </div>
                                <div>
                                  <span className="text-muted-foreground">Site:</span>{" "}
                                  <span className="font-medium">{selectedReport.siteName || "Not assigned"}</span>
                                </div>
                                <div>
                                  <span className="text-muted-foreground">Evidence Count:</span>{" "}
                                  <span className="font-medium">
                                    {selectedReport.evidenceCount > 0 
                                      ? `${evidence?.imageCount || selectedReport.evidenceCount} images, ${evidence?.videoCount || 0} videos`
                                      : "No evidence uploaded yet"}
                                  </span>
                                </div>
                                <div>
                                  <span className="text-muted-foreground">Capture Source:</span>{" "}
                                  <span className="font-medium">
                                    {evidence?.timestamps?.[0]?.source === "camera_overlay" ? "ANPR Camera" : "Manual Upload"}
                                  </span>
                                </div>
                                <div className="col-span-1 sm:col-span-2">
                                  <span className="text-muted-foreground">Time Window:</span>{" "}
                                  {evidence?.timeRange?.first || evidence?.timeRange?.last ? (
                                    <span>{formatDate(evidence.timeRange.first)} - {formatDate(evidence.timeRange.last)}</span>
                                  ) : (
                                    <span className="text-amber-600">Awaiting timestamp extraction</span>
                                  )}
                                </div>
                              </div>
                            </CardContent>
                          </CollapsibleContent>
                        </Card>
                      </Collapsible>

                      <Collapsible open={expandedSections.has("duration")} onOpenChange={() => toggleSection("duration")}>
                        <Card>
                          <CollapsibleTrigger asChild>
                            <CardHeader className="cursor-pointer hover-elevate py-3">
                              <CardTitle className="flex items-center justify-between text-sm">
                                <span className="flex items-center gap-2">
                                  <Clock className="h-4 w-4" />
                                  Section 2: Duration Calculation
                                </span>
                                {expandedSections.has("duration") ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                              </CardTitle>
                            </CardHeader>
                          </CollapsibleTrigger>
                          <CollapsibleContent>
                            <CardContent className="pt-0">
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                                <div>
                                  <span className="text-muted-foreground">First Seen:</span>{" "}
                                  <span className="font-medium">
                                    {formatDate(evidence?.entryWindow?.start || evidence?.timeRange?.first) !== "N/A" 
                                      ? formatDate(evidence?.entryWindow?.start || evidence?.timeRange?.first) 
                                      : <span className="text-amber-600">Pending extraction</span>}
                                  </span>
                                </div>
                                <div>
                                  <span className="text-muted-foreground">Last Seen:</span>{" "}
                                  <span className="font-medium">
                                    {formatDate(evidence?.exitWindow?.end || evidence?.timeRange?.last) !== "N/A"
                                      ? formatDate(evidence?.exitWindow?.end || evidence?.timeRange?.last)
                                      : <span className="text-amber-600">Pending extraction</span>}
                                  </span>
                                </div>
                                <div>
                                  <span className="text-muted-foreground">Total Stay:</span>{" "}
                                  <span className="font-medium">
                                    {formatDuration(evidence?.timeRange?.durationMinutes || regulations?.durationMinutes) !== "N/A"
                                      ? formatDuration(evidence?.timeRange?.durationMinutes || regulations?.durationMinutes)
                                      : <span className="text-amber-600">Awaiting calculation</span>}
                                  </span>
                                </div>
                                <div>
                                  <span className="text-muted-foreground">Allowed Duration:</span>{" "}
                                  <span className="font-medium">
                                    {formatDuration(regulations?.maxStayAllowed) !== "N/A"
                                      ? formatDuration(regulations?.maxStayAllowed)
                                      : <span className="text-muted-foreground">Site rules not configured</span>}
                                  </span>
                                </div>
                                {regulations?.overstayMinutes > 0 && (
                                  <div className="col-span-1 sm:col-span-2">
                                    <Badge variant="destructive">
                                      Overstay: {formatDuration(regulations.overstayMinutes)}
                                    </Badge>
                                  </div>
                                )}
                                {!evidence?.timeRange?.durationMinutes && !regulations?.durationMinutes && (
                                  <div className="col-span-1 sm:col-span-2 flex items-center gap-2 text-amber-600">
                                    <AlertTriangle className="h-4 w-4" />
                                    <span className="text-xs">Duration calculation requires valid timestamps from evidence</span>
                                  </div>
                                )}
                              </div>
                            </CardContent>
                          </CollapsibleContent>
                        </Card>
                      </Collapsible>

                      <Collapsible open={expandedSections.has("signage")} onOpenChange={() => toggleSection("signage")}>
                        <Card>
                          <CollapsibleTrigger asChild>
                            <CardHeader className="cursor-pointer hover-elevate py-3">
                              <CardTitle className="flex items-center justify-between text-sm">
                                <span className="flex items-center gap-2">
                                  <Scale className="h-4 w-4" />
                                  Section 3: Signage & Regulation Check
                                </span>
                                {expandedSections.has("signage") ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                              </CardTitle>
                            </CardHeader>
                          </CollapsibleTrigger>
                          <CollapsibleContent>
                            <CardContent className="pt-0">
                              <div className="space-y-3 text-sm">
                                <div className="flex items-center justify-between">
                                  <span className="text-muted-foreground">Bay Type:</span>
                                  <span className="font-medium capitalize">
                                    {regulations?.bayType?.replace(/_/g, " ") || "General Parking"}
                                  </span>
                                </div>
                                <div className="flex items-center justify-between">
                                  <span className="text-muted-foreground">Signage Present:</span>
                                  {signage?.entranceSignage?.status === "compliant" ? (
                                    <Badge variant="outline" className="text-green-600">
                                      <CheckCircle2 className="h-3 w-3 mr-1" />Yes
                                    </Badge>
                                  ) : signage?.entranceSignage?.status === "partial" ? (
                                    <Badge variant="secondary">Partial</Badge>
                                  ) : signage?.entranceSignage?.status ? (
                                    <Badge variant="outline">
                                      {signage.entranceSignage.status}
                                    </Badge>
                                  ) : (
                                    <Badge variant="secondary" className="text-amber-600">
                                      <AlertTriangle className="h-3 w-3 mr-1" />Manual review required
                                    </Badge>
                                  )}
                                </div>
                                <div className="flex items-center justify-between">
                                  <span className="text-muted-foreground">Regulation Applied:</span>
                                  <span className="font-medium">{regulations?.regulationType || "Standard"}</span>
                                </div>
                                <div className="flex items-center justify-between">
                                  <span className="text-muted-foreground">Compliance Result:</span>
                                  {regulations?.evaluation?.breachDetected ? (
                                    <Badge variant="destructive">
                                      <XCircle className="h-3 w-3 mr-1" />Breach Detected
                                    </Badge>
                                  ) : regulations?.isOverstay ? (
                                    <Badge variant="destructive">
                                      <XCircle className="h-3 w-3 mr-1" />Overstay Violation
                                    </Badge>
                                  ) : (
                                    <Badge variant="outline" className="text-green-600">
                                      <CheckCircle2 className="h-3 w-3 mr-1" />Compliant
                                    </Badge>
                                  )}
                                </div>
                                {signage?.overallCompliance && (
                                  <div className="flex items-center justify-between">
                                    <span className="text-muted-foreground">Overall Compliance:</span>
                                    <span className="font-medium capitalize">{signage.overallCompliance}</span>
                                  </div>
                                )}
                              </div>
                            </CardContent>
                          </CollapsibleContent>
                        </Card>
                      </Collapsible>

                      <Collapsible open={expandedSections.has("vehicle")} onOpenChange={() => toggleSection("vehicle")}>
                        <Card>
                          <CollapsibleTrigger asChild>
                            <CardHeader className="cursor-pointer hover-elevate py-3">
                              <CardTitle className="flex items-center justify-between text-sm">
                                <span className="flex items-center gap-2">
                                  <Car className="h-4 w-4" />
                                  Section 4: Vehicle & Registry Data
                                </span>
                                {expandedSections.has("vehicle") ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                              </CardTitle>
                            </CardHeader>
                          </CollapsibleTrigger>
                          <CollapsibleContent>
                            <CardContent className="pt-0">
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                                <div>
                                  <span className="text-muted-foreground">Registration:</span>{" "}
                                  <span className="font-mono font-medium">{selectedReport.vrm || "Not detected"}</span>
                                </div>
                                <div>
                                  <span className="text-muted-foreground">Vehicle Type:</span>{" "}
                                  <span className="font-medium">{vision?.vehicleType || dvla?.vehicleType || dvla?.typeApproval || "Unknown"}</span>
                                </div>
                                <div>
                                  <span className="text-muted-foreground">Make:</span>{" "}
                                  <span className="font-medium">{dvla?.make || vision?.make || "Unknown"}</span>
                                </div>
                                <div>
                                  <span className="text-muted-foreground">Colour:</span>{" "}
                                  <span className="font-medium">{dvla?.colour || vision?.colour || "Unknown"}</span>
                                </div>
                                {dvla?.fuelType && (
                                  <div>
                                    <span className="text-muted-foreground">Fuel Type:</span>{" "}
                                    <span className="font-medium">{dvla.fuelType}</span>
                                  </div>
                                )}
                                {dvla?.taxStatus && (
                                  <div>
                                    <span className="text-muted-foreground">Tax Status:</span>{" "}
                                    <Badge variant={dvla.taxStatus === "Taxed" ? "outline" : "destructive"} className={dvla.taxStatus === "Taxed" ? "text-green-600" : ""}>
                                      {dvla.taxStatus}
                                    </Badge>
                                  </div>
                                )}
                                <div className="col-span-1 sm:col-span-2">
                                  {dvla?.verified ? (
                                    <Badge variant="outline" className="text-green-600">
                                      <CheckCircle2 className="h-3 w-3 mr-1" />Registry Verified
                                    </Badge>
                                  ) : selectedReport.vrm ? (
                                    <span className="text-xs text-amber-600 flex items-center gap-1">
                                      <AlertTriangle className="h-3 w-3" />
                                      Registry data unavailable
                                    </span>
                                  ) : (
                                    <span className="text-xs text-amber-600 flex items-center gap-1">
                                      <AlertTriangle className="h-3 w-3" />
                                      VRM detection required for registry lookup
                                    </span>
                                  )}
                                </div>
                              </div>
                            </CardContent>
                          </CollapsibleContent>
                        </Card>
                      </Collapsible>

                      <Collapsible open={expandedSections.has("decision")} onOpenChange={() => toggleSection("decision")}>
                        <Card>
                          <CollapsibleTrigger asChild>
                            <CardHeader className="cursor-pointer hover-elevate py-3">
                              <CardTitle className="flex items-center justify-between text-sm">
                                <span className="flex items-center gap-2">
                                  <Shield className="h-4 w-4" />
                                  Section 5: Decision Explanation
                                </span>
                                {expandedSections.has("decision") ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                              </CardTitle>
                            </CardHeader>
                          </CollapsibleTrigger>
                          <CollapsibleContent>
                            <CardContent className="pt-0">
                              <div className="space-y-4">
                                <div>
                                  <p className="text-sm font-medium mb-2">Outcome</p>
                                  <div className="flex items-center gap-2 flex-wrap">
                                    {getDecisionBadge(decision?.status)}
                                    <span className="text-sm text-muted-foreground">
                                      with {Math.round((decision?.overallConfidence || 0) * 100)}% confidence
                                    </span>
                                  </div>
                                </div>

                                <Separator />

                                <div>
                                  <p className="text-sm font-medium mb-2">Reasoning</p>
                                  <p className="text-sm text-muted-foreground">
                                    {decision?.explanation || decision?.reasoning || "No explanation available"}
                                  </p>
                                </div>

                                {decision?.violations?.length > 0 && (
                                  <>
                                    <Separator />
                                    <div>
                                      <p className="text-sm font-medium mb-2">Rule Violations</p>
                                      <div className="space-y-2">
                                        {decision.violations.map((v: any, i: number) => (
                                          <div key={i} className="flex items-start gap-2 text-sm">
                                            <XCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                                            <span>{v.description || v.type || v}</span>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  </>
                                )}

                                <Separator />

                                <div>
                                  <p className="text-sm font-medium mb-2">Confidence Breakdown</p>
                                  <div className="flex items-center gap-3">
                                    <Progress value={(decision?.overallConfidence || 0) * 100} className="flex-1" />
                                    <span className="font-mono text-sm">{Math.round((decision?.overallConfidence || 0) * 100)}%</span>
                                  </div>
                                  {decision?.confidenceNotes && (
                                    <p className="text-xs text-muted-foreground mt-2">{decision.confidenceNotes}</p>
                                  )}
                                </div>
                              </div>
                            </CardContent>
                          </CollapsibleContent>
                        </Card>
                      </Collapsible>
                    </>
                  );
                })()}
              </div>
            </ScrollArea>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
