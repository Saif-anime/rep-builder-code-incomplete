import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { 
  AlertTriangle, 
  CheckCircle2, 
  XCircle,
  HelpCircle,
  ChevronDown,
  ChevronRight,
  Loader2,
  Brain,
  FileText,
  Scale,
  Shield,
  Car,
  Clock,
  Send
} from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface AnalysisReport {
  caseSummary: {
    caseId: string;
    siteName: string;
    vrm: string;
    vehicleType: string;
    totalDuration: number;
    allowedDuration: number | null;
  };
  what: {
    situation: string;
    findings: string[];
    evidence: string[];
  };
  how: {
    regulationsApplied: string[];
    signageStatus: string;
    confidenceLevel: number;
    dataSourcesUsed: string[];
  };
  why: {
    decision: string;
    reasoning: string[];
    eligibilityStatus: {
      regulationBreach: boolean;
      signageCompliant: boolean;
      confidenceThresholdMet: boolean;
    };
    blockers: string[];
  };
  generatedAt: string;
}

interface PipelineStep {
  id: number;
  stepName: string;
  status: string;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
}

interface PipelineAnalysisReportProps {
  caseId: string;
  onPcnIssued?: () => void;
}

export function PipelineAnalysisReport({ caseId, onPcnIssued }: PipelineAnalysisReportProps) {
  const { toast } = useToast();
  const [expanded, setExpanded] = useState({
    what: true,
    how: true,
    why: true,
    steps: false,
  });

  const { data: report, isLoading: reportLoading, refetch: refetchReport } = useQuery<AnalysisReport | null>({
    queryKey: ["/api/cases", caseId, "pipeline", "report"],
    queryFn: async () => {
      const res = await fetch(`/api/cases/${caseId}/pipeline/report`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("auth_token")}` },
      });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!caseId,
  });

  const { data: steps = [], refetch: refetchSteps } = useQuery<PipelineStep[]>({
    queryKey: ["/api/cases", caseId, "pipeline", "steps"],
    queryFn: async () => {
      const res = await fetch(`/api/cases/${caseId}/pipeline/steps`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("auth_token")}` },
      });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!caseId,
  });

  const runPipelineMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", `/api/cases/${caseId}/pipeline/run`);
    },
    onSuccess: () => {
      toast({ title: "Pipeline analysis completed" });
      refetchReport();
      refetchSteps();
    },
    onError: (error: Error) => {
      toast({ title: "Pipeline analysis failed", description: error.message, variant: "destructive" });
    },
  });

  const issuePcnMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", `/api/cases/${caseId}/pipeline/issue-pcn`);
    },
    onSuccess: () => {
      toast({ title: "PCN issued successfully" });
      onPcnIssued?.();
      queryClient.invalidateQueries({ queryKey: ["/api/cases"] });
    },
    onError: (error: any) => {
      const errorData = error?.response?.data || {};
      toast({ 
        title: "Cannot issue PCN", 
        description: errorData.error || error.message,
        variant: "destructive" 
      });
    },
  });

  const getStatusIcon = (status: boolean | undefined, unknownAsWarning = false) => {
    if (status === true) return <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />;
    if (status === false) return <XCircle className="h-4 w-4 text-red-600 dark:text-red-400" />;
    return unknownAsWarning 
      ? <AlertTriangle className="h-4 w-4 text-yellow-600 dark:text-yellow-400" />
      : <HelpCircle className="h-4 w-4 text-muted-foreground" />;
  };

  const getStepStatusBadge = (status: string) => {
    switch (status) {
      case "completed": return <Badge className="bg-green-500/20 text-green-700 dark:text-green-300">Completed</Badge>;
      case "running": return <Badge className="bg-blue-500/20 text-blue-700 dark:text-blue-300">Running</Badge>;
      case "failed": return <Badge className="bg-red-500/20 text-red-700 dark:text-red-300">Failed</Badge>;
      default: return <Badge variant="outline">Pending</Badge>;
    }
  };

  const formatDuration = (mins: number | null) => {
    if (!mins) return "—";
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  if (reportLoading) {
    return (
      <Card className="border">
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (!report) {
    return (
      <Card className="border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Brain className="h-5 w-5" />
            Pipeline Analysis
          </CardTitle>
          <CardDescription>
            Run the 6-step analysis pipeline to evaluate this case
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button 
            onClick={() => runPipelineMutation.mutate()}
            disabled={runPipelineMutation.isPending}
            className="w-full"
            data-testid="button-run-pipeline"
          >
            {runPipelineMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Running Analysis Pipeline...
              </>
            ) : (
              <>
                <Brain className="h-4 w-4 mr-2" />
                Run Full Analysis Pipeline
              </>
            )}
          </Button>
          
          {steps.length > 0 && (
            <div className="mt-4">
              <p className="text-sm font-medium mb-2">Pipeline Steps</p>
              <div className="space-y-1">
                {steps.sort((a, b) => a.id - b.id).map((step) => (
                  <div key={step.id} className="flex items-center justify-between text-xs">
                    <span className="capitalize">{step.stepName.replace(/_/g, " ")}</span>
                    {getStepStatusBadge(step.status)}
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  const allGatesPassed = report.why.eligibilityStatus.regulationBreach && 
                         report.why.eligibilityStatus.signageCompliant && 
                         report.why.eligibilityStatus.confidenceThresholdMet;

  return (
    <Card className="border" data-testid="pipeline-analysis-report">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Brain className="h-5 w-5" />
            Pipeline Analysis Report
          </CardTitle>
          <Badge 
            className={
              report.why.decision.includes("ELIGIBLE") || report.why.decision.includes("Issue")
                ? "bg-red-500/20 text-red-700 dark:text-red-300"
                : report.why.decision.includes("NO") 
                ? "bg-green-500/20 text-green-700 dark:text-green-300"
                : "bg-yellow-500/20 text-yellow-700 dark:text-yellow-300"
            }
          >
            {report.why.decision}
          </Badge>
        </div>
        <CardDescription className="text-xs">
          Generated {new Date(report.generatedAt).toLocaleString()}
        </CardDescription>
      </CardHeader>
      
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="text-center p-2 bg-muted/30 rounded">
            <Car className="h-4 w-4 mx-auto mb-1 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">VRM</p>
            <p className="font-mono text-sm font-medium">{report.caseSummary.vrm}</p>
          </div>
          <div className="text-center p-2 bg-muted/30 rounded">
            <FileText className="h-4 w-4 mx-auto mb-1 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">Site</p>
            <p className="text-sm font-medium truncate">{report.caseSummary.siteName}</p>
          </div>
          <div className="text-center p-2 bg-muted/30 rounded">
            <Clock className="h-4 w-4 mx-auto mb-1 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">Duration</p>
            <p className="text-sm font-medium">{formatDuration(report.caseSummary.totalDuration)}</p>
          </div>
          <div className="text-center p-2 bg-muted/30 rounded">
            <Scale className="h-4 w-4 mx-auto mb-1 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">Allowed</p>
            <p className="text-sm font-medium">
              {report.caseSummary.allowedDuration ? formatDuration(report.caseSummary.allowedDuration) : "No limit"}
            </p>
          </div>
        </div>
        
        <Separator />
        
        <Collapsible open={expanded.what} onOpenChange={(o) => setExpanded(e => ({ ...e, what: o }))}>
          <CollapsibleTrigger className="flex items-center justify-between w-full p-2 hover-elevate rounded">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              <span className="font-semibold">WHAT</span>
              <span className="text-sm text-muted-foreground">— The Situation</span>
            </div>
            {expanded.what ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </CollapsibleTrigger>
          <CollapsibleContent className="px-2 pt-2 space-y-3">
            <p className="text-sm">{report.what.situation}</p>
            
            {report.what.findings.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Key Findings</p>
                <ul className="space-y-1">
                  {report.what.findings.map((finding, i) => (
                    <li key={i} className="text-sm flex items-start gap-2">
                      <CheckCircle2 className="h-3 w-3 mt-1 text-blue-600 dark:text-blue-400 shrink-0" />
                      {finding}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            
            {report.what.evidence.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Evidence Used</p>
                <div className="flex flex-wrap gap-1">
                  {report.what.evidence.map((ev, i) => (
                    <Badge key={i} variant="outline" className="text-xs">{ev}</Badge>
                  ))}
                </div>
              </div>
            )}
          </CollapsibleContent>
        </Collapsible>
        
        <Separator />
        
        <Collapsible open={expanded.how} onOpenChange={(o) => setExpanded(e => ({ ...e, how: o }))}>
          <CollapsibleTrigger className="flex items-center justify-between w-full p-2 hover-elevate rounded">
            <div className="flex items-center gap-2">
              <Scale className="h-4 w-4 text-purple-600 dark:text-purple-400" />
              <span className="font-semibold">HOW</span>
              <span className="text-sm text-muted-foreground">— The Analysis</span>
            </div>
            {expanded.how ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </CollapsibleTrigger>
          <CollapsibleContent className="px-2 pt-2 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Regulations Applied</p>
                <ul className="space-y-1">
                  {report.how.regulationsApplied.length > 0 ? (
                    report.how.regulationsApplied.map((reg, i) => (
                      <li key={i} className="text-sm">{reg}</li>
                    ))
                  ) : (
                    <li className="text-sm text-muted-foreground">No specific regulations</li>
                  )}
                </ul>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Data Sources</p>
                <div className="flex flex-wrap gap-1">
                  {report.how.dataSourcesUsed.map((src, i) => (
                    <Badge key={i} variant="secondary" className="text-xs">{src}</Badge>
                  ))}
                </div>
              </div>
            </div>
            
            <div className="flex items-center justify-between bg-muted/30 rounded p-3">
              <div>
                <p className="text-xs text-muted-foreground">Signage Status</p>
                <p className="text-sm font-medium">{report.how.signageStatus}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-muted-foreground">Confidence</p>
                <p className="text-sm font-medium">{Math.round(report.how.confidenceLevel * 100)}%</p>
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>
        
        <Separator />
        
        <Collapsible open={expanded.why} onOpenChange={(o) => setExpanded(e => ({ ...e, why: o }))}>
          <CollapsibleTrigger className="flex items-center justify-between w-full p-2 hover-elevate rounded">
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-orange-600 dark:text-orange-400" />
              <span className="font-semibold">WHY</span>
              <span className="text-sm text-muted-foreground">— The Decision</span>
            </div>
            {expanded.why ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </CollapsibleTrigger>
          <CollapsibleContent className="px-2 pt-2 space-y-3">
            <div className="bg-muted/30 rounded p-3">
              <p className="font-semibold mb-2">{report.why.decision}</p>
              <ul className="space-y-1">
                {report.why.reasoning.map((reason, i) => (
                  <li key={i} className="text-sm text-muted-foreground">{reason}</li>
                ))}
              </ul>
            </div>
            
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">Eligibility Gates</p>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  {getStatusIcon(report.why.eligibilityStatus.regulationBreach)}
                  <span className="text-sm">Regulation Breach Confirmed</span>
                </div>
                <div className="flex items-center gap-2">
                  {getStatusIcon(report.why.eligibilityStatus.signageCompliant)}
                  <span className="text-sm">Signage Compliant</span>
                </div>
                <div className="flex items-center gap-2">
                  {getStatusIcon(report.why.eligibilityStatus.confidenceThresholdMet)}
                  <span className="text-sm">Confidence Threshold Met (70%+)</span>
                </div>
              </div>
            </div>
            
            {report.why.blockers.length > 0 && (
              <div className="bg-red-500/10 border border-red-500/20 rounded p-3">
                <p className="text-xs font-medium text-red-700 dark:text-red-300 mb-1">PCN Blockers</p>
                <ul className="space-y-1">
                  {report.why.blockers.map((blocker, i) => (
                    <li key={i} className="text-sm text-red-600 dark:text-red-400 flex items-start gap-2">
                      <XCircle className="h-3 w-3 mt-1 shrink-0" />
                      {blocker}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CollapsibleContent>
        </Collapsible>
        
        <Separator />
        
        <Collapsible open={expanded.steps} onOpenChange={(o) => setExpanded(e => ({ ...e, steps: o }))}>
          <CollapsibleTrigger className="flex items-center justify-between w-full p-2 hover-elevate rounded">
            <div className="flex items-center gap-2">
              <Brain className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Pipeline Steps</span>
            </div>
            {expanded.steps ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </CollapsibleTrigger>
          <CollapsibleContent className="px-2 pt-2">
            <div className="space-y-1">
              {steps.sort((a, b) => a.id - b.id).map((step) => (
                <div key={step.id} className="flex items-center justify-between text-xs py-1">
                  <span className="capitalize">{step.stepName.replace(/_/g, " ")}</span>
                  <div className="flex items-center gap-2">
                    {step.durationMs && (
                      <span className="text-muted-foreground">{step.durationMs}ms</span>
                    )}
                    {getStepStatusBadge(step.status)}
                  </div>
                </div>
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
        
        <Separator />
        
        <div className="flex flex-col sm:flex-row gap-2">
          <Button 
            onClick={() => runPipelineMutation.mutate()}
            disabled={runPipelineMutation.isPending}
            variant="outline"
            className="flex-1"
            data-testid="button-rerun-pipeline"
          >
            {runPipelineMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Re-analyzing...
              </>
            ) : (
              <>
                <Brain className="h-4 w-4 mr-2" />
                Re-run Analysis
              </>
            )}
          </Button>
          
          <Button 
            onClick={() => issuePcnMutation.mutate()}
            disabled={issuePcnMutation.isPending || !allGatesPassed}
            className="flex-1"
            variant={allGatesPassed ? "default" : "secondary"}
            data-testid="button-issue-pcn"
          >
            {issuePcnMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Issuing PCN...
              </>
            ) : (
              <>
                <Send className="h-4 w-4 mr-2" />
                Issue PCN
              </>
            )}
          </Button>
        </div>
        
        {!allGatesPassed && (
          <p className="text-xs text-center text-muted-foreground">
            PCN issuance requires all eligibility gates to pass
          </p>
        )}
      </CardContent>
    </Card>
  );
}
