import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  FileText,
  Scale,
  Clock,
  Loader2,
  Car,
  MapPin,
  Shield,
  HelpCircle,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { CaseAnalysis, CaseVehicle, Evidence, BayType } from "@shared/schema";

interface EvidenceAnalysisReportProps {
  bundleId: string;
  caseReference: string;
  analysis: CaseAnalysis | null;
  vehicles: CaseVehicle[];
  evidenceFiles: Evidence[];
  siteName: string;
  siteId: number | null;
  bayType: BayType | null;
  vrm: string | null;
  timeWindow: { start: string; end: string } | null;
  onPcnIssued?: () => void;
}

// Helper to format bay type for display
function formatBayTypeLabel(bayType: string | null | undefined): string {
  if (!bayType) return "Unknown";
  const labels: Record<string, string> = {
    "general_parking": "General Parking",
    "disabled_bay": "Disabled Bay",
    "ev_bay": "Electric Vehicle Bay",
    "loading_bay": "Loading Bay",
    "permit_holders": "Permit Holders Only",
    "no_parking": "No Parking / Restricted",
    "drop_off_pickup": "Drop-off / Pick-up",
    "staff_parking": "Staff Parking",
    "standard": "Standard",
  };
  return labels[bayType] || bayType.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase());
}

interface PipelineResults {
  caseId: string;
  pipelineStatus: "pending" | "running" | "completed" | "failed";
  evidenceTimeline: {
    durationMinutes?: number;
    timeRange?: { 
      first: string; 
      last: string; 
      durationMinutes?: number;
      timestampQuality?: string;
      validationIssue?: string | null;
      timeSource?: string;
    };
    timestamps?: Array<{ 
      evidenceId: number; 
      timestamp: string; 
      source?: "ocr" | "exif" | "camera_overlay" | "filename" | "upload_time"; 
      confidence?: number;
      rawOcrText?: string;
    }>;
  } | null;
  regulationEvaluation: {
    durationMinutes?: number;
    maxStayAllowed?: number;
    siteName?: string;
    rules?: {
      maxStayMinutes?: number;
      gracePeriodMinutes?: number;
    };
    evaluation?: {
      complianceResult?: string;
      actualDurationMinutes?: number;
      allowedDurationMinutes?: number;
      effectiveDurationMinutes?: number;
      breachExplanation?: string;
      ruleSource?: string;
    };
  } | null;
  signageCompliance: {
    overallCompliance?: string;
    overallConfidence?: number;
    extractedRegulations?: {
      maxStayMinutes?: number;
      graceMinutes?: number;
      source?: string;
    };
    appliedSignageTitle?: string;
  } | null;
  bayRuleEvaluation: {
    bayType?: string;
    bayName?: string;
    decision?: string;
    explanation?: string;
  } | null;
  decision: {
    status: "PCN_ELIGIBLE" | "REVIEW_REQUIRED" | "NO_PCN" | "BLOCKED_BY_BAY_RULE";
    overallConfidence: number;
    legalRisk: "low" | "medium" | "high";
    recommendation: string;
    reasoning: string;
    plainEnglishExplanation: string;
    blockers: string[];
  } | null;
  analysisCompletedAt: string | null;
}

// Helper function to format time from ISO string
function formatTime(isoString: string | undefined): string {
  if (!isoString) return "—";
  try {
    const date = new Date(isoString);
    const time = date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    const day = date.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });
    return `${time} ${day}`;
  } catch {
    return "—";
  }
}

// Helper function to format duration
function formatDuration(minutes: number | undefined | null): string {
  if (minutes == null || isNaN(minutes)) return "—";
  if (minutes === 0) return "0 minutes";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0 && m > 0) return `${h} hour${h > 1 ? "s" : ""} ${m} minute${m > 1 ? "s" : ""}`;
  if (h > 0) return `${h} hour${h > 1 ? "s" : ""}`;
  return `${m} minute${m > 1 ? "s" : ""}`;
}

// Map internal status to PCN-safe decision
function mapDecision(status: string | undefined): "ISSUE_PCN" | "DO_NOT_ISSUE" | "REVIEW_REQUIRED" {
  switch (status) {
    case "PCN_ELIGIBLE":
      return "ISSUE_PCN";
    case "NO_PCN":
    case "BLOCKED_BY_BAY_RULE":
      return "DO_NOT_ISSUE";
    default:
      return "REVIEW_REQUIRED";
  }
}

// Map confidence to level
function getConfidenceLevel(confidence: number | undefined): "HIGH" | "MEDIUM" | "LOW" {
  if (confidence == null) return "LOW";
  if (confidence >= 0.7) return "HIGH";
  if (confidence >= 0.4) return "MEDIUM";
  return "LOW";
}

export function EvidenceAnalysisReport({
  bundleId,
  caseReference,
  analysis,
  vehicles,
  evidenceFiles,
  siteName,
  siteId,
  bayType,
  vrm,
  timeWindow,
  onPcnIssued,
}: EvidenceAnalysisReportProps) {
  const { toast } = useToast();

  const { data: pipelineResults, isLoading: loadingPipeline } = useQuery<PipelineResults>({
    queryKey: [`/api/cases/${bundleId}/pipeline/results`],
    enabled: !!bundleId,
  });

  const runPipelineMutation = useMutation({
    mutationFn: async () => {
      // Step 1: Run Vision/OCR reanalysis on all evidence items
      await apiRequest("POST", `/api/cases/${bundleId}/reanalyze-evidence`);
      // Step 2: Run the case analysis pipeline with updated OCR timestamps
      return apiRequest("POST", `/api/cases/${bundleId}/pipeline/run`);
    },
    onSuccess: () => {
      toast({ title: "Analysis complete", description: "Evidence reanalyzed with OCR and pipeline processed" });
      queryClient.invalidateQueries({ queryKey: [`/api/cases/${bundleId}/pipeline/results`] });
      queryClient.invalidateQueries({ queryKey: ["/api/evidence/bundles"] });
      queryClient.invalidateQueries({ queryKey: [`/api/cases/${bundleId}/evidence`] });
    },
    onError: (error: Error) => {
      toast({ title: "Analysis failed", description: error.message, variant: "destructive" });
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

  // Extract PCN-safe data from pipeline results
  const decision = pipelineResults?.decision;
  const regulations = pipelineResults?.regulationEvaluation;
  const signage = pipelineResults?.signageCompliance;
  const evidence = pipelineResults?.evidenceTimeline;
  const bayRule = pipelineResults?.bayRuleEvaluation;

  const pcnDecision = mapDecision(decision?.status);
  const confidenceLevel = getConfidenceLevel(decision?.overallConfidence);
  
  // Determine compliance status
  const isCompliant = decision?.status === "NO_PCN" || decision?.status === "BLOCKED_BY_BAY_RULE";
  const complianceStatus = isCompliant ? "COMPLIANT" : 
    decision?.status === "PCN_ELIGIBLE" ? "NON_COMPLIANT" : "UNKNOWN";

  // Get rule source
  const ruleSource = signage?.appliedSignageTitle ? "SITE_SIGNAGE" : 
    regulations?.evaluation?.ruleSource === "site_policy" ? "SITE_REGULATION" : "SITE_REGULATION";

  // Get applied rule name - fail-safe to generic when data is missing
  const getRuleName = (): string => {
    // If no decision or regulations data, return neutral message
    if (!decision?.status || decision.status === "REVIEW_REQUIRED") {
      return "Pending review";
    }
    if (regulations?.evaluation?.complianceResult === "OVERSTAY") {
      const maxStay = regulations?.rules?.maxStayMinutes || signage?.extractedRegulations?.maxStayMinutes;
      return maxStay ? `Maximum stay exceeded (${formatDuration(maxStay)})` : "Maximum stay exceeded";
    }
    if (bayRule?.bayType && bayRule.bayType !== "standard") {
      return `${bayRule.bayType.replace("_", " ").toUpperCase()} bay restriction`;
    }
    return "Site parking regulations";
  };

  // Build explanation - fail-safe to neutral language when data is missing
  const getExplanation = (): string => {
    // If no decision data exists, default to neutral review message
    if (!decision?.status) {
      return "Manual review required due to incomplete evidence.";
    }
    if (decision?.plainEnglishExplanation) {
      return decision.plainEnglishExplanation;
    }
    if (decision.status === "REVIEW_REQUIRED") {
      return "Insufficient evidence to make a definitive determination. Manual review required.";
    }
    if (decision.status === "NO_PCN" || decision.status === "BLOCKED_BY_BAY_RULE") {
      return "Vehicle was parked within permitted time limits as defined by site regulations.";
    }
    if (decision.status === "PCN_ELIGIBLE" && regulations?.evaluation?.breachExplanation) {
      return regulations.evaluation.breachExplanation;
    }
    if (decision.status === "PCN_ELIGIBLE") {
      return "Vehicle remained on site beyond the permitted stay as defined by site regulations.";
    }
    return "Manual review required due to incomplete evidence.";
  };

  // Get confidence reason
  const getConfidenceReason = (): string => {
    if (decision?.blockers && decision.blockers.length > 0) {
      return decision.blockers[0];
    }
    if (confidenceLevel === "HIGH") {
      return "Clear observation timestamps and active regulation.";
    }
    if (confidenceLevel === "MEDIUM") {
      return "Some evidence gaps but sufficient for determination.";
    }
    return "Incomplete evidence requires manual verification.";
  };

  // Observation times (from evidence timestamps)
  // Backend returns first/last, frontend maps to observeFrom/observeTo
  const observeFrom = timeWindow?.start || evidence?.timeRange?.first;
  const observeTo = timeWindow?.end || evidence?.timeRange?.last;
  const durationMinutes = regulations?.evaluation?.actualDurationMinutes || 
    regulations?.durationMinutes || evidence?.timeRange?.durationMinutes || evidence?.durationMinutes;
  
  // Time source for transparency - now displays OCR source from backend
  const getTimeSource = (): { label: string; quality: string } => {
    // Use backend-provided timeSource if available
    const backendTimeSource = evidence?.timeRange?.timeSource;
    if (backendTimeSource) {
      return { 
        label: backendTimeSource, 
        quality: evidence?.timeRange?.timestampQuality || "medium" 
      };
    }
    
    // Fallback: determine from timestamps
    const timestamps = evidence?.timestamps || [];
    if (timestamps.length === 0) return { label: "No Data", quality: "invalid" };
    
    const sources = timestamps.map((t: any) => t.source);
    const hasOcr = sources.includes("ocr");
    
    if (hasOcr) return { label: "Evidence Image Timestamp (OCR)", quality: "high" };
    return { label: "No OCR timestamps found", quality: "invalid" };
  };
  
  const timeSource = getTimeSource();
  const timestampQuality = evidence?.timeRange?.timestampQuality;
  const validationIssue = evidence?.timeRange?.validationIssue;

  // No analysis available state
  if (!analysis && !pipelineResults) {
    return (
      <Card data-testid="card-no-analysis">
        <CardContent className="p-6 text-center">
          <Scale className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
          <h3 className="font-medium mb-2">No Analysis Available</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Run the analysis to determine PCN eligibility
          </p>
          <Button 
            onClick={() => runPipelineMutation.mutate()}
            disabled={runPipelineMutation.isPending}
            data-testid="button-run-analysis"
          >
            {runPipelineMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Analysing...
              </>
            ) : (
              <>
                <Scale className="h-4 w-4 mr-2" />
                Analyse Case
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4" data-testid="analysis-report">
      {/* Header with Re-analyse button */}
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-lg flex items-center gap-2">
          <Scale className="h-5 w-5" />
          Enforcement Assessment
        </h3>
        <Button 
          variant="outline"
          size="sm"
          onClick={() => runPipelineMutation.mutate()}
          disabled={runPipelineMutation.isPending}
          data-testid="button-reanalyse"
        >
          {runPipelineMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            "Re-analyse"
          )}
        </Button>
      </div>

      {/* 1. Final PCN Decision - Most prominent */}
      <Card className={`border-2 ${
        pcnDecision === "ISSUE_PCN" ? "border-destructive bg-destructive/5" :
        pcnDecision === "DO_NOT_ISSUE" ? "border-green-500 bg-green-50 dark:bg-green-900/20" :
        "border-amber-500 bg-amber-50 dark:bg-amber-900/20"
      }`} data-testid="card-decision">
        <CardContent className="p-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              {pcnDecision === "ISSUE_PCN" ? (
                <div className="p-2 rounded-full bg-destructive/10">
                  <XCircle className="h-8 w-8 text-destructive" />
                </div>
              ) : pcnDecision === "DO_NOT_ISSUE" ? (
                <div className="p-2 rounded-full bg-green-100 dark:bg-green-900/30">
                  <CheckCircle2 className="h-8 w-8 text-green-600" />
                </div>
              ) : (
                <div className="p-2 rounded-full bg-amber-100 dark:bg-amber-900/30">
                  <AlertTriangle className="h-8 w-8 text-amber-600" />
                </div>
              )}
              <div>
                <p className="text-sm text-muted-foreground">Decision</p>
                <p className="text-xl font-bold" data-testid="text-decision">
                  {pcnDecision === "ISSUE_PCN" ? "ISSUE PCN" :
                   pcnDecision === "DO_NOT_ISSUE" ? "DO NOT ISSUE" : "REVIEW REQUIRED"}
                </p>
              </div>
            </div>
            
            {pcnDecision === "ISSUE_PCN" && (
              <Button 
                variant="destructive"
                onClick={() => issuePcnMutation.mutate()}
                disabled={issuePcnMutation.isPending}
                data-testid="button-issue-pcn"
              >
                {issuePcnMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <FileText className="h-4 w-4 mr-2" />
                )}
                Issue PCN
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* 2. Key Rule Applied */}
      <Card data-testid="card-rule">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Scale className="h-4 w-4" />
            Rule Applied
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="font-medium text-base" data-testid="text-rule-name">{getRuleName()}</p>
          <p className="text-sm text-muted-foreground mt-1">
            Source: {ruleSource === "SITE_SIGNAGE" ? (
              <span className="inline-flex items-center gap-1">
                <FileText className="h-3 w-3" />
                Parking Site Signage
                {signage?.appliedSignageTitle && <span className="text-xs">({signage.appliedSignageTitle})</span>}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1">
                <MapPin className="h-3 w-3" />
                Parking Site Regulation
              </span>
            )}
          </p>
        </CardContent>
      </Card>

      {/* 3. Key Evidence Used */}
      <Card data-testid="card-evidence">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Evidence Summary
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-muted-foreground">Observe From</p>
              <p className="font-medium font-mono" data-testid="text-observe-from">
                {observeFrom ? formatTime(observeFrom) : "—"}
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Observe To</p>
              <p className="font-medium font-mono" data-testid="text-observe-to">
                {observeTo ? formatTime(observeTo) : "—"}
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Duration</p>
              <p className="font-medium" data-testid="text-duration">
                {formatDuration(durationMinutes)}
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Bay Type</p>
              <p className="font-medium" data-testid="text-bay-type">
                {formatBayTypeLabel(bayType || bayRule?.bayType)}
              </p>
            </div>
            {vrm && (
              <div className="col-span-2">
                <p className="text-sm text-muted-foreground">Vehicle</p>
                <p className="font-medium font-mono" data-testid="text-vrm">{vrm}</p>
              </div>
            )}
          </div>
          
          {/* Time Source Transparency */}
          <div className="pt-2 border-t">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Time Source:</span>
              <span className={`font-medium ${
                timeSource.quality === "high" ? "text-green-600 dark:text-green-400" :
                timeSource.quality === "medium" ? "text-amber-600 dark:text-amber-400" :
                "text-red-600 dark:text-red-400"
              }`}>
                {timeSource.label}
              </span>
            </div>
            {validationIssue && (
              <div className="mt-2 p-2 bg-amber-50 dark:bg-amber-900/20 rounded text-xs text-amber-700 dark:text-amber-300 flex items-start gap-2">
                <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                {validationIssue}
              </div>
            )}
            {!validationIssue && timestampQuality && timestampQuality !== "high" && (
              <div className="mt-2 p-2 bg-amber-50 dark:bg-amber-900/20 rounded text-xs text-amber-700 dark:text-amber-300 flex items-start gap-2">
                <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                Insufficient timestamp data for duration accuracy
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* 4. Compliance Result */}
      <Card data-testid="card-compliance">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Shield className="h-4 w-4" />
            Result
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3 mb-3">
            {complianceStatus === "COMPLIANT" ? (
              <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-400">
                <CheckCircle2 className="h-3 w-3 mr-1" />
                Compliant
              </Badge>
            ) : complianceStatus === "NON_COMPLIANT" ? (
              <Badge variant="destructive">
                <XCircle className="h-3 w-3 mr-1" />
                Non-Compliant
              </Badge>
            ) : (
              <Badge variant="secondary">
                <HelpCircle className="h-3 w-3 mr-1" />
                Unknown
              </Badge>
            )}
          </div>
          <p className="text-sm" data-testid="text-explanation">{getExplanation()}</p>
        </CardContent>
      </Card>

      {/* 5. Confidence Level */}
      <Card data-testid="card-confidence">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Car className="h-4 w-4" />
            Confidence
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3 mb-2">
            <Badge variant={
              confidenceLevel === "HIGH" ? "default" :
              confidenceLevel === "MEDIUM" ? "secondary" : "outline"
            } data-testid="badge-confidence">
              {confidenceLevel}
            </Badge>
            <span className="text-sm text-muted-foreground">
              {decision?.overallConfidence != null ? `${Math.round(decision.overallConfidence * 100)}%` : "—"}
            </span>
          </div>
          <p className="text-sm text-muted-foreground" data-testid="text-confidence-reason">
            {getConfidenceReason()}
          </p>
        </CardContent>
      </Card>

      {/* Site Info - minimal footer */}
      <div className="text-xs text-muted-foreground flex items-center justify-between pt-2 border-t">
        <span data-testid="text-site-name">{siteName}</span>
        <span data-testid="text-case-ref">Case: {caseReference.substring(0, 8)}</span>
      </div>
    </div>
  );
}
