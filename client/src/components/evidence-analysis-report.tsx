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
  AlertCircle,
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

interface EvidenceSummary {
  observeFrom: string | null;
  observeTo: string | null;
  durationMinutes: number | null;
  durationConfidence: "HIGH" | "MEDIUM" | "LOW";
  timeSource: "OCR" | "CAMERA_META" | "MANUAL" | "UNKNOWN";
  evidenceCount: number;
  timestampConsistency: "CONSISTENT" | "PARTIAL" | "CONFLICT";
  validationWarnings: string[];
  isValidForPcn: boolean;
  pcnBlockReason: string | null;
}

interface ExtractedVrm {
  vrm: string;
  confidence: number;
  allDetections?: Array<{
    vrm: string;
    confidence: number;
    evidenceId: number;
    location?: string;
    rawText?: string;
  }>;
}

interface PipelineResults {
  caseId: string;
  pipelineStatus: "pending" | "running" | "completed" | "failed";
  evidenceTimeline: {
    durationMinutes?: number;
    evidenceSummary?: EvidenceSummary;
    timeRange?: { 
      first: string | null; 
      last: string | null; 
      durationMinutes?: number;
      timestampQuality?: string;
      validationIssue?: string | null;
      timeSource?: string;
    };
    timestamps?: Array<{ 
      evidenceId: number; 
      timestamp: string; 
      source?: string; 
      confidence?: number;
    }>;
    extractedVrm?: ExtractedVrm | null;
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

function formatTimeFromBackend(isoString: string | null | undefined): string {
  if (!isoString) return "—";
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return "—";
    const time = date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    const day = date.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });
    return `${time} ${day}`;
  } catch {
    return "—";
  }
}

function formatDurationFromBackend(minutes: number | null | undefined): string {
  if (minutes == null || isNaN(minutes)) return "—";
  if (minutes === 0) return "0 minutes";
  if (minutes < 0) return "Invalid";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0 && m > 0) return `${h} hour${h > 1 ? "s" : ""} ${m} minute${m > 1 ? "s" : ""}`;
  if (h > 0) return `${h} hour${h > 1 ? "s" : ""}`;
  return `${m} minute${m > 1 ? "s" : ""}`;
}

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

function getConfidenceBadgeVariant(confidence: "HIGH" | "MEDIUM" | "LOW"): "default" | "secondary" | "outline" {
  switch (confidence) {
    case "HIGH": return "default";
    case "MEDIUM": return "secondary";
    default: return "outline";
  }
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
      await apiRequest("POST", `/api/cases/${bundleId}/reanalyze-evidence`);
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

  const decision = pipelineResults?.decision;
  const regulations = pipelineResults?.regulationEvaluation;
  const signage = pipelineResults?.signageCompliance;
  const evidenceData = pipelineResults?.evidenceTimeline;
  const bayRule = pipelineResults?.bayRuleEvaluation;
  
  const evidenceSummary = evidenceData?.evidenceSummary;
  const extractedVrm = evidenceData?.extractedVrm;

  const pcnDecision = mapDecision(decision?.status);
  
  const isCompliant = decision?.status === "NO_PCN" || decision?.status === "BLOCKED_BY_BAY_RULE";
  const complianceStatus = isCompliant ? "COMPLIANT" : 
    decision?.status === "PCN_ELIGIBLE" ? "NON_COMPLIANT" : "UNKNOWN";

  const ruleSource = signage?.appliedSignageTitle ? "SITE_SIGNAGE" : "SITE_REGULATION";

  const getRuleName = (): string => {
    if (!decision?.status || decision.status === "REVIEW_REQUIRED") {
      return "Pending review";
    }
    if (regulations?.evaluation?.complianceResult === "OVERSTAY" || regulations?.evaluation?.complianceResult === "BREACH") {
      const maxStay = regulations?.rules?.maxStayMinutes || signage?.extractedRegulations?.maxStayMinutes;
      return maxStay ? `Maximum stay exceeded (${formatDurationFromBackend(maxStay)})` : "Maximum stay exceeded";
    }
    if (bayRule?.bayType && bayRule.bayType !== "standard" && bayRule.bayType !== "general_parking") {
      return `${bayRule.bayType.replace("_", " ").toUpperCase()} bay restriction`;
    }
    return "Site parking regulations";
  };

  const getExplanation = (): string => {
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
    return "Manual review required due to incomplete evidence.";
  };

  const getConfidenceReason = (): string => {
    if (decision?.blockers && decision.blockers.length > 0) {
      return decision.blockers[0];
    }
    if (evidenceSummary?.durationConfidence === "HIGH") {
      return "Clear observation timestamps and active regulation.";
    }
    if (evidenceSummary?.durationConfidence === "MEDIUM") {
      return "Some evidence gaps but sufficient for determination.";
    }
    return "Incomplete evidence requires manual verification.";
  };

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
            
            {pcnDecision === "ISSUE_PCN" && evidenceSummary?.isValidForPcn && (
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
            
            {pcnDecision === "ISSUE_PCN" && !evidenceSummary?.isValidForPcn && (
              <Badge variant="outline" className="text-amber-600 border-amber-400">
                <AlertCircle className="h-3 w-3 mr-1" />
                PCN Blocked
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>

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

      <Card data-testid="card-evidence-summary">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Evidence Summary
            {evidenceSummary && (
              <Badge 
                variant={getConfidenceBadgeVariant(evidenceSummary.durationConfidence)}
                className="ml-2"
              >
                {evidenceSummary.durationConfidence} Confidence
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-muted-foreground">Observe From</p>
              <p className="font-medium font-mono" data-testid="text-observe-from">
                {evidenceSummary?.observeFrom 
                  ? formatTimeFromBackend(evidenceSummary.observeFrom)
                  : "—"}
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Observe To</p>
              <p className="font-medium font-mono" data-testid="text-observe-to">
                {evidenceSummary?.observeTo 
                  ? formatTimeFromBackend(evidenceSummary.observeTo)
                  : "—"}
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Duration</p>
              <p className="font-medium" data-testid="text-duration">
                {formatDurationFromBackend(evidenceSummary?.durationMinutes)}
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Bay Type</p>
              <p className="font-medium" data-testid="text-bay-type">
                {formatBayTypeLabel(bayType || bayRule?.bayType)}
              </p>
            </div>
            {(vrm || extractedVrm?.vrm) && (
              <div className="col-span-2">
                <p className="text-sm text-muted-foreground">Vehicle Registration</p>
                <div className="flex items-center gap-2">
                  <p className="font-medium font-mono text-lg" data-testid="text-vrm">
                    {extractedVrm?.vrm || vrm}
                  </p>
                  {extractedVrm && (
                    <Badge 
                      variant={extractedVrm.confidence >= 80 ? "default" : 
                              extractedVrm.confidence >= 50 ? "secondary" : "outline"}
                      className="text-xs"
                    >
                      {extractedVrm.confidence}% confidence
                    </Badge>
                  )}
                </div>
                {extractedVrm?.vrm && vrm && extractedVrm.vrm !== vrm && (
                  <p className="text-xs text-muted-foreground mt-1">
                    (Previously recorded: {vrm})
                  </p>
                )}
              </div>
            )}
          </div>
          
          <div className="pt-2 border-t space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Time Source:</span>
              <span className={`font-medium ${
                evidenceSummary?.timeSource === "OCR" ? "text-green-600 dark:text-green-400" :
                evidenceSummary?.timeSource === "CAMERA_META" ? "text-blue-600 dark:text-blue-400" :
                "text-amber-600 dark:text-amber-400"
              }`}>
                {evidenceSummary?.timeSource || "Unknown"}
              </span>
            </div>
            
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Timestamp Consistency:</span>
              <Badge 
                variant={evidenceSummary?.timestampConsistency === "CONSISTENT" ? "default" : 
                        evidenceSummary?.timestampConsistency === "PARTIAL" ? "secondary" : "destructive"}
                className="text-xs"
              >
                {evidenceSummary?.timestampConsistency || "Unknown"}
              </Badge>
            </div>
            
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Evidence Count:</span>
              <span className="font-medium">{evidenceSummary?.evidenceCount || 0} items</span>
            </div>
            
            {!evidenceSummary?.isValidForPcn && evidenceSummary?.pcnBlockReason && (
              <div className="mt-2 p-2 bg-amber-50 dark:bg-amber-900/20 rounded text-xs text-amber-700 dark:text-amber-300 flex items-start gap-2">
                <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                <span><strong>PCN Blocked:</strong> {evidenceSummary.pcnBlockReason}</span>
              </div>
            )}
            
            {evidenceSummary?.validationWarnings && evidenceSummary.validationWarnings.length > 0 && (
              <div className="mt-2 p-2 bg-amber-50 dark:bg-amber-900/20 rounded text-xs text-amber-700 dark:text-amber-300">
                <div className="flex items-center gap-1 mb-1 font-medium">
                  <AlertTriangle className="h-3 w-3" />
                  Validation Warnings
                </div>
                <ul className="list-disc list-inside space-y-0.5">
                  {evidenceSummary.validationWarnings.map((warning, idx) => (
                    <li key={idx}>{warning}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

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

      <Card data-testid="card-confidence">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Car className="h-4 w-4" />
            Confidence
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3 mb-2">
            <Badge 
              variant={getConfidenceBadgeVariant(evidenceSummary?.durationConfidence || "LOW")} 
              data-testid="badge-confidence"
            >
              {evidenceSummary?.durationConfidence || "LOW"}
            </Badge>
            <span className="text-sm text-muted-foreground">
              {decision?.overallConfidence != null ? `${Math.round(decision.overallConfidence)}%` : "—"}
            </span>
          </div>
          <p className="text-sm text-muted-foreground" data-testid="text-confidence-reason">
            {getConfidenceReason()}
          </p>
        </CardContent>
      </Card>

      <div className="text-xs text-muted-foreground flex items-center justify-between pt-2 border-t">
        <span data-testid="text-site-name">{siteName}</span>
        <span data-testid="text-case-ref">Case: {caseReference.substring(0, 8)}</span>
      </div>
    </div>
  );
}
