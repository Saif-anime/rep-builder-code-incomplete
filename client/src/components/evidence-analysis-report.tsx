import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Brain,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Info,
  FileText,
  BarChart3,
  Scale,
  Camera,
  Shield,
  History,
  Loader2,
  FileCheck,
  Car,
  Cloud,
  User,
  MessageSquare,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { ConfidenceMeter } from "@/components/confidence-meter";
import type { CaseAnalysis, CaseVehicle, Evidence } from "@shared/schema";

interface EvidenceAnalysisReportProps {
  bundleId: string;
  caseReference: string;
  analysis: CaseAnalysis | null;
  vehicles: CaseVehicle[];
  evidenceFiles: Evidence[];
  siteName: string;
  siteId: number | null;
  vrm: string | null;
  timeWindow: { start: string; end: string } | null;
  onPcnIssued?: () => void;
}

interface PipelineResults {
  caseId: string;
  pipelineStatus: "pending" | "running" | "completed" | "failed";
  evidenceTimeline: any;
  visionResults: any;
  dvlaData: any;
  regulationEvaluation: any;
  signageCompliance: any;
  contextEnrichment: {
    weather: {
      conditions: string;
      temperature?: number;
      visibility?: string;
      precipitation?: boolean;
      dataSource: string;
      timestamp: string;
    } | null;
    events: Array<{ name: string; type: string; distance?: string; impact: "low" | "medium" | "high" }>;
    roadworks: Array<{ location: string; type: string; impact: "low" | "medium" | "high" }>;
    spikeDetection: {
      isSpike: boolean;
      baselineOccupancy: number;
      currentOccupancy: number;
      deviationPercent: number;
      recommendation: "HOLD_PCN" | "PROCEED_PCN" | "REVIEW_REQUIRED" | null;
    } | null;
    anomalies: string[];
    confidenceAdjustment: number;
  } | null;
  behaviourProfiling: {
    driverProfile: {
      vrm: string;
      visitCount: number;
      averageDurationMinutes: number;
      overstayCount: number;
      lastVisit: string | null;
      classification: "FAIR_USER" | "COMMUTER_MISUSE" | "FIRST_TIME_LATE" | "REPEAT_OFFENDER" | "UNKNOWN";
      riskScore: number;
    } | null;
    siteHistory: {
      totalVisits: number;
      complianceRate: number;
      lastCompliantVisit: string | null;
    } | null;
    patternAnalysis: {
      typicalArrivalTime: string | null;
      typicalDuration: number | null;
      weekdayPattern: boolean;
      weekendPattern: boolean;
    } | null;
    mitigatingFactors: string[];
    aggravatingFactors: string[];
  } | null;
  bayRuleEvaluation: {
    bayId: number | null;
    bayType: "disabled" | "ev" | "parent_child" | "standard" | "loading" | "permit" | null;
    bayName: string | null;
    ruleApplied: string;
    detections: {
      badgeVisible: boolean | null;
      badgeConfidence: number | null;
      evDetected: boolean | null;
      evConfidence: number | null;
      childDetected: boolean | null;
      childConfidence: number | null;
    };
    decision: "ISSUE_PCN" | "NO_PCN" | "REVIEW_REQUIRED";
    explanation: string;
    evidenceUsed: Array<{ evidenceId: number; timestamp: string; contribution: string }>;
    confidenceScore: number;
  } | null;
  decision: {
    status: "PCN_ELIGIBLE" | "REVIEW_REQUIRED" | "NO_PCN" | "BLOCKED_BY_BAY_RULE";
    eligibilityGates: {
      regulationBreach: boolean;
      signageCompliant: boolean;
      confidenceThresholdMet: boolean;
      noHoldFlags: boolean;
      riskAcceptable: boolean;
      bayRuleAllowsPCN: boolean;
    };
    overallConfidence: number;
    legalRisk: "low" | "medium" | "high";
    recommendation: string;
    reasoning: string;
    plainEnglishExplanation: string;
    blockers: string[];
  } | null;
  analysisCompletedAt: string | null;
}

interface AnalysisStep {
  id: number;
  caseId: string;
  stepName: string;
  stepOrder: number;
  status: string;
  startedAt: string;
  completedAt: string | null;
  output: any;
  errors: string[] | null;
}

// Helper function to format duration from minutes
function formatDurationFromMinutes(minutes: number | undefined | null): string {
  if (minutes == null || isNaN(minutes)) return "—";
  if (minutes === 0) return "0m";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

export function EvidenceAnalysisReport({
  bundleId,
  caseReference,
  analysis,
  vehicles,
  evidenceFiles,
  siteName,
  siteId,
  vrm,
  timeWindow,
  onPcnIssued,
}: EvidenceAnalysisReportProps) {
  const { toast } = useToast();
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(["summary", "evidence", "measurements", "regulations", "signage", "bayRule", "context", "risk", "explanation", "audit"])
  );

  const { data: pipelineResults, isLoading: loadingPipeline } = useQuery<PipelineResults>({
    queryKey: [`/api/cases/${bundleId}/pipeline/results`],
    enabled: !!bundleId,
  });

  const { data: pipelineSteps = [] } = useQuery<AnalysisStep[]>({
    queryKey: [`/api/cases/${bundleId}/pipeline/steps`],
    enabled: !!bundleId,
  });

  const { data: siteRules } = useQuery<{
    maxStayMinutes?: number;
    graceEntryMinutes?: number;
    graceExitMinutes?: number;
    enforcementMode?: string;
    enforcementHours?: { start: string; end: string };
  }>({
    queryKey: [`/api/site-rules/by-site/${siteId}`],
    enabled: !!siteId,
  });

  const runPipelineMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", `/api/cases/${bundleId}/pipeline/run`);
    },
    onSuccess: () => {
      toast({ title: "Pipeline started", description: "Analysis is running..." });
      queryClient.invalidateQueries({ queryKey: [`/api/cases/${bundleId}/pipeline/results`] });
      queryClient.invalidateQueries({ queryKey: [`/api/cases/${bundleId}/pipeline/steps`] });
      queryClient.invalidateQueries({ queryKey: ["/api/evidence/bundles"] });
    },
    onError: (error: Error) => {
      toast({ title: "Pipeline failed", description: error.message, variant: "destructive" });
    },
  });

  const issuePcnMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", `/api/cases/${bundleId}/pipeline/issue-pcn`);
    },
    onSuccess: () => {
      toast({ title: "PCN Issued", description: "Penalty Charge Notice has been generated" });
      queryClient.invalidateQueries({ queryKey: [`/api/cases/${bundleId}/pipeline/results`] });
      queryClient.invalidateQueries({ queryKey: ["/api/evidence/bundles"] });
      onPcnIssued?.();
    },
    onError: (error: Error) => {
      toast({ title: "PCN issuance failed", description: error.message, variant: "destructive" });
    },
  });

  const toggleSection = (section: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) {
        next.delete(section);
      } else {
        next.add(section);
      }
      return next;
    });
  };

  const decision = pipelineResults?.decision;
  const regulations = pipelineResults?.regulationEvaluation;
  const signage = pipelineResults?.signageCompliance;
  const bayRuleEvaluation = pipelineResults?.bayRuleEvaluation;
  const vision = pipelineResults?.visionResults;
  const dvla = pipelineResults?.dvlaData;
  const evidence = pipelineResults?.evidenceTimeline;
  const contextEnrichment = pipelineResults?.contextEnrichment;
  const behaviourProfiling = pipelineResults?.behaviourProfiling;

  const isPcnEligible = 
    decision?.status === "PCN_ELIGIBLE" &&
    decision?.eligibilityGates?.signageCompliant &&
    decision?.eligibilityGates?.confidenceThresholdMet &&
    decision?.eligibilityGates?.noHoldFlags &&
    decision?.eligibilityGates?.riskAcceptable;

  const getDecisionBadge = (status: string) => {
    switch (status) {
      case "PCN_ELIGIBLE":
        return <Badge variant="destructive">PCN Eligible</Badge>;
      case "NO_VIOLATION":
        return <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-400">No Violation</Badge>;
      case "REVIEW_REQUIRED":
        return <Badge variant="secondary">Review Required</Badge>;
      case "HOLD_PCN":
        return <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-400">PCN On Hold</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getComplianceBadge = (status: string) => {
    switch (status) {
      case "PASS":
        return <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-400"><CheckCircle2 className="h-3 w-3 mr-1" />PASS</Badge>;
      case "FAIL":
        return <Badge variant="destructive"><XCircle className="h-3 w-3 mr-1" />FAIL</Badge>;
      case "PARTIAL":
        return <Badge variant="secondary"><AlertTriangle className="h-3 w-3 mr-1" />Partial</Badge>;
      default:
        return <Badge variant="outline">{status || "Unknown"}</Badge>;
    }
  };

  if (!analysis && !pipelineResults) {
    return (
      <Card>
        <CardContent className="p-6 text-center">
          <Brain className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
          <h3 className="font-medium mb-2">No Analysis Available</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Run the analysis pipeline to generate a comprehensive report
          </p>
          <Button 
            onClick={() => runPipelineMutation.mutate()}
            disabled={runPipelineMutation.isPending}
            data-testid="button-run-pipeline"
          >
            {runPipelineMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Analysing...
              </>
            ) : (
              <>
                <Brain className="h-4 w-4 mr-2" />
                Analyse Case
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h3 className="font-semibold flex items-center gap-2 text-base sm:text-lg">
          <Brain className="h-5 w-5 shrink-0" />
          Full Analysis Report
        </h3>
        <div className="flex items-center gap-2 shrink-0">
          <Button 
            variant="outline"
            size="sm"
            onClick={() => runPipelineMutation.mutate()}
            disabled={runPipelineMutation.isPending}
            data-testid="button-rerun-pipeline"
          >
            {runPipelineMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <Brain className="h-4 w-4 mr-1" />
                Re-analyse
              </>
            )}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {decision?.status && getDecisionBadge(decision.status)}
        {decision?.overallConfidence !== undefined && decision.overallConfidence !== null && (
          <Badge variant="outline" className="whitespace-nowrap">
            Confidence: {Math.round(decision.overallConfidence * 100)}%
          </Badge>
        )}
        {decision?.legalRisk && (
          <Badge 
            variant={decision.legalRisk === "high" ? "destructive" : decision.legalRisk === "medium" ? "secondary" : "outline"}
            className="whitespace-nowrap"
          >
            Risk: {decision.legalRisk.toUpperCase()}
          </Badge>
        )}
      </div>

      <Collapsible open={expandedSections.has("summary")} onOpenChange={() => toggleSection("summary")}>
        <Card>
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer hover-elevate">
              <CardTitle className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2">
                  <Info className="h-4 w-4" />
                  Section 1: Case Summary
                </span>
                {expandedSections.has("summary") ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </CardTitle>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="pt-0">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 text-sm">
                <div className="flex flex-wrap gap-1">
                  <span className="text-muted-foreground">Site:</span>{" "}
                  <span className="font-medium break-all">{siteName}</span>
                </div>
                <div className="flex flex-wrap gap-1">
                  <span className="text-muted-foreground">Case Ref:</span>{" "}
                  <span className="font-mono break-all">{caseReference.substring(0, 12)}</span>
                </div>
                <div className="flex flex-wrap gap-1">
                  <span className="text-muted-foreground">VRM:</span>{" "}
                  <span className="font-mono font-medium">{vrm || vehicles[0]?.registrationNumber || "Not detected"}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Vehicle:</span>{" "}
                  <span>{vehicles[0] ? `${vehicles[0].make} ${vehicles[0].colour}` : "Unknown"}</span>
                </div>
                {timeWindow && (
                  <>
                    <div>
                      <span className="text-muted-foreground">Entry:</span>{" "}
                      <span>{new Date(timeWindow.start).toLocaleString()}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Exit:</span>{" "}
                      <span>{new Date(timeWindow.end).toLocaleString()}</span>
                    </div>
                  </>
                )}
                {regulations?.durationMinutes && (
                  <div>
                    <span className="text-muted-foreground">Duration:</span>{" "}
                    <span className="font-medium">{regulations.durationMinutes} minutes</span>
                    {(siteRules?.maxStayMinutes || regulations?.maxStayAllowed) && (
                      <span className="text-muted-foreground"> / {siteRules?.maxStayMinutes || regulations?.maxStayAllowed} allowed</span>
                    )}
                  </div>
                )}
                <div>
                  <span className="text-muted-foreground">Decision:</span>{" "}
                  {decision?.status && getDecisionBadge(decision.status)}
                </div>
              </div>
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      <Collapsible open={expandedSections.has("evidence")} onOpenChange={() => toggleSection("evidence")}>
        <Card>
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer hover-elevate">
              <CardTitle className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  Section 2: What Was Analysed
                </span>
                {expandedSections.has("evidence") ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </CardTitle>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="pt-0">
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 text-sm">
                  <div className="flex flex-wrap gap-1">
                    <span className="text-muted-foreground">Evidence Count:</span>{" "}
                    <span className="font-medium">{evidenceFiles.length} files</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    <span className="text-muted-foreground">Sources:</span>{" "}
                    <span className="flex items-center gap-1">
                      <Camera className="h-3 w-3 shrink-0" />
                      {evidence?.sources?.camera || 0} camera,{" "}
                      {evidence?.sources?.manual || evidenceFiles.length} manual
                    </span>
                  </div>
                  {evidence?.timeRange && (
                    <div className="col-span-1 sm:col-span-2 flex flex-wrap gap-1">
                      <span className="text-muted-foreground">Time Range:</span>{" "}
                      <span className="break-all">{evidence.timeRange.start} - {evidence.timeRange.end}</span>
                    </div>
                  )}
                </div>
                <Separator />
                <div>
                  <p className="text-sm font-medium mb-2">Analysis Components:</p>
                  <div className="flex gap-2 flex-wrap">
                    <Badge variant="outline">Image Interpretation</Badge>
                    <Badge variant="outline">Object Detection</Badge>
                    {dvla?.verified && <Badge variant="outline">Vehicle Registry Lookup</Badge>}
                  </div>
                </div>
              </div>
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      <Collapsible open={expandedSections.has("measurements")} onOpenChange={() => toggleSection("measurements")}>
        <Card>
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer hover-elevate">
              <CardTitle className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2">
                  <BarChart3 className="h-4 w-4" />
                  Section 3: How It Was Measured
                </span>
                {expandedSections.has("measurements") ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </CardTitle>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="pt-0">
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Entry/Exit Detection</p>
                    <div className="text-sm text-muted-foreground">
                      {evidence?.entryMethod || "ANPR camera capture / Manual timestamp extraction"}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Duration Calculation</p>
                    <div className="text-sm text-muted-foreground">
                      Exit timestamp - Entry timestamp{" "}
                      {siteRules?.graceEntryMinutes && `(+${siteRules.graceEntryMinutes}min grace)`}
                    </div>
                  </div>
                </div>
                <Separator />
                <div>
                  <p className="text-sm font-medium mb-3">Confidence Scores</p>
                  <div className="space-y-3">
                    {vision?.plateConfidence && (
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 sm:gap-4">
                        <span className="text-sm shrink-0">Plate OCR</span>
                        <ConfidenceMeter value={vision.plateConfidence} className="w-full sm:w-32" />
                      </div>
                    )}
                    {vision?.vehicleConfidence && (
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 sm:gap-4">
                        <span className="text-sm shrink-0">Vehicle Detection</span>
                        <ConfidenceMeter value={vision.vehicleConfidence} className="w-full sm:w-32" />
                      </div>
                    )}
                    {vision?.bayConfidence && (
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 sm:gap-4">
                        <span className="text-sm shrink-0">Bay Analysis</span>
                        <ConfidenceMeter value={vision.bayConfidence} className="w-full sm:w-32" />
                      </div>
                    )}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 sm:gap-4 pt-2 border-t">
                      <span className="text-sm font-medium shrink-0">Overall Confidence</span>
                      <ConfidenceMeter value={decision?.overallConfidence || analysis?.confidenceScore || 0} className="w-full sm:w-32" />
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      <Collapsible open={expandedSections.has("regulations")} onOpenChange={() => toggleSection("regulations")}>
        <Card>
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer hover-elevate">
              <CardTitle className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2">
                  <Scale className="h-4 w-4" />
                  Section 4: Regulations Applied
                </span>
                {expandedSections.has("regulations") ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </CardTitle>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="pt-0">
              <div className="space-y-3">
                {/* Max Stay Rule with Time Math */}
                <div className={`p-3 rounded-md border ${
                  regulations?.evaluation?.complianceResult === "OVERSTAY" 
                    ? 'bg-destructive/10 border-destructive/20' 
                    : regulations?.evaluation?.complianceResult === "UNKNOWN"
                    ? 'bg-amber-50 border-amber-200 dark:bg-amber-900/20 dark:border-amber-700'
                    : 'bg-muted/50'
                }`}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium text-sm">Maximum Stay Compliance</span>
                    {regulations?.evaluation?.complianceResult === "OVERSTAY" ? (
                      <Badge variant="destructive"><XCircle className="h-3 w-3 mr-1" />Overstay</Badge>
                    ) : regulations?.evaluation?.complianceResult === "UNKNOWN" ? (
                      <Badge variant="secondary"><AlertTriangle className="h-3 w-3 mr-1" />Review Required</Badge>
                    ) : (
                      <Badge variant="outline" className="bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400">
                        <CheckCircle2 className="h-3 w-3 mr-1" />OK
                      </Badge>
                    )}
                  </div>
                  
                  {/* Time Calculation Display */}
                  <div className="grid grid-cols-2 gap-2 text-sm mb-2">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Total Parked:</span>
                      <span className="font-medium">{formatDurationFromMinutes(regulations?.evaluation?.actualDurationMinutes)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Max Stay:</span>
                      <span className="font-medium">{regulations?.evaluation?.allowedDurationMinutes != null ? formatDurationFromMinutes(regulations.evaluation.allowedDurationMinutes) : "Unknown"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Grace Period:</span>
                      <span className="font-medium">{regulations?.rules?.gracePeriodMinutes ?? 0} min</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Effective Duration:</span>
                      <span className="font-medium">{formatDurationFromMinutes(regulations?.evaluation?.effectiveDurationMinutes)}</span>
                    </div>
                  </div>
                  
                  {/* Rule Source */}
                  {regulations?.evaluation?.ruleSource && (
                    <div className="text-xs text-muted-foreground border-t pt-1 mt-1">
                      Source: {regulations.evaluation.ruleSource === "site_policy" ? "Site Policy" : regulations.evaluation.ruleSource === "signage" ? "Signage" : "Unknown"}
                    </div>
                  )}
                  
                  {/* Explanation */}
                  {regulations?.evaluation?.breachExplanation && (
                    <p className={`text-xs mt-2 ${regulations?.evaluation?.complianceResult === "OVERSTAY" ? 'text-destructive' : 'text-muted-foreground'}`}>
                      {regulations.evaluation.breachExplanation}
                    </p>
                  )}
                </div>

                {/* Enforcement Hours */}
                {(regulations?.rules?.enforcementHours || siteRules?.enforcementHours) && (
                  <div className={`p-3 rounded-md border ${regulations?.evaluation?.withinEnforcementHours === false ? 'bg-yellow-50 border-yellow-200 dark:bg-yellow-900/20' : 'bg-muted/50'}`}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium text-sm">Enforcement Hours</span>
                      <Badge variant="outline">
                        <CheckCircle2 className="h-3 w-3 mr-1" />
                        {regulations?.evaluation?.withinEnforcementHours !== false ? "In Effect" : "Outside Hours"}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {regulations?.rules?.enforcementHours?.start || siteRules?.enforcementHours?.start} - {regulations?.rules?.enforcementHours?.end || siteRules?.enforcementHours?.end}
                      {regulations?.rules?.enforcementHours?.days && (
                        <span className="ml-2">({regulations.rules.enforcementHours.days.join(", ")})</span>
                      )}
                    </p>
                  </div>
                )}

                {/* Permit Required */}
                {regulations?.rules?.permitRequired && (
                  <div className="p-3 rounded-md border bg-muted/50">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium text-sm">Permit Required</span>
                      <Badge variant="secondary">Required</Badge>
                    </div>
                  </div>
                )}

                {/* Grace Period */}
                {regulations?.rules?.gracePeriodMinutes && (
                  <div className="p-3 rounded-md border bg-muted/50">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium text-sm">Grace Period</span>
                      <Badge variant="outline">{regulations.rules.gracePeriodMinutes} min</Badge>
                    </div>
                  </div>
                )}

                {/* Special Rules */}
                {regulations?.rules?.specialRules?.length > 0 && (
                  <div className="p-3 rounded-md border bg-muted/50">
                    <span className="font-medium text-sm">Special Rules</span>
                    <ul className="mt-2 space-y-1">
                      {regulations.rules.specialRules.map((rule: string, idx: number) => (
                        <li key={idx} className="text-sm text-muted-foreground">• {rule}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Site Name */}
                {regulations?.siteName && (
                  <div className="text-xs text-muted-foreground border-t pt-2 mt-2">
                    Site: {regulations.siteName}
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
            <CardHeader className="cursor-pointer hover-elevate">
              <CardTitle className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2">
                  <FileCheck className="h-4 w-4" />
                  Section 5: Signage Assessment
                </span>
                {expandedSections.has("signage") ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </CardTitle>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="pt-0">
              <div className="space-y-4">
                {/* Signage Source Indicator */}
                <div className="p-3 rounded-md border bg-muted/50 mb-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Signage Source</span>
                    <Badge variant={signage?.appliedSignageId ? "default" : "secondary"}>
                      {signage?.appliedSignageId ? "Parking Site Configuration" : "Not Configured"}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {signage?.appliedSignageId 
                      ? `Using: ${signage.appliedSignageTitle || "Site signage"}`
                      : "No signage configured for this site. Upload signage PDFs in Parking Sites > Site Signage."}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="p-3 rounded-md border bg-muted/50">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm">Entrance Signage</span>
                      {getComplianceBadge(
                        typeof signage?.entranceSignage === 'object' 
                          ? signage.entranceSignage?.status || "unknown"
                          : signage?.entranceSignage || "Unknown"
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {typeof signage?.entranceSignage === 'object' 
                        ? signage.entranceSignage?.notes 
                        : signage?.appliedSignageId 
                          ? "From site signage configuration" 
                          : "No signage configured for this site"}
                    </p>
                  </div>
                  <div className="p-3 rounded-md border bg-muted/50">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm">Terms Visibility</span>
                      {getComplianceBadge(
                        typeof signage?.termsVisibility === 'object' 
                          ? signage.termsVisibility?.status || "unknown"
                          : signage?.termsVisibility || "Unknown"
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {typeof signage?.termsVisibility === 'object' 
                        ? signage.termsVisibility?.notes 
                        : signage?.appliedSignageId 
                          ? "From site signage configuration" 
                          : "No signage configured for this site"}
                    </p>
                  </div>
                </div>
                <Separator />
                <div className="flex items-center justify-between">
                  <span className="font-medium text-sm">Overall Signage Compliance</span>
                  {getComplianceBadge(signage?.overallCompliance || "Unknown")}
                </div>
                {(signage?.overallConfidence || signage?.confidenceScore) && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Signage Confidence</span>
                    <ConfidenceMeter value={signage.overallConfidence || signage.confidenceScore || 0} className="w-32" />
                  </div>
                )}
                {signage?.issues?.length > 0 && (
                  <div className="p-3 rounded-md bg-amber-50 border border-amber-200 dark:bg-amber-900/20 dark:border-amber-700">
                    <p className="text-sm font-medium text-amber-800 dark:text-amber-400 flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4" />
                      Site Signage Issues
                    </p>
                    <ul className="text-sm text-amber-700 dark:text-amber-300 mt-1 list-disc list-inside">
                      {signage.issues.map((issue: string, i: number) => (
                        <li key={i}>
                          {issue.includes("signage inspection") 
                            ? issue.replace("signage inspection", "site signage configuration")
                            : issue}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {signage?.warnings?.length > 0 && (
                  <div className="p-3 rounded-md bg-amber-50 border border-amber-200 dark:bg-amber-900/20 dark:border-amber-700">
                    <p className="text-sm font-medium text-amber-800 dark:text-amber-400 flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4" />
                      Signage Warnings
                    </p>
                    <ul className="text-sm text-amber-700 dark:text-amber-300 mt-1 list-disc list-inside">
                      {signage.warnings.map((w: string, i: number) => <li key={i}>{w}</li>)}
                    </ul>
                  </div>
                )}

                {signage?.extractedRegulations && (
                  <div className="p-3 rounded-md border bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-700">
                    <p className="text-sm font-medium text-blue-800 dark:text-blue-400 flex items-center gap-2 mb-2">
                      <FileText className="h-4 w-4" />
                      Extracted Rules Applied
                    </p>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Source:</span>
                        <span className="font-medium">{signage.extractedRegulations.source || "Not specified"}</span>
                      </div>
                      {signage.extractedRegulations.maxStayMinutes != null && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Max Stay:</span>
                          <span className="font-medium">{signage.extractedRegulations.maxStayMinutes} minutes</span>
                        </div>
                      )}
                      {signage.extractedRegulations.graceMinutes != null && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Grace Period:</span>
                          <span className="font-medium">{signage.extractedRegulations.graceMinutes} minutes</span>
                        </div>
                      )}
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Confidence:</span>
                        <span className="font-medium">{((signage.extractedRegulations.confidence || 0) * 100).toFixed(0)}%</span>
                      </div>
                    </div>
                    {signage.appliedSignageId && signage.appliedSignageTitle && (
                      <div className="mt-2 pt-2 border-t border-blue-200 dark:border-blue-700">
                        <span className="text-xs text-blue-700 dark:text-blue-300">
                          Applied from: {signage.appliedSignageTitle} (ID: {signage.appliedSignageId})
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      {/* Section 6: Bay Rule Evaluation */}
      <Collapsible open={expandedSections.has("bayRule")} onOpenChange={() => toggleSection("bayRule")}>
        <Card>
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer hover-elevate">
              <CardTitle className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2">
                  <Car className="h-4 w-4" />
                  Section 6: Bay Type Enforcement
                </span>
                {expandedSections.has("bayRule") ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </CardTitle>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="pt-0">
              <div className="space-y-4">
                {bayRuleEvaluation ? (
                  <>
                    {/* Bay Type and Rule Applied */}
                    <div className="grid grid-cols-2 gap-4">
                      <div className="p-3 rounded-md border bg-muted/50">
                        <span className="text-sm font-medium">Bay Type</span>
                        <div className="mt-1 flex items-center gap-2">
                          <Badge variant="outline" className="capitalize">
                            {bayRuleEvaluation.bayType?.replace(/_/g, " ") || "Standard"}
                          </Badge>
                          {bayRuleEvaluation.bayName && (
                            <span className="text-xs text-muted-foreground">{bayRuleEvaluation.bayName}</span>
                          )}
                        </div>
                      </div>
                      <div className="p-3 rounded-md border bg-muted/50">
                        <span className="text-sm font-medium">Rule Applied</span>
                        <p className="text-xs text-muted-foreground mt-1">{bayRuleEvaluation.ruleApplied}</p>
                      </div>
                    </div>

                    {/* Detections */}
                    <div className="p-3 rounded-md border bg-muted/50">
                      <span className="text-sm font-medium mb-2 block">Bay-Specific Detections</span>
                      <div className="grid grid-cols-3 gap-3">
                        {bayRuleEvaluation.bayType === "disabled" && (
                          <div className="p-2 rounded border bg-background">
                            <div className="flex items-center justify-between">
                              <span className="text-xs">Blue Badge</span>
                              {bayRuleEvaluation.detections.badgeVisible === true ? (
                                <Badge variant="outline" className="bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400">
                                  <CheckCircle2 className="h-3 w-3 mr-1" /> Visible
                                </Badge>
                              ) : bayRuleEvaluation.detections.badgeVisible === false ? (
                                <Badge variant="outline" className="bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400">
                                  <XCircle className="h-3 w-3 mr-1" /> Not Visible
                                </Badge>
                              ) : (
                                <Badge variant="outline" className="bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400">
                                  <AlertTriangle className="h-3 w-3 mr-1" /> Uncertain
                                </Badge>
                              )}
                            </div>
                            {bayRuleEvaluation.detections.badgeConfidence != null && (
                              <div className="mt-1">
                                <ConfidenceMeter value={bayRuleEvaluation.detections.badgeConfidence} className="w-full" />
                              </div>
                            )}
                          </div>
                        )}
                        {bayRuleEvaluation.bayType === "ev" && (
                          <div className="p-2 rounded border bg-background">
                            <div className="flex items-center justify-between">
                              <span className="text-xs">Electric Vehicle</span>
                              {bayRuleEvaluation.detections.evDetected === true ? (
                                <Badge variant="outline" className="bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400">
                                  <CheckCircle2 className="h-3 w-3 mr-1" /> Confirmed EV
                                </Badge>
                              ) : bayRuleEvaluation.detections.evDetected === false ? (
                                <Badge variant="outline" className="bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400">
                                  <XCircle className="h-3 w-3 mr-1" /> Not EV
                                </Badge>
                              ) : (
                                <Badge variant="outline" className="bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400">
                                  <AlertTriangle className="h-3 w-3 mr-1" /> Uncertain
                                </Badge>
                              )}
                            </div>
                            {bayRuleEvaluation.detections.evConfidence != null && (
                              <div className="mt-1">
                                <ConfidenceMeter value={bayRuleEvaluation.detections.evConfidence} className="w-full" />
                              </div>
                            )}
                          </div>
                        )}
                        {bayRuleEvaluation.bayType === "parent_child" && (
                          <div className="p-2 rounded border bg-background">
                            <div className="flex items-center justify-between">
                              <span className="text-xs">Child Present</span>
                              {bayRuleEvaluation.detections.childDetected === true ? (
                                <Badge variant="outline" className="bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400">
                                  <CheckCircle2 className="h-3 w-3 mr-1" /> Detected
                                </Badge>
                              ) : bayRuleEvaluation.detections.childDetected === false ? (
                                <Badge variant="outline" className="bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400">
                                  <XCircle className="h-3 w-3 mr-1" /> Not Detected
                                </Badge>
                              ) : (
                                <Badge variant="outline" className="bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400">
                                  <AlertTriangle className="h-3 w-3 mr-1" /> Uncertain
                                </Badge>
                              )}
                            </div>
                            {bayRuleEvaluation.detections.childConfidence != null && (
                              <div className="mt-1">
                                <ConfidenceMeter value={bayRuleEvaluation.detections.childConfidence} className="w-full" />
                              </div>
                            )}
                          </div>
                        )}
                        {(bayRuleEvaluation.bayType === "standard" || bayRuleEvaluation.bayType === "loading" || bayRuleEvaluation.bayType === "permit") && (
                          <div className="p-2 rounded border bg-background col-span-3">
                            <span className="text-xs text-muted-foreground">Standard time and permit restrictions apply. No special bay-type detections required.</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Decision */}
                    <div className={`p-3 rounded-md border ${
                      bayRuleEvaluation.decision === "NO_PCN" 
                        ? 'bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-700'
                        : bayRuleEvaluation.decision === "ISSUE_PCN"
                        ? 'bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-700'
                        : 'bg-amber-50 border-amber-200 dark:bg-amber-900/20 dark:border-amber-700'
                    }`}>
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-medium text-sm">Bay Rule Decision</span>
                        <Badge variant={
                          bayRuleEvaluation.decision === "NO_PCN" ? "outline" : 
                          bayRuleEvaluation.decision === "ISSUE_PCN" ? "destructive" : "secondary"
                        }>
                          {bayRuleEvaluation.decision === "NO_PCN" && <CheckCircle2 className="h-3 w-3 mr-1" />}
                          {bayRuleEvaluation.decision === "ISSUE_PCN" && <XCircle className="h-3 w-3 mr-1" />}
                          {bayRuleEvaluation.decision === "REVIEW_REQUIRED" && <AlertTriangle className="h-3 w-3 mr-1" />}
                          {bayRuleEvaluation.decision.replace(/_/g, " ")}
                        </Badge>
                      </div>
                      <p className="text-sm">{bayRuleEvaluation.explanation}</p>
                      <div className="flex items-center justify-between mt-2">
                        <span className="text-xs text-muted-foreground">Confidence</span>
                        <ConfidenceMeter value={bayRuleEvaluation.confidenceScore} className="w-32" />
                      </div>
                    </div>

                    {/* Evidence Used */}
                    {bayRuleEvaluation.evidenceUsed?.length > 0 && (
                      <div className="p-3 rounded-md border bg-muted/50">
                        <span className="text-sm font-medium">Evidence Used for Bay Evaluation</span>
                        <div className="mt-2 space-y-1">
                          {bayRuleEvaluation.evidenceUsed.map((ev, i) => (
                            <div key={i} className="flex items-center justify-between text-xs">
                              <span className="text-muted-foreground">{ev.contribution}</span>
                              <span className="text-muted-foreground">Evidence #{ev.evidenceId}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="p-3 rounded-md border bg-muted/50 text-center">
                    <p className="text-sm text-muted-foreground">No bay-specific evaluation performed. Standard rules apply.</p>
                  </div>
                )}
              </div>
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      <Collapsible open={expandedSections.has("context")} onOpenChange={() => toggleSection("context")}>
        <Card>
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer hover-elevate">
              <CardTitle className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2">
                  <Cloud className="h-4 w-4" />
                  Section 7: Context Signals
                </span>
                {expandedSections.has("context") ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </CardTitle>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="pt-0">
              <div className="space-y-4">
                {contextEnrichment?.weather && (
                  <div className="p-3 rounded-md border bg-muted/50">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-medium text-sm flex items-center gap-2">
                        <Cloud className="h-4 w-4" />
                        Weather Conditions
                      </span>
                      <Badge variant="outline">{contextEnrichment.weather.conditions}</Badge>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                      {contextEnrichment.weather.temperature && (
                        <span>Temp: {contextEnrichment.weather.temperature}°C</span>
                      )}
                      {contextEnrichment.weather.visibility && (
                        <span>Visibility: {contextEnrichment.weather.visibility}</span>
                      )}
                      <span>Source: {contextEnrichment.weather.dataSource}</span>
                    </div>
                  </div>
                )}

                {contextEnrichment?.events && contextEnrichment.events.length > 0 && (
                  <div className="p-3 rounded-md border bg-muted/50">
                    <span className="font-medium text-sm">Local Events</span>
                    <div className="mt-2 space-y-1">
                      {contextEnrichment.events.map((event, i) => (
                        <div key={i} className="flex items-center justify-between text-sm">
                          <span>{event.name}</span>
                          <Badge variant={event.impact === "high" ? "destructive" : event.impact === "medium" ? "secondary" : "outline"}>
                            {event.impact} impact
                          </Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {contextEnrichment?.spikeDetection && (
                  <div className={`p-3 rounded-md border ${contextEnrichment.spikeDetection.isSpike ? 'bg-amber-50 border-amber-200 dark:bg-amber-900/20 dark:border-amber-700' : 'bg-muted/50'}`}>
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-medium text-sm">Occupancy Spike Detection</span>
                      {contextEnrichment.spikeDetection.isSpike ? (
                        <Badge variant="secondary">
                          <AlertTriangle className="h-3 w-3 mr-1" />
                          Spike Detected
                        </Badge>
                      ) : (
                        <Badge variant="outline">Normal</Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      <span>Baseline: {contextEnrichment.spikeDetection.baselineOccupancy}% | </span>
                      <span>Current: {contextEnrichment.spikeDetection.currentOccupancy}% | </span>
                      <span>Deviation: {contextEnrichment.spikeDetection.deviationPercent}%</span>
                    </div>
                    {contextEnrichment.spikeDetection.recommendation && (
                      <div className="mt-2">
                        <Badge variant={contextEnrichment.spikeDetection.recommendation === "HOLD_PCN" ? "destructive" : "outline"}>
                          {contextEnrichment.spikeDetection.recommendation.replace(/_/g, " ")}
                        </Badge>
                      </div>
                    )}
                  </div>
                )}

                {contextEnrichment?.anomalies && contextEnrichment.anomalies.length > 0 && (
                  <div className="p-3 rounded-md bg-amber-50 border border-amber-200 dark:bg-amber-900/20 dark:border-amber-700">
                    <p className="text-sm font-medium text-amber-800 dark:text-amber-400 flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4" />
                      Anomalies Detected
                    </p>
                    <ul className="text-sm text-amber-700 dark:text-amber-300 mt-1 list-disc list-inside">
                      {contextEnrichment.anomalies.map((a, i) => <li key={i}>{a}</li>)}
                    </ul>
                  </div>
                )}

                {behaviourProfiling?.driverProfile && (
                  <div className="p-3 rounded-md border bg-muted/50">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-medium text-sm flex items-center gap-2">
                        <User className="h-4 w-4" />
                        Driver Profile
                      </span>
                      <Badge variant="outline">{behaviourProfiling.driverProfile.classification.replace(/_/g, " ")}</Badge>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                      <span>Visit Count: {behaviourProfiling.driverProfile.visitCount}</span>
                      <span>Overstay Count: {behaviourProfiling.driverProfile.overstayCount}</span>
                      <span>Avg Duration: {behaviourProfiling.driverProfile.averageDurationMinutes} min</span>
                      <span>Risk Score: {(behaviourProfiling.driverProfile.riskScore * 100).toFixed(0)}%</span>
                    </div>
                  </div>
                )}

                {behaviourProfiling?.mitigatingFactors && behaviourProfiling.mitigatingFactors.length > 0 && (
                  <div className="p-3 rounded-md bg-green-50 border border-green-200 dark:bg-green-900/20 dark:border-green-700">
                    <p className="text-sm font-medium text-green-800 dark:text-green-400 flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4" />
                      Mitigating Factors
                    </p>
                    <ul className="text-sm text-green-700 dark:text-green-300 mt-1 list-disc list-inside">
                      {behaviourProfiling.mitigatingFactors.map((f, i) => <li key={i}>{f}</li>)}
                    </ul>
                  </div>
                )}

                {(!contextEnrichment && !behaviourProfiling) && (
                  <div className="p-4 text-center text-muted-foreground">
                    <Cloud className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">No context data available. Run analysis to gather context signals.</p>
                  </div>
                )}
              </div>
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      <Collapsible open={expandedSections.has("risk")} onOpenChange={() => toggleSection("risk")}>
        <Card>
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer hover-elevate">
              <CardTitle className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2">
                  <Shield className="h-4 w-4" />
                  Section 7: Risk & Confidence
                </span>
                {expandedSections.has("risk") ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </CardTitle>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="pt-0">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="font-medium">Overall Confidence</span>
                  <div className="flex items-center gap-3">
                    <ConfidenceMeter value={decision?.overallConfidence || analysis?.confidenceScore || 0} className="w-40" />
                    <span className="text-sm font-mono">
                      {Math.round((decision?.overallConfidence || analysis?.confidenceScore || 0) * 100)}%
                    </span>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-medium">Legal Risk Level</span>
                  <Badge variant={decision?.legalRisk === "high" ? "destructive" : decision?.legalRisk === "medium" ? "secondary" : "outline"}>
                    {decision?.legalRisk?.toUpperCase() || analysis?.riskAssessment || "Unknown"}
                  </Badge>
                </div>
                <Separator />
                <div>
                  <p className="font-medium mb-2">Recommendation</p>
                  <div className={`p-3 rounded-md ${isPcnEligible ? 'bg-destructive/10 border border-destructive/20' : 'bg-muted/50 border'}`}>
                    <p className="text-sm">
                      {decision?.recommendation || analysis?.recommendation || "Run analysis to generate recommendation"}
                    </p>
                  </div>
                </div>
                
                {decision?.blockers && decision.blockers.length > 0 && (
                  <div className="p-3 rounded-md bg-amber-50 border border-amber-200 dark:bg-amber-900/20 dark:border-amber-700">
                    <p className="text-sm font-medium text-amber-800 dark:text-amber-400 flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4" />
                      PCN Blockers
                    </p>
                    <ul className="text-sm text-amber-700 dark:text-amber-300 mt-1 list-disc list-inside">
                      {decision.blockers.map((b: string, i: number) => <li key={i}>{b}</li>)}
                    </ul>
                  </div>
                )}

                <div className="p-4 rounded-md border">
                  <p className="text-sm font-medium mb-3">PCN Eligibility Gates</p>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span>Analysis Complete</span>
                      {pipelineResults?.pipelineStatus === "completed" ? (
                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                      ) : (
                        <XCircle className="h-4 w-4 text-red-500" />
                      )}
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span>Regulation Breach Confirmed</span>
                      {decision?.status === "PCN_ELIGIBLE" ? (
                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                      ) : (
                        <XCircle className="h-4 w-4 text-red-500" />
                      )}
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span>Signage Compliant</span>
                      {signage?.overallCompliance === "PASS" ? (
                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                      ) : (
                        <XCircle className="h-4 w-4 text-red-500" />
                      )}
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span>Confidence ≥ 70%</span>
                      {(decision?.overallConfidence || 0) >= 0.7 ? (
                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                      ) : (
                        <XCircle className="h-4 w-4 text-red-500" />
                      )}
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span>No Hold Flags</span>
                      {!decision?.blockers?.length ? (
                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                      ) : (
                        <XCircle className="h-4 w-4 text-red-500" />
                      )}
                    </div>
                  </div>
                </div>

                {isPcnEligible && (
                  <Button 
                    className="w-full"
                    variant="destructive"
                    onClick={() => issuePcnMutation.mutate()}
                    disabled={issuePcnMutation.isPending}
                    data-testid="button-issue-pcn"
                  >
                    {issuePcnMutation.isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Issuing PCN...
                      </>
                    ) : (
                      <>
                        <FileCheck className="h-4 w-4 mr-2" />
                        Issue Penalty Charge Notice
                      </>
                    )}
                  </Button>
                )}
              </div>
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      <Collapsible open={expandedSections.has("explanation")} onOpenChange={() => toggleSection("explanation")}>
        <Card>
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer hover-elevate">
              <CardTitle className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2">
                  <MessageSquare className="h-4 w-4" />
                  Section 8: Plain-English Explanation
                </span>
                {expandedSections.has("explanation") ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </CardTitle>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="pt-0">
              <div className="space-y-4">
                <div className="p-4 rounded-md bg-muted/50 border">
                  <p className="text-sm leading-relaxed">
                    {decision?.plainEnglishExplanation || 
                     analysis?.summary || 
                     "This case is pending analysis. Run the analysis pipeline to generate a plain-English explanation of the decision."}
                  </p>
                </div>
                
                {decision?.reasoning && (
                  <div className="p-3 rounded-md border">
                    <p className="text-xs font-medium text-muted-foreground mb-2">Technical Reasoning</p>
                    <p className="text-sm">{decision.reasoning}</p>
                  </div>
                )}
                
                <div className="p-3 rounded-md bg-blue-50 border border-blue-200 dark:bg-blue-900/20 dark:border-blue-700">
                  <p className="text-sm font-medium text-blue-800 dark:text-blue-400 flex items-center gap-2">
                    <Info className="h-4 w-4" />
                    Appeals & Court Use
                  </p>
                  <p className="text-xs text-blue-700 dark:text-blue-300 mt-1">
                    This explanation is designed for use in appeal responses and court proceedings. 
                    It summarizes the evidence, regulations applied, and the basis for the decision in plain language.
                  </p>
                </div>
              </div>
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      <Collapsible open={expandedSections.has("audit")} onOpenChange={() => toggleSection("audit")}>
        <Card>
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer hover-elevate">
              <CardTitle className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2">
                  <History className="h-4 w-4" />
                  Full Audit Log
                </span>
                {expandedSections.has("audit") ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </CardTitle>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="pt-0">
              <ScrollArea className="h-[200px]">
                <div className="space-y-2">
                  {pipelineSteps.length > 0 ? (
                    pipelineSteps.map((step) => (
                      <div key={step.id} className="p-2 rounded-md bg-muted/50 text-sm">
                        <div className="flex items-center justify-between">
                          <span className="font-medium">{step.stepName}</span>
                          <Badge variant={step.status === "completed" ? "outline" : step.status === "failed" ? "destructive" : "secondary"} className="text-xs">
                            {step.status}
                          </Badge>
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">
                          {step.startedAt && `Started: ${new Date(step.startedAt).toLocaleString()}`}
                          {step.completedAt && ` | Completed: ${new Date(step.completedAt).toLocaleString()}`}
                        </div>
                        {step.errors && step.errors.length > 0 && (
                          <p className="text-xs text-destructive mt-1">{step.errors.join(", ")}</p>
                        )}
                      </div>
                    ))
                  ) : (
                    <div className="space-y-2">
                      <div className="p-2 rounded-md bg-muted/50 text-sm">
                        <div className="flex items-center justify-between">
                          <span>Evidence Files Processed</span>
                          <span className="text-muted-foreground">{evidenceFiles.length} files</span>
                        </div>
                      </div>
                      <div className="p-2 rounded-md bg-muted/50 text-sm">
                        <div className="flex items-center justify-between">
                          <span>Analysis Method</span>
                          <span className="text-muted-foreground">Automated Vision + Object Detection</span>
                        </div>
                      </div>
                      {vehicles.length > 0 && vehicles[0].verifiedAt && (
                        <div className="p-2 rounded-md bg-muted/50 text-sm">
                          <div className="flex items-center justify-between">
                            <span>DVLA Verification</span>
                            <span className="text-muted-foreground">
                              {new Date(vehicles[0].verifiedAt).toLocaleString()}
                            </span>
                          </div>
                        </div>
                      )}
                      {analysis?.generatedAt && (
                        <div className="p-2 rounded-md bg-muted/50 text-sm">
                          <div className="flex items-center justify-between">
                            <span>Analysis Generated</span>
                            <span className="text-muted-foreground">
                              {new Date(analysis.generatedAt).toLocaleString()}
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>
    </div>
  );
}
