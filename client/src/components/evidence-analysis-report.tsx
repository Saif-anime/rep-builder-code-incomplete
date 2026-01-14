import { useState, useEffect, useRef } from "react";
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
  Truck,
  Package,
  User,
  DoorOpen,
  Accessibility,
  Eye,
  EyeOff,
  Calendar,
  Hash,
  Sparkles,
  Baby,
  Users,
  ShoppingCart,
  KeyRound,
  IdCard,
  FileCheck,
  ImageOff,
  Zap,
  BatteryCharging,
  PlugZap,
  Cable,
  Lightbulb,
  Cloud,
  CloudRain,
  CloudSnow,
  CloudFog,
  Sun,
  Moon,
  Thermometer,
  Wind,
  Droplets,
  ParkingSquare,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { HourlyWeatherSelector } from "@/components/hourly-weather-selector";
import type { CaseAnalysis, CaseVehicle, Evidence, BayType } from "@shared/schema";

interface EvidenceAnalysisReportProps {
  bundleId: string | number;
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
    "parent_child": "Parent & Child Bay",
    "parent_child_bay": "Parent & Child Bay",
    "authorised": "Authorised Bay",
    "authorized": "Authorised Bay",
    "authorised_bay": "Authorised Bay",
    "ev": "Electric Vehicle Bay",
    "electric_vehicle": "Electric Vehicle Bay",
    "ev_charging": "EV Charging Bay",
    "charging": "EV Charging Bay",
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

interface WeatherData {
  observation_time: string | null;
  temperature_c: number | null;
  humidity_percent: number | null;
  precipitation_mm: number | null;
  rain_mm: number | null;
  snowfall_mm: number | null;
  visibility_m: number | null;
  wind_speed_mph: number | null;
  weather_code: number | null;
  weather_description: string | null;
  condition: string | null;
  is_day: boolean | null;
  severity: string | null;
  api_source: string | null;
}

interface WeatherResponse {
  status: "available" | "unavailable" | "error";
  message?: string;
  observe_from?: string;
  observe_to?: string;
  duration_minutes?: number;
  time_source?: string;
  confidence?: string;
  site_name?: string;
  site_postcode?: string;
  query_time?: string;
  weather?: WeatherData;
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
    loadingAnalysis?: {
      bayType: string;
      decision: "DO_NOT_ISSUE" | "ISSUE_PCN" | "MANUAL_REVIEW";
      confidence: "HIGH" | "MEDIUM" | "LOW";
      confidenceScore: number;
      loadingAnalysis: {
        vehicleType: string;
        vehicleLikelyForLoading: boolean;
        staffDetected: boolean;
        goodsDetected: boolean;
        doorsOpen: boolean;
        humanNearVehicle: boolean;
        objectsBeingCarried: boolean;
        motionAcrossFrames: boolean;
        continuousLoading: boolean;
        durationMinutes: number | null;
        signageTimeLimit: number | null;
        timeReasonable: boolean;
        activityFrameCount: number;
      };
      legalJustification: string;
      manualReviewRequired: boolean;
      activityFrames: Array<{
        evidenceId: number;
        timestamp: string | null;
        activityType: string;
        details: Record<string, boolean | string | null>;
      }>;
    };
    disabledBayAnalysis?: {
      bayType: string;
      blueBadgeVisible: boolean;
      badgeFrontVisible: boolean;
      expiryDateDetected: string | null;
      badgeExpired: boolean;
      vehicleFullyInsideBay: boolean;
      overlapDetected: boolean;
      decision: "COMPLIANT" | "NON_COMPLIANT" | "MANUAL_REVIEW";
      reason: string;
      confidence: "HIGH" | "MEDIUM" | "LOW";
      confidenceScore: number;
      bayConfirmation: {
        isDisabledBay: boolean;
        wheelchairSymbolVisible: boolean;
        signageVisible: boolean;
        roadMarkingsVisible: boolean;
        confidence: number;
      };
      vehiclePosition: {
        fullyInsideBay: boolean;
        overlapDetected: boolean;
        overlapType: string | null;
        confidence: number;
      };
      blueBadge: {
        visible: boolean;
        frontVisible: boolean;
        expiryDate: string | null;
        badgeNumber: string | null;
        hologramVisible: boolean;
        partiallyObscured: boolean;
        reflectionIssues: boolean;
        confidence: number;
      };
      manualReviewRequired: boolean;
      legalJustification: string;
      evidenceSummary: Array<{
        evidenceId: number;
        timestamp: string | null;
        badgeVisible: boolean;
        badgeFrontVisible: boolean;
        expiryDateFound: string | null;
        notes: string;
      }>;
    };
    bayPositionViolation?: {
      detected: boolean;
      improperFrames: number;
      properFrames: number;
      cannotDetermineFrames: number;
      confidence: number;
      issuesDetected: string[];
      summary: string;
      allResults?: Array<{
        evidenceId: number | null;
        complianceStatus: "PROPERLY_PARKED" | "IMPROPERLY_PARKED" | "CANNOT_DETERMINE";
        confidence: number;
        reasoning: string;
        vehicleFullyInsideBay: boolean;
        wheelsOnOrOverLines: boolean;
        straddlingMultipleBays: boolean;
        positionIssues?: {
          leftSideOverLine: boolean;
          rightSideOverLine: boolean;
          frontOverLine: boolean;
          rearOverLine: boolean;
          overlapDescription: string | null;
        };
      }>;
    };
    parentChildAnalysis?: {
      bayType: string;
      decision: "COMPLIANT" | "NON_COMPLIANT" | "MANUAL_REVIEW" | "REVIEW_REQUIRED";
      action?: string;
      reason: string;
      confidence: "HIGH" | "MEDIUM" | "LOW";
      confidenceScore: number;
      childPresent: boolean;
      childSeatVisible: boolean;
      pregnantIndicator: boolean;
      specialNeedsIndicator: boolean;
      childDetected?: boolean;
      observationDurationMinutes?: number;
      vehiclePositionValid?: boolean;
      manualReviewRequired: boolean;
      legalJustification: string;
      childDetection?: {
        detected: boolean;
        confidence: number;
        framesWithChildren: number;
        notes: string;
        supportingEvidence?: Array<{
          evidenceId: number;
          timestamp: string | null;
          description: string;
          confidence: number;
        }>;
      };
    };
    authorisedBayAnalysis?: {
      bayType: string;
      decision: "COMPLIANT" | "NON_COMPLIANT" | "MANUAL_REVIEW" | "AUTHORISED" | "REVIEW_REQUIRED";
      action?: string;
      reason: string;
      confidence: "HIGH" | "MEDIUM" | "LOW";
      confidenceScore: number;
      authorisationFound?: boolean;
      authorisationType?: string;
      permitVisible: boolean;
      permitType: string | null;
      permitExpiry: string | null;
      permitExpired: boolean;
      vehicleMatchesPermit: boolean;
      vehiclePositionValid?: boolean;
      manualReviewRequired: boolean;
      legalJustification: string;
      permitCheck?: {
        permitVisible: boolean;
        permitReadable?: boolean;
        matchesVehicle?: boolean;
        expiryDetected?: boolean;
        expiryDate?: string | null;
        notes?: string[];
      };
      evidenceQuality?: {
        visibility: string;
        issues?: string[];
        confidence: number;
      };
    };
    evBayAnalysis?: {
      bayType: string;
      decision: "COMPLIANT" | "NON_COMPLIANT" | "MANUAL_REVIEW" | "REVIEW_REQUIRED";
      reason: string;
      confidence: "HIGH" | "MEDIUM" | "LOW";
      confidenceScore: number;
      chargerConnected?: boolean;
      chargingActive?: boolean;
      cableConnected?: boolean;
      chargingPortVisible?: boolean;
      chargingStationVisible?: boolean;
      vehicleIsEv?: boolean;
      vehicleLikelyHybrid?: boolean;
      evBadgingDetected?: boolean;
      observationDurationMinutes?: number;
      manualReviewRequired: boolean;
      legalJustification: string;
      chargerAssessment?: {
        visibility: string;
        confidence: number;
        notes: string;
      };
      vehicleAssessment?: {
        makeModel: string;
        confidence: number;
        notes: string;
      };
      supportingEvidence?: Array<{
        evidenceId: number;
        timestamp: string | null;
        description: string;
        confidence: number;
        thumbnailUrl?: string;
      }>;
    };
  } | null;
  decision: {
    status: "PCN_ELIGIBLE" | "REVIEW_REQUIRED" | "NO_PCN" | "BLOCKED_BY_BAY_RULE";
    overallConfidence: number;
    legalRisk: "low" | "medium" | "high";
    recommendation: string;
    reasoning: string;
    plainEnglishExplanation: string;
    blockers: string[];
    aiInstructionsApplied?: boolean;
    aiInstructionsReasoning?: string;
    aiInstructionNotes?: string;
    siteIntelligenceApplied?: boolean;
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

function getWeatherIcon(condition: string | null, isDay: boolean | null) {
  if (!condition) return <Cloud className="h-5 w-5" />;
  
  switch (condition) {
    case "Clear":
      return isDay ? <Sun className="h-5 w-5 text-yellow-500" /> : <Moon className="h-5 w-5 text-blue-400" />;
    case "Cloudy":
      return <Cloud className="h-5 w-5 text-gray-400" />;
    case "Rain":
      return <CloudRain className="h-5 w-5 text-blue-500" />;
    case "Snow":
      return <CloudSnow className="h-5 w-5 text-blue-200" />;
    case "Fog":
      return <CloudFog className="h-5 w-5 text-gray-500" />;
    case "Ice":
      return <CloudSnow className="h-5 w-5 text-cyan-400" />;
    case "Storm":
      return <CloudRain className="h-5 w-5 text-purple-500" />;
    default:
      return <Cloud className="h-5 w-5" />;
  }
}

function getSeverityBadge(severity: string | null) {
  switch (severity) {
    case "Normal":
      return <Badge variant="outline" className="bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400">Normal</Badge>;
    case "Reduced Visibility":
      return <Badge variant="secondary" className="bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400">Reduced Visibility</Badge>;
    case "Adverse":
      return <Badge variant="destructive" className="bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400">Adverse</Badge>;
    case "Severe":
      return <Badge variant="destructive">Severe</Badge>;
    default:
      return null;
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

  const { data: weatherData, isLoading: loadingWeather, error: weatherError } = useQuery<WeatherResponse>({
    queryKey: [`/api/cases/${bundleId}/weather`],
    enabled: !!bundleId,
    staleTime: 60000,
  });

  // Track if we've already attempted auto-fetch for this bundle
  const autoFetchAttempted = useRef(false);
  
  // Auto-fetch weather mutation
  const autoFetchWeatherMutation = useMutation({
    mutationFn: async ({ observeDate, observeHour }: { observeDate: string; observeHour: number }) => {
      if (!siteId) throw new Error("No site ID");
      const response = await apiRequest("POST", `/api/evidence/weather/${siteId}/select-hour`, {
        date: observeDate,
        hour: observeHour,
        case_identifier: bundleId,
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/cases/${bundleId}/weather`] });
      queryClient.invalidateQueries({ queryKey: [`/api/cases/${bundleId}/pipeline/results`] });
    },
  });

  // Auto-fetch weather based on observe hour when weather is unavailable
  useEffect(() => {
    // Skip if already loading, already attempted, or mutation in progress
    if (loadingWeather || autoFetchAttempted.current || autoFetchWeatherMutation.isPending) {
      return;
    }
    
    // Only auto-fetch if weather is unavailable
    const weatherUnavailable = weatherError || weatherData?.status !== "available";
    if (!weatherUnavailable) {
      return;
    }
    
    // Get observe time from evidence summary (pipelineResults)
    const observeFrom = pipelineResults?.evidenceTimeline?.evidenceSummary?.observeFrom;
    if (!observeFrom || !siteId) {
      return;
    }
    
    // Extract date and hour from observe time
    const observeDate = new Date(observeFrom);
    const dateStr = observeDate.toISOString().split('T')[0];
    const hour = observeDate.getHours();
    
    // Mark as attempted and trigger auto-fetch
    autoFetchAttempted.current = true;
    autoFetchWeatherMutation.mutate({ observeDate: dateStr, observeHour: hour });
  }, [loadingWeather, weatherError, weatherData, pipelineResults, siteId, bundleId]);

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
      queryClient.invalidateQueries({ queryKey: [`/api/cases/${bundleId}/weather`] });
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
            "Analyse Evidence"
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
          
          {decision?.aiInstructionsApplied && (
            <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800" data-testid="ai-instructions-applied">
              <div className="flex items-start gap-2">
                <Lightbulb className="h-5 w-5 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium text-blue-800 dark:text-blue-200">AI Instructions Applied</p>
                  <p className="text-sm text-blue-700 dark:text-blue-300 mt-1">
                    {decision.aiInstructionsReasoning || "Site-specific AI instructions have influenced this decision."}
                  </p>
                  {decision.aiInstructionNotes && (
                    <p className="text-xs text-blue-600 dark:text-blue-400 mt-2 italic">
                      Note: {decision.aiInstructionNotes}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}
          
          {decision?.aiInstructionsApplied === false && decision?.aiInstructionsReasoning && (
            <div className="mt-4 p-3 bg-muted/50 rounded-lg border" data-testid="ai-instructions-considered">
              <div className="flex items-start gap-2">
                <Lightbulb className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                <p className="text-xs text-muted-foreground">
                  AI Instructions: {decision.aiInstructionsReasoning}
                </p>
              </div>
            </div>
          )}
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

      {/* Evidence Weather Analysis */}
      <Card data-testid="card-weather">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2 flex-wrap">
            <Cloud className="h-4 w-4" />
            Evidence Weather Analysis
            {weatherData?.weather && (
              <Badge variant="outline" className="gap-1">
                {getWeatherIcon(weatherData.weather.condition, weatherData.weather.is_day)}
                {weatherData.weather.condition}
              </Badge>
            )}
            {siteId && (
              <div className="ml-auto">
                <HourlyWeatherSelector
                  siteId={siteId}
                  caseIdentifier={bundleId}
                  defaultDate={weatherData?.observe_from?.split('T')[0] || (evidenceSummary?.observeFrom ? evidenceSummary.observeFrom.split('T')[0] : undefined)}
                  defaultHour={weatherData?.observe_from ? new Date(weatherData.observe_from).getHours() : (evidenceSummary?.observeFrom ? new Date(evidenceSummary.observeFrom).getHours() : undefined)}
                  onWeatherSelected={() => {
                    queryClient.invalidateQueries({ queryKey: [`/api/cases/${bundleId}/weather`] });
                  }}
                />
              </div>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loadingWeather || autoFetchWeatherMutation.isPending ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {autoFetchWeatherMutation.isPending ? "Auto-fetching weather for observation hour..." : "Loading weather data..."}
            </div>
          ) : weatherError || weatherData?.status !== "available" ? (
            <div className="space-y-3">
              <div className="p-3 bg-muted/50 rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <Clock className="h-4 w-4 text-blue-500" />
                  <span className="text-sm font-medium">Observation Time</span>
                </div>
                {weatherData?.observe_from ? (
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-xs text-muted-foreground">From</p>
                      <p className="font-medium">
                        {new Date(weatherData.observe_from).toLocaleString("en-GB", { 
                          day: "2-digit", month: "short", year: "numeric",
                          hour: "2-digit", minute: "2-digit" 
                        })}
                      </p>
                    </div>
                    {weatherData?.observe_to && (
                      <div>
                        <p className="text-xs text-muted-foreground">To</p>
                        <p className="font-medium">
                          {new Date(weatherData.observe_to).toLocaleString("en-GB", { 
                            day: "2-digit", month: "short", year: "numeric",
                            hour: "2-digit", minute: "2-digit" 
                          })}
                        </p>
                      </div>
                    )}
                  </div>
                ) : evidenceSummary?.observeFrom ? (
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-xs text-muted-foreground">From</p>
                      <p className="font-medium">
                        {new Date(evidenceSummary.observeFrom).toLocaleString("en-GB", { 
                          day: "2-digit", month: "short", year: "numeric",
                          hour: "2-digit", minute: "2-digit" 
                        })}
                      </p>
                    </div>
                    {evidenceSummary?.observeTo && (
                      <div>
                        <p className="text-xs text-muted-foreground">To</p>
                        <p className="font-medium">
                          {new Date(evidenceSummary.observeTo).toLocaleString("en-GB", { 
                            day: "2-digit", month: "short", year: "numeric",
                            hour: "2-digit", minute: "2-digit" 
                          })}
                        </p>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No observation time recorded</p>
                )}
              </div>
              <div className="text-sm text-muted-foreground flex items-center gap-1">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                Weather unavailable - use "Select Hour" to manually pick weather data
              </div>
            </div>
          ) : weatherData?.status === "available" && weatherData.weather ? (
            <div className="space-y-4">
              {/* Time Window */}
              <div className="p-2 bg-muted/50 rounded text-xs space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Time Window:</span>
                  <span className="font-medium">
                    {weatherData.observe_from && weatherData.observe_to ? (
                      <>
                        {new Date(weatherData.observe_from).toLocaleString("en-GB", { 
                          day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" 
                        })}
                        {weatherData.observe_from !== weatherData.observe_to && (
                          <> → {new Date(weatherData.observe_to).toLocaleTimeString("en-GB", { 
                            hour: "2-digit", minute: "2-digit" 
                          })}</>
                        )}
                      </>
                    ) : "Unknown"}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Time Source:</span>
                  <Badge variant="outline" className="text-xs">
                    {weatherData.time_source === "OCR" ? "OCR Extracted" : 
                     weatherData.time_source === "CAMERA_META" ? "Camera Timestamp" : 
                     weatherData.time_source === "UPLOAD" ? "Upload Time" : "Unknown"}
                  </Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Site:</span>
                  <span className="font-medium">{weatherData.site_name}</span>
                </div>
              </div>

              {/* Weather Data Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {weatherData.weather.temperature_c !== null && (
                  <div className="flex items-center gap-2">
                    <Thermometer className="h-4 w-4 text-orange-500" />
                    <div>
                      <p className="text-xs text-muted-foreground">Temperature</p>
                      <p className="font-medium">{weatherData.weather.temperature_c.toFixed(1)}°C</p>
                    </div>
                  </div>
                )}
                {weatherData.weather.wind_speed_mph !== null && (
                  <div className="flex items-center gap-2">
                    <Wind className="h-4 w-4 text-gray-500" />
                    <div>
                      <p className="text-xs text-muted-foreground">Wind</p>
                      <p className="font-medium">{weatherData.weather.wind_speed_mph.toFixed(0)} mph</p>
                    </div>
                  </div>
                )}
                {weatherData.weather.visibility_m !== null && (
                  <div className="flex items-center gap-2">
                    <Eye className="h-4 w-4 text-purple-500" />
                    <div>
                      <p className="text-xs text-muted-foreground">Visibility</p>
                      <p className="font-medium">
                        {weatherData.weather.visibility_m >= 1000 
                          ? `${(weatherData.weather.visibility_m / 1000).toFixed(1)} km`
                          : `${weatherData.weather.visibility_m} m`}
                      </p>
                    </div>
                  </div>
                )}
                {weatherData.weather.humidity_percent !== null && (
                  <div className="flex items-center gap-2">
                    <Droplets className="h-4 w-4 text-blue-500" />
                    <div>
                      <p className="text-xs text-muted-foreground">Humidity</p>
                      <p className="font-medium">{weatherData.weather.humidity_percent}%</p>
                    </div>
                  </div>
                )}
              </div>

              {/* Rain/Snow Indicators */}
              {(weatherData.weather.rain_mm !== null && weatherData.weather.rain_mm > 0) && (
                <div className="flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400">
                  <CloudRain className="h-4 w-4" />
                  <span>Rainfall: {weatherData.weather.rain_mm.toFixed(1)} mm</span>
                </div>
              )}
              {(weatherData.weather.snowfall_mm !== null && weatherData.weather.snowfall_mm > 0) && (
                <div className="flex items-center gap-2 text-sm text-cyan-600 dark:text-cyan-400">
                  <CloudSnow className="h-4 w-4" />
                  <span>Snowfall: {weatherData.weather.snowfall_mm.toFixed(1)} mm</span>
                </div>
              )}

              {/* Severity Badge */}
              <div className="flex items-center justify-between pt-2 border-t">
                <span className="text-xs text-muted-foreground">Weather Severity:</span>
                {getSeverityBadge(weatherData.weather.severity)}
              </div>

              {/* Confidence Badge */}
              <div className="flex items-center justify-between text-xs text-muted-foreground pt-2 border-t">
                <span>Confidence: 
                  <Badge variant={weatherData.confidence === "HIGH" ? "default" : 
                                  weatherData.confidence === "MEDIUM" ? "secondary" : "outline"} 
                         className="ml-2 text-xs">
                    {weatherData.confidence}
                  </Badge>
                </span>
                <span>Source: Open-Meteo Archive</span>
              </div>
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">
              <AlertCircle className="h-4 w-4 inline mr-1" />
              {weatherData?.message || "Weather unavailable - time not reliable"}
            </div>
          )}
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

      {bayRule?.loadingAnalysis && (
        <Card data-testid="card-loading-analysis" className="border-blue-200 dark:border-blue-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Truck className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              Loading Bay Analysis
              {bayRule.loadingAnalysis.decision === "DO_NOT_ISSUE" ? (
                <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 ml-auto">
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  Loading Detected
                </Badge>
              ) : bayRule.loadingAnalysis.decision === "MANUAL_REVIEW" ? (
                <Badge variant="secondary" className="ml-auto">
                  <AlertTriangle className="h-3 w-3 mr-1" />
                  Review Required
                </Badge>
              ) : (
                <Badge variant="destructive" className="ml-auto">
                  <XCircle className="h-3 w-3 mr-1" />
                  No Loading Detected
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="flex items-center gap-2">
                <Truck className={`h-4 w-4 ${bayRule.loadingAnalysis.loadingAnalysis.vehicleLikelyForLoading ? 'text-green-600' : 'text-muted-foreground'}`} />
                <span>Vehicle Type:</span>
                <Badge variant={bayRule.loadingAnalysis.loadingAnalysis.vehicleLikelyForLoading ? "default" : "outline"} className="text-xs">
                  {bayRule.loadingAnalysis.loadingAnalysis.vehicleType.replace("_", " ")}
                </Badge>
              </div>
              
              <div className="flex items-center gap-2">
                <User className={`h-4 w-4 ${bayRule.loadingAnalysis.loadingAnalysis.staffDetected ? 'text-green-600' : 'text-muted-foreground'}`} />
                <span>Staff Present:</span>
                <Badge variant={bayRule.loadingAnalysis.loadingAnalysis.staffDetected ? "default" : "outline"} className="text-xs">
                  {bayRule.loadingAnalysis.loadingAnalysis.staffDetected ? "Yes" : "No"}
                </Badge>
              </div>
              
              <div className="flex items-center gap-2">
                <Package className={`h-4 w-4 ${bayRule.loadingAnalysis.loadingAnalysis.goodsDetected ? 'text-green-600' : 'text-muted-foreground'}`} />
                <span>Goods Visible:</span>
                <Badge variant={bayRule.loadingAnalysis.loadingAnalysis.goodsDetected ? "default" : "outline"} className="text-xs">
                  {bayRule.loadingAnalysis.loadingAnalysis.goodsDetected ? "Yes" : "No"}
                </Badge>
              </div>
              
              <div className="flex items-center gap-2">
                <DoorOpen className={`h-4 w-4 ${bayRule.loadingAnalysis.loadingAnalysis.doorsOpen ? 'text-green-600' : 'text-muted-foreground'}`} />
                <span>Doors Open:</span>
                <Badge variant={bayRule.loadingAnalysis.loadingAnalysis.doorsOpen ? "default" : "outline"} className="text-xs">
                  {bayRule.loadingAnalysis.loadingAnalysis.doorsOpen ? "Yes" : "No"}
                </Badge>
              </div>
            </div>
            
            <Separator />
            
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Continuous Loading:</span>
                <Badge variant={bayRule.loadingAnalysis.loadingAnalysis.continuousLoading ? "default" : "outline"}>
                  {bayRule.loadingAnalysis.loadingAnalysis.continuousLoading ? "Yes" : "No"}
                </Badge>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Time Reasonable:</span>
                <Badge variant={bayRule.loadingAnalysis.loadingAnalysis.timeReasonable ? "default" : "destructive"}>
                  {bayRule.loadingAnalysis.loadingAnalysis.timeReasonable ? "Yes" : "Exceeded"}
                </Badge>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Activity Frames:</span>
                <span className="font-medium">{bayRule.loadingAnalysis.loadingAnalysis.activityFrameCount} of {evidenceSummary?.evidenceCount || 0}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">AI Confidence:</span>
                <Badge variant={getConfidenceBadgeVariant(bayRule.loadingAnalysis.confidence)}>
                  {bayRule.loadingAnalysis.confidenceScore}%
                </Badge>
              </div>
            </div>
            
            {bayRule.loadingAnalysis.activityFrames.length > 0 && (
              <>
                <Separator />
                <div>
                  <p className="text-sm font-medium mb-2">Activity Timeline</p>
                  <div className="space-y-1">
                    {bayRule.loadingAnalysis.activityFrames.slice(0, 3).map((frame, idx) => (
                      <div key={idx} className="flex items-center gap-2 text-xs p-2 bg-muted/50 rounded">
                        <Clock className="h-3 w-3 text-muted-foreground" />
                        <span className="font-mono text-muted-foreground">
                          {frame.timestamp ? formatTimeFromBackend(frame.timestamp) : "—"}
                        </span>
                        <span className="text-foreground">{frame.activityType}</span>
                      </div>
                    ))}
                    {bayRule.loadingAnalysis.activityFrames.length > 3 && (
                      <p className="text-xs text-muted-foreground pl-2">
                        + {bayRule.loadingAnalysis.activityFrames.length - 3} more activity frames
                      </p>
                    )}
                  </div>
                </div>
              </>
            )}
            
            <div className="p-3 bg-muted/30 rounded text-sm">
              <p className="font-medium text-xs text-muted-foreground mb-1">Legal Justification</p>
              <p>{bayRule.loadingAnalysis.legalJustification}</p>
            </div>
            
            {bayRule.loadingAnalysis.manualReviewRequired && (
              <div className="p-2 bg-amber-50 dark:bg-amber-900/20 rounded text-xs text-amber-700 dark:text-amber-300 flex items-center gap-2">
                <AlertTriangle className="h-3 w-3" />
                <span>Manual review required due to low AI confidence</span>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Bay Position Violation Analysis */}
      {bayRule?.bayPositionViolation && (
        <Card data-testid="card-bay-position-analysis" className={bayRule.bayPositionViolation.detected ? "border-red-300 dark:border-red-800" : "border-green-200 dark:border-green-800"}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <ParkingSquare className="h-4 w-4" />
              Bay Position Analysis
              {bayRule.bayPositionViolation.detected ? (
                <Badge variant="destructive" className="ml-auto">
                  <XCircle className="h-3 w-3 mr-1" />
                  Improper Parking
                </Badge>
              ) : (
                <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 ml-auto">
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  Properly Parked
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">{bayRule.bayPositionViolation.summary}</p>
            
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div className="flex flex-col items-center p-2 bg-muted/30 rounded">
                <span className="text-xs text-muted-foreground">Improper</span>
                <span className={`font-bold text-lg ${bayRule.bayPositionViolation.improperFrames > 0 ? 'text-red-600' : 'text-muted-foreground'}`}>
                  {bayRule.bayPositionViolation.improperFrames}
                </span>
              </div>
              <div className="flex flex-col items-center p-2 bg-muted/30 rounded">
                <span className="text-xs text-muted-foreground">Proper</span>
                <span className={`font-bold text-lg ${bayRule.bayPositionViolation.properFrames > 0 ? 'text-green-600' : 'text-muted-foreground'}`}>
                  {bayRule.bayPositionViolation.properFrames}
                </span>
              </div>
              <div className="flex flex-col items-center p-2 bg-muted/30 rounded">
                <span className="text-xs text-muted-foreground">Unclear</span>
                <span className="font-bold text-lg text-muted-foreground">
                  {bayRule.bayPositionViolation.cannotDetermineFrames}
                </span>
              </div>
            </div>
            
            {bayRule.bayPositionViolation.detected && bayRule.bayPositionViolation.confidence > 0 && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">AI Confidence:</span>
                <Badge variant={bayRule.bayPositionViolation.confidence >= 75 ? "default" : bayRule.bayPositionViolation.confidence >= 50 ? "secondary" : "outline"}>
                  {bayRule.bayPositionViolation.confidence}%
                </Badge>
              </div>
            )}
            
            {bayRule.bayPositionViolation.issuesDetected && bayRule.bayPositionViolation.issuesDetected.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Issues Detected:</p>
                <ul className="text-sm space-y-1">
                  {bayRule.bayPositionViolation.issuesDetected.map((issue, idx) => (
                    <li key={idx} className="flex items-start gap-2 text-red-600 dark:text-red-400">
                      <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                      <span>{issue}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {bayRule?.disabledBayAnalysis && (
        <Card data-testid="card-disabled-bay-analysis" className="border-purple-200 dark:border-purple-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Accessibility className="h-4 w-4 text-purple-600 dark:text-purple-400" />
              Disabled Bay Analysis
              {bayRule.disabledBayAnalysis.decision === "COMPLIANT" ? (
                <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 ml-auto">
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  Compliant
                </Badge>
              ) : bayRule.disabledBayAnalysis.decision === "MANUAL_REVIEW" ? (
                <Badge variant="secondary" className="ml-auto">
                  <AlertTriangle className="h-3 w-3 mr-1" />
                  Review Required
                </Badge>
              ) : (
                <Badge variant="destructive" className="ml-auto">
                  <XCircle className="h-3 w-3 mr-1" />
                  Non-Compliant
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="flex items-center gap-2">
                {bayRule.disabledBayAnalysis.blueBadgeVisible ? (
                  <Eye className="h-4 w-4 text-green-600" />
                ) : (
                  <EyeOff className="h-4 w-4 text-destructive" />
                )}
                <span>Badge Visible:</span>
                <Badge variant={bayRule.disabledBayAnalysis.blueBadgeVisible ? "default" : "destructive"} className="text-xs">
                  {bayRule.disabledBayAnalysis.blueBadgeVisible ? "Yes" : "No"}
                </Badge>
              </div>
              
              <div className="flex items-center gap-2">
                <Eye className={`h-4 w-4 ${bayRule.disabledBayAnalysis.badgeFrontVisible ? 'text-green-600' : 'text-muted-foreground'}`} />
                <span>Front Visible:</span>
                <Badge variant={bayRule.disabledBayAnalysis.badgeFrontVisible ? "default" : "outline"} className="text-xs">
                  {bayRule.disabledBayAnalysis.badgeFrontVisible ? "Yes" : "No"}
                </Badge>
              </div>
              
              <div className="flex items-center gap-2">
                <Calendar className={`h-4 w-4 ${bayRule.disabledBayAnalysis.expiryDateDetected && !bayRule.disabledBayAnalysis.badgeExpired ? 'text-green-600' : bayRule.disabledBayAnalysis.badgeExpired ? 'text-destructive' : 'text-muted-foreground'}`} />
                <span>Expiry Date:</span>
                <Badge variant={bayRule.disabledBayAnalysis.badgeExpired ? "destructive" : bayRule.disabledBayAnalysis.expiryDateDetected ? "default" : "outline"} className="text-xs">
                  {bayRule.disabledBayAnalysis.expiryDateDetected || "Not Found"}
                </Badge>
              </div>
              
              <div className="flex items-center gap-2">
                <Sparkles className={`h-4 w-4 ${bayRule.disabledBayAnalysis.blueBadge?.hologramVisible ? 'text-green-600' : 'text-muted-foreground'}`} />
                <span>Hologram:</span>
                <Badge variant={bayRule.disabledBayAnalysis.blueBadge?.hologramVisible ? "default" : "outline"} className="text-xs">
                  {bayRule.disabledBayAnalysis.blueBadge?.hologramVisible ? "Visible" : "Not Visible"}
                </Badge>
              </div>
            </div>
            
            <Separator />
            
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Badge Number:</span>
                <span className="font-mono font-medium">
                  {bayRule.disabledBayAnalysis.blueBadge?.badgeNumber || "—"}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Badge Expired:</span>
                <Badge variant={bayRule.disabledBayAnalysis.badgeExpired ? "destructive" : "default"}>
                  {bayRule.disabledBayAnalysis.badgeExpired ? "Yes - Expired" : "No - Valid"}
                </Badge>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Vehicle Position:</span>
                <Badge variant={bayRule.disabledBayAnalysis.vehicleFullyInsideBay ? "default" : "destructive"}>
                  {bayRule.disabledBayAnalysis.vehicleFullyInsideBay ? "Inside Bay" : "Overlap Detected"}
                </Badge>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">AI Confidence:</span>
                <Badge variant={getConfidenceBadgeVariant(bayRule.disabledBayAnalysis.confidence)}>
                  {bayRule.disabledBayAnalysis.confidenceScore}%
                </Badge>
              </div>
            </div>
            
            {bayRule.disabledBayAnalysis?.reason && bayRule.disabledBayAnalysis.decision !== "COMPLIANT" && (
              <>
                <Separator />
                <div className="p-2 bg-destructive/10 rounded text-sm flex items-start gap-2">
                  <XCircle className="h-4 w-4 text-destructive mt-0.5" />
                  <span className="text-destructive">{bayRule.disabledBayAnalysis.reason}</span>
                </div>
              </>
            )}
            
            <div className="p-3 bg-muted/30 rounded text-sm">
              <p className="font-medium text-xs text-muted-foreground mb-1">Legal Justification</p>
              <p>{bayRule.disabledBayAnalysis.legalJustification}</p>
            </div>
            
            {bayRule.disabledBayAnalysis.manualReviewRequired && (
              <div className="p-2 bg-amber-50 dark:bg-amber-900/20 rounded text-xs text-amber-700 dark:text-amber-300 flex items-center gap-2">
                <AlertTriangle className="h-3 w-3" />
                <span>Manual review required - Blue Badge visibility uncertain</span>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {bayRule?.parentChildAnalysis && (
        <Card data-testid="card-parent-child-analysis" className="border-pink-200 dark:border-pink-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Baby className="h-4 w-4 text-pink-600 dark:text-pink-400" />
              Parent & Child Bay Analysis
              {bayRule.parentChildAnalysis.decision === "COMPLIANT" ? (
                <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 ml-auto">
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  Compliant
                </Badge>
              ) : bayRule.parentChildAnalysis.decision === "REVIEW_REQUIRED" ? (
                <Badge variant="secondary" className="ml-auto">
                  <AlertTriangle className="h-3 w-3 mr-1" />
                  Review Required
                </Badge>
              ) : (
                <Badge variant="destructive" className="ml-auto">
                  <XCircle className="h-3 w-3 mr-1" />
                  Non-Compliant
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="flex items-center gap-2">
                {bayRule.parentChildAnalysis.childDetected ? (
                  <Baby className="h-4 w-4 text-green-600" />
                ) : (
                  <Baby className="h-4 w-4 text-destructive" />
                )}
                <span>Child Detected:</span>
                <Badge variant={bayRule.parentChildAnalysis.childDetected ? "default" : "destructive"} className="text-xs">
                  {bayRule.parentChildAnalysis.childDetected ? "Yes" : "No"}
                </Badge>
              </div>
              
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-muted-foreground" />
                <span>People:</span>
                <span className="font-medium">
                  {bayRule.parentChildAnalysis.childDetection?.adultCount || 0} Adults, {bayRule.parentChildAnalysis.childDetection?.childCount || 0} Children
                </span>
              </div>
              
              <div className="flex items-center gap-2">
                <ShoppingCart className={`h-4 w-4 ${bayRule.parentChildAnalysis.childDetection?.pramWithChild ? 'text-green-600' : 'text-muted-foreground'}`} />
                <span>Pram/Buggy:</span>
                <Badge variant={bayRule.parentChildAnalysis.childDetection?.pramWithChild ? "default" : "outline"} className="text-xs">
                  {bayRule.parentChildAnalysis.childDetection?.pramWithChild ? "With Child" : 
                   bayRule.parentChildAnalysis.childDetection?.pramOnly ? "Empty" : "Not Seen"}
                </Badge>
              </div>
              
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <span>Observation:</span>
                <Badge variant="outline" className="text-xs">
                  {bayRule.parentChildAnalysis.observationDurationMinutes 
                    ? `${bayRule.parentChildAnalysis.observationDurationMinutes.toFixed(1)} min` 
                    : "—"}
                </Badge>
              </div>
            </div>
            
            <Separator />
            
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Vehicle Position:</span>
                <Badge variant={bayRule.parentChildAnalysis.vehiclePositionValid ? "default" : "destructive"}>
                  {bayRule.parentChildAnalysis.vehiclePositionValid ? "Inside Bay" : "Overlap Detected"}
                </Badge>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">AI Confidence:</span>
                <Badge variant={getConfidenceBadgeVariant(bayRule.parentChildAnalysis.confidence)}>
                  {bayRule.parentChildAnalysis.confidenceScore}%
                </Badge>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Action:</span>
                <Badge variant={bayRule.parentChildAnalysis.action === "DO NOT ISSUE" ? "default" : "destructive"}>
                  {bayRule.parentChildAnalysis.action}
                </Badge>
              </div>
            </div>
            
            {bayRule.parentChildAnalysis?.reason && bayRule.parentChildAnalysis.decision !== "COMPLIANT" && (
              <>
                <Separator />
                <div className="p-2 bg-destructive/10 rounded text-sm flex items-start gap-2">
                  <XCircle className="h-4 w-4 text-destructive mt-0.5" />
                  <span className="text-destructive">{bayRule.parentChildAnalysis.reason}</span>
                </div>
              </>
            )}
            
            <div className="p-3 bg-muted/30 rounded text-sm">
              <p className="font-medium text-xs text-muted-foreground mb-1">Legal Justification</p>
              <p>{bayRule.parentChildAnalysis.legalJustification}</p>
            </div>
            
            {bayRule.parentChildAnalysis.manualReviewRequired && (
              <div className="p-2 bg-amber-50 dark:bg-amber-900/20 rounded text-xs text-amber-700 dark:text-amber-300 flex items-center gap-2">
                <AlertTriangle className="h-3 w-3" />
                <span>Manual review required - Child presence uncertain</span>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {bayRule?.authorisedBayAnalysis && (
        <Card data-testid="card-authorised-bay-analysis" className="border-teal-200 dark:border-teal-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-teal-600 dark:text-teal-400" />
              Authorised Bay Analysis
              {bayRule.authorisedBayAnalysis.decision === "AUTHORISED" ? (
                <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 ml-auto">
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  Authorised
                </Badge>
              ) : bayRule.authorisedBayAnalysis.decision === "REVIEW_REQUIRED" ? (
                <Badge variant="secondary" className="ml-auto">
                  <AlertTriangle className="h-3 w-3 mr-1" />
                  Review Required
                </Badge>
              ) : (
                <Badge variant="destructive" className="ml-auto">
                  <XCircle className="h-3 w-3 mr-1" />
                  Not Authorised
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="flex items-center gap-2">
                {bayRule.authorisedBayAnalysis.authorisationFound ? (
                  <FileCheck className="h-4 w-4 text-green-600" />
                ) : (
                  <FileCheck className="h-4 w-4 text-destructive" />
                )}
                <span>Authorisation:</span>
                <Badge variant={bayRule.authorisedBayAnalysis.authorisationFound ? "default" : "destructive"} className="text-xs">
                  {bayRule.authorisedBayAnalysis.authorisationFound ? "Found" : "Not Found"}
                </Badge>
              </div>
              
              {bayRule.authorisedBayAnalysis.authorisationType && (
                <div className="flex items-center gap-2">
                  <IdCard className="h-4 w-4 text-teal-600" />
                  <span>Type:</span>
                  <Badge variant="outline" className="text-xs">
                    {bayRule.authorisedBayAnalysis.authorisationType}
                  </Badge>
                </div>
              )}
              
              <div className="flex items-center gap-2">
                <Eye className={`h-4 w-4 ${bayRule.authorisedBayAnalysis.permitCheck?.permitVisible ? 'text-green-600' : 'text-muted-foreground'}`} />
                <span>Permit:</span>
                <Badge variant={bayRule.authorisedBayAnalysis.permitCheck?.permitVisible ? "default" : "outline"} className="text-xs">
                  {bayRule.authorisedBayAnalysis.permitCheck?.permitVisible 
                    ? (bayRule.authorisedBayAnalysis.permitCheck?.permitReadable ? "Visible & Readable" : "Visible") 
                    : "Not Visible"}
                </Badge>
              </div>
              
              <div className="flex items-center gap-2">
                <ImageOff className={`h-4 w-4 ${bayRule.authorisedBayAnalysis.evidenceQuality?.overallQuality === "HIGH" ? 'text-green-600' : 'text-muted-foreground'}`} />
                <span>Evidence:</span>
                <Badge variant={bayRule.authorisedBayAnalysis.evidenceQuality?.overallQuality === "HIGH" ? "default" : "outline"} className="text-xs">
                  {bayRule.authorisedBayAnalysis.evidenceQuality?.overallQuality || "Unknown"}
                </Badge>
              </div>
            </div>
            
            <Separator />
            
            <div className="space-y-2">
              {bayRule.authorisedBayAnalysis.permitCheck?.permitNumber && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Permit Number:</span>
                  <Badge variant="outline">{bayRule.authorisedBayAnalysis.permitCheck.permitNumber}</Badge>
                </div>
              )}
              {bayRule.authorisedBayAnalysis.permitCheck?.permitExpiry && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Expiry:</span>
                  <Badge variant={bayRule.authorisedBayAnalysis.permitCheck?.permitExpired ? "destructive" : "default"}>
                    {bayRule.authorisedBayAnalysis.permitCheck.permitExpiry}
                    {bayRule.authorisedBayAnalysis.permitCheck?.permitExpired && " (Expired)"}
                  </Badge>
                </div>
              )}
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Vehicle Position:</span>
                <Badge variant={bayRule.authorisedBayAnalysis.vehiclePositionValid ? "default" : "destructive"}>
                  {bayRule.authorisedBayAnalysis.vehiclePositionValid ? "Correctly Parked" : "Position Issue"}
                </Badge>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">AI Confidence:</span>
                <Badge variant={getConfidenceBadgeVariant(bayRule.authorisedBayAnalysis.confidence)}>
                  {bayRule.authorisedBayAnalysis.confidenceScore}%
                </Badge>
              </div>
            </div>
            
            {bayRule.authorisedBayAnalysis?.reason && bayRule.authorisedBayAnalysis.decision !== "AUTHORISED" && (
              <>
                <Separator />
                <div className="p-2 bg-destructive/10 rounded text-sm flex items-start gap-2">
                  <XCircle className="h-4 w-4 text-destructive mt-0.5" />
                  <span className="text-destructive">{bayRule.authorisedBayAnalysis.reason}</span>
                </div>
              </>
            )}
            
            <div className="p-3 bg-muted/30 rounded text-sm">
              <p className="font-medium text-xs text-muted-foreground mb-1">Legal Justification</p>
              <p>{bayRule.authorisedBayAnalysis.legalJustification}</p>
            </div>
            
            {bayRule.authorisedBayAnalysis.manualReviewRequired && (
              <div className="p-2 bg-amber-50 dark:bg-amber-900/20 rounded text-xs text-amber-700 dark:text-amber-300 flex items-center gap-2">
                <AlertTriangle className="h-3 w-3" />
                <span>Manual review required - Permit verification uncertain</span>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {bayRule?.evBayAnalysis && (
        <Card data-testid="card-ev-bay-analysis" className="border-green-200 dark:border-green-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Zap className="h-4 w-4 text-green-600 dark:text-green-400" />
              EV Bay Analysis
              {bayRule.evBayAnalysis.decision === "COMPLIANT" ? (
                <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 ml-auto">
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  Compliant
                </Badge>
              ) : bayRule.evBayAnalysis.decision === "REVIEW_REQUIRED" ? (
                <Badge variant="secondary" className="ml-auto">
                  <AlertTriangle className="h-3 w-3 mr-1" />
                  Review Required
                </Badge>
              ) : (
                <Badge variant="destructive" className="ml-auto">
                  <XCircle className="h-3 w-3 mr-1" />
                  Non-Compliant
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="flex items-center gap-2">
                <BatteryCharging className={`h-4 w-4 ${bayRule.evBayAnalysis.vehicleEVCapability?.isEVCapable ? 'text-green-600' : 'text-destructive'}`} />
                <span>EV Vehicle:</span>
                <Badge variant={bayRule.evBayAnalysis.vehicleEVCapability?.isEVCapable ? "default" : "destructive"} className="text-xs">
                  {bayRule.evBayAnalysis.vehicleEVCapability?.isEVCapable 
                    ? (bayRule.evBayAnalysis.vehicleEVCapability?.isBEV ? "Battery Electric" : "Plug-in Hybrid") 
                    : "Not EV"}
                </Badge>
              </div>
              
              <div className="flex items-center gap-2">
                <Eye className={`h-4 w-4 ${bayRule.evBayAnalysis.vehicleEVCapability?.evBadgingVisible ? 'text-green-600' : 'text-muted-foreground'}`} />
                <span>EV Badging:</span>
                <Badge variant={bayRule.evBayAnalysis.vehicleEVCapability?.evBadgingVisible ? "default" : "outline"} className="text-xs">
                  {bayRule.evBayAnalysis.vehicleEVCapability?.evBadgingVisible ? "Visible" : "Not Seen"}
                </Badge>
              </div>
              
              <div className="flex items-center gap-2">
                <PlugZap className={`h-4 w-4 ${bayRule.evBayAnalysis.chargingActivity?.isActivelyCharging ? 'text-green-600' : 'text-muted-foreground'}`} />
                <span>Charging:</span>
                <Badge variant={bayRule.evBayAnalysis.chargingActivity?.isActivelyCharging ? "default" : "outline"} className="text-xs">
                  {bayRule.evBayAnalysis.chargingActivity?.isActivelyCharging ? "Active" : "Not Charging"}
                </Badge>
              </div>
              
              <div className="flex items-center gap-2">
                <Cable className={`h-4 w-4 ${bayRule.evBayAnalysis.chargingActivity?.cableConnectedToVehicle ? 'text-green-600' : 'text-muted-foreground'}`} />
                <span>Cable:</span>
                <Badge variant={bayRule.evBayAnalysis.chargingActivity?.cableConnectedToVehicle ? "default" : "outline"} className="text-xs">
                  {bayRule.evBayAnalysis.chargingActivity?.cableConnectedToVehicle && bayRule.evBayAnalysis.chargingActivity?.cableConnectedToCharger 
                    ? "Connected" 
                    : bayRule.evBayAnalysis.chargingActivity?.cableConnectedToVehicle 
                      ? "Vehicle Only" 
                      : "Not Connected"}
                </Badge>
              </div>
            </div>
            
            <Separator />
            
            <div className="space-y-2">
              {bayRule.evBayAnalysis.vehicleEVCapability?.makeModel && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Vehicle:</span>
                  <Badge variant="outline">{bayRule.evBayAnalysis.vehicleEVCapability.makeModel}</Badge>
                </div>
              )}
              {bayRule.evBayAnalysis.vehicleEVCapability?.fuelTypeFromDVLA && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">DVLA Fuel Type:</span>
                  <Badge variant="outline">{bayRule.evBayAnalysis.vehicleEVCapability.fuelTypeFromDVLA}</Badge>
                </div>
              )}
              {bayRule.evBayAnalysis.chargingActivity?.chargingUnitType && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Charger Type:</span>
                  <Badge variant="outline">{bayRule.evBayAnalysis.chargingActivity.chargingUnitType}</Badge>
                </div>
              )}
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Charging Required:</span>
                <Badge variant={bayRule.evBayAnalysis.chargingActivity?.chargingRequiredBySignage ? "secondary" : "outline"}>
                  {bayRule.evBayAnalysis.chargingActivity?.chargingRequiredBySignage ? "Yes (signage)" : "No"}
                </Badge>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Vehicle Position:</span>
                <Badge variant={bayRule.evBayAnalysis.vehiclePosition?.correctlyParked ? "default" : "destructive"}>
                  {bayRule.evBayAnalysis.vehiclePosition?.correctlyParked ? "Correctly Parked" : "Position Issue"}
                </Badge>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">AI Confidence:</span>
                <Badge variant={getConfidenceBadgeVariant(bayRule.evBayAnalysis.confidence)}>
                  {bayRule.evBayAnalysis.confidenceScore}%
                </Badge>
              </div>
            </div>
            
            {bayRule.evBayAnalysis.signageCompliance?.violations && bayRule.evBayAnalysis.signageCompliance.violations.length > 0 && (
              <>
                <Separator />
                <div className="p-2 bg-destructive/10 rounded text-sm">
                  <p className="font-medium text-xs text-destructive mb-1">Signage Violations</p>
                  <ul className="list-disc list-inside text-destructive space-y-1">
                    {bayRule.evBayAnalysis.signageCompliance.violations.map((violation: string, idx: number) => (
                      <li key={idx}>{violation}</li>
                    ))}
                  </ul>
                </div>
              </>
            )}
            
            {bayRule.evBayAnalysis?.reason && bayRule.evBayAnalysis.decision === "NON_COMPLIANT" && (
              <>
                <Separator />
                <div className="p-2 bg-destructive/10 rounded text-sm flex items-start gap-2">
                  <XCircle className="h-4 w-4 text-destructive mt-0.5" />
                  <span className="text-destructive">{bayRule.evBayAnalysis.reason}</span>
                </div>
              </>
            )}
            
            <div className="p-3 bg-muted/30 rounded text-sm">
              <p className="font-medium text-xs text-muted-foreground mb-1">Legal Justification</p>
              <p>{bayRule.evBayAnalysis.legalJustification}</p>
            </div>
            
            {bayRule.evBayAnalysis.manualReviewRequired && (
              <div className="p-2 bg-amber-50 dark:bg-amber-900/20 rounded text-xs text-amber-700 dark:text-amber-300 flex items-center gap-2">
                <AlertTriangle className="h-3 w-3" />
                <span>Manual review required - EV/Charging verification uncertain</span>
              </div>
            )}
          </CardContent>
        </Card>
      )}

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
