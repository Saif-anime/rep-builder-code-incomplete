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
  status: "pending" | "running" | "completed" | "failed";
  evidenceNormalization: any;
  visionAnalysis: any;
  dvlaEnrichment: any;
  regulationEvaluation: any;
  signageCompliance: any;
  decisionEngine: any;
  completedAt: string | null;
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
    new Set(["summary", "evidence", "measurements", "regulations", "signage", "risk", "audit"])
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

  const decision = pipelineResults?.decisionEngine;
  const regulations = pipelineResults?.regulationEvaluation;
  const signage = pipelineResults?.signageCompliance;
  const vision = pipelineResults?.visionAnalysis;
  const dvla = pipelineResults?.dvlaEnrichment;
  const evidence = pipelineResults?.evidenceNormalization;

  const isPcnEligible = 
    decision?.status === "PCN_ELIGIBLE" &&
    signage?.overallCompliance === "PASS" &&
    (decision?.confidenceScore || 0) >= 0.7 &&
    !decision?.blockers?.length;

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
      <div className="flex items-center justify-between">
        <h3 className="font-semibold flex items-center gap-2">
          <Brain className="h-5 w-5" />
          Full Analysis Report
        </h3>
        <div className="flex items-center gap-2">
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

      <div className="flex items-center gap-2 flex-wrap">
        {decision?.status && getDecisionBadge(decision.status)}
        {decision?.confidenceScore && (
          <Badge variant="outline">
            Confidence: {Math.round(decision.confidenceScore * 100)}%
          </Badge>
        )}
        {decision?.riskLevel && (
          <Badge variant={decision.riskLevel === "HIGH" ? "destructive" : decision.riskLevel === "MEDIUM" ? "secondary" : "outline"}>
            Risk: {decision.riskLevel}
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
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Site:</span>{" "}
                  <span className="font-medium">{siteName}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Case Ref:</span>{" "}
                  <span className="font-mono">{caseReference.substring(0, 12)}</span>
                </div>
                <div>
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
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">Evidence Count:</span>{" "}
                    <span className="font-medium">{evidenceFiles.length} files</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Sources:</span>{" "}
                    <span className="flex items-center gap-1">
                      <Camera className="h-3 w-3" />
                      {evidence?.sources?.camera || 0} camera,{" "}
                      {evidence?.sources?.manual || evidenceFiles.length} manual
                    </span>
                  </div>
                  {evidence?.timeRange && (
                    <div className="col-span-2">
                      <span className="text-muted-foreground">Time Range:</span>{" "}
                      <span>{evidence.timeRange.start} - {evidence.timeRange.end}</span>
                    </div>
                  )}
                </div>
                <Separator />
                <div>
                  <p className="text-sm font-medium mb-2">AI Models Used:</p>
                  <div className="flex gap-2 flex-wrap">
                    <Badge variant="outline">GPT-4.1 (Violation Analysis)</Badge>
                    <Badge variant="outline">GPT-4o Vision (Image Detection)</Badge>
                    {dvla?.verified && <Badge variant="outline">DVLA API (Vehicle Data)</Badge>}
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
                      <div className="flex items-center justify-between">
                        <span className="text-sm">Plate OCR</span>
                        <ConfidenceMeter value={vision.plateConfidence * 100} className="w-32" />
                      </div>
                    )}
                    {vision?.vehicleConfidence && (
                      <div className="flex items-center justify-between">
                        <span className="text-sm">Vehicle Detection</span>
                        <ConfidenceMeter value={vision.vehicleConfidence * 100} className="w-32" />
                      </div>
                    )}
                    {vision?.bayConfidence && (
                      <div className="flex items-center justify-between">
                        <span className="text-sm">Bay Analysis</span>
                        <ConfidenceMeter value={vision.bayConfidence * 100} className="w-32" />
                      </div>
                    )}
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">Overall Confidence</span>
                      <ConfidenceMeter value={(decision?.confidenceScore || analysis?.confidenceScore || 0) * 100} className="w-32" />
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
              <div className="space-y-4">
                {regulations?.rules?.map((rule: any, idx: number) => (
                  <div key={idx} className={`p-3 rounded-md border ${rule.breached ? 'bg-destructive/10 border-destructive/20' : 'bg-muted/50'}`}>
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-medium text-sm">{rule.name}</span>
                      {rule.breached ? (
                        <Badge variant="destructive"><XCircle className="h-3 w-3 mr-1" />Breached</Badge>
                      ) : (
                        <Badge variant="outline" className="bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400">
                          <CheckCircle2 className="h-3 w-3 mr-1" />Compliant
                        </Badge>
                      )}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {rule.description}
                    </div>
                    {rule.values && (
                      <div className="text-xs text-muted-foreground mt-1">
                        Actual: {rule.values.actual} | Limit: {rule.values.limit}
                      </div>
                    )}
                  </div>
                )) || (
                  <div className="space-y-3">
                    <div className={`p-3 rounded-md border ${regulations?.maxStayBreached ? 'bg-destructive/10 border-destructive/20' : 'bg-muted/50'}`}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-medium text-sm">Maximum Stay</span>
                        {regulations?.maxStayBreached ? (
                          <Badge variant="destructive"><XCircle className="h-3 w-3 mr-1" />Breached</Badge>
                        ) : (
                          <Badge variant="outline" className="bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400">
                            <CheckCircle2 className="h-3 w-3 mr-1" />OK
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground">
                        Duration: {regulations?.durationMinutes || "?"} min / Allowed: {siteRules?.maxStayMinutes || regulations?.maxStayAllowed || "?"} min
                      </p>
                    </div>
                    {siteRules?.enforcementHours && (
                      <div className="p-3 rounded-md border bg-muted/50">
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-medium text-sm">Enforcement Hours</span>
                          <Badge variant="outline"><CheckCircle2 className="h-3 w-3 mr-1" />In Effect</Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {siteRules.enforcementHours.start} - {siteRules.enforcementHours.end}
                        </p>
                      </div>
                    )}
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
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-3 rounded-md border bg-muted/50">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm">Entrance Signage</span>
                      {getComplianceBadge(signage?.entranceSignage || "Unknown")}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {signage?.entranceNotes || "Site entrance signage visibility"}
                    </p>
                  </div>
                  <div className="p-3 rounded-md border bg-muted/50">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm">Terms Visibility</span>
                      {getComplianceBadge(signage?.termsVisibility || "Unknown")}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {signage?.termsNotes || "Terms and conditions display"}
                    </p>
                  </div>
                </div>
                <Separator />
                <div className="flex items-center justify-between">
                  <span className="font-medium text-sm">Overall Signage Compliance</span>
                  {getComplianceBadge(signage?.overallCompliance || "Unknown")}
                </div>
                {signage?.confidenceScore && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Signage Confidence</span>
                    <ConfidenceMeter value={signage.confidenceScore * 100} className="w-32" />
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
                  Section 6: Risk & Confidence
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
                    <ConfidenceMeter value={(decision?.confidenceScore || analysis?.confidenceScore || 0) * 100} className="w-40" />
                    <span className="text-sm font-mono">
                      {Math.round((decision?.confidenceScore || analysis?.confidenceScore || 0) * 100)}%
                    </span>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-medium">Legal Risk Level</span>
                  <Badge variant={decision?.riskLevel === "HIGH" ? "destructive" : decision?.riskLevel === "MEDIUM" ? "secondary" : "outline"}>
                    {decision?.riskLevel || analysis?.riskAssessment || "Unknown"}
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
                
                {decision?.blockers?.length > 0 && (
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
                      {pipelineResults?.status === "completed" ? (
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
                      {(decision?.confidenceScore || 0) >= 0.7 ? (
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

      <Collapsible open={expandedSections.has("audit")} onOpenChange={() => toggleSection("audit")}>
        <Card>
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer hover-elevate">
              <CardTitle className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2">
                  <History className="h-4 w-4" />
                  Section 7: Full Audit Log
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
                          <span>AI Model</span>
                          <span className="text-muted-foreground">GPT-4.1 + GPT-4o Vision</span>
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
