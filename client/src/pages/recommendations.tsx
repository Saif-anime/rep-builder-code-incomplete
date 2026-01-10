import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { 
  Brain, 
  CloudRain, 
  Calendar, 
  User, 
  Shield, 
  AlertTriangle,
  CheckCircle2,
  Clock,
  Car,
  MapPin,
  RefreshCw,
  Loader2,
  ChevronRight,
  FileText,
  TrendingUp,
  ThermometerSun
} from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { ParkingSite, PcnRecommendation } from "@shared/schema";

interface RecommendationEvidence {
  weatherConditions?: string;
  weatherAlerts?: string[];
  localEvents?: Array<{ name: string; type: string; distance?: string }>;
  driverProfile?: {
    classification: string;
    riskScore: number;
    riskFlag: string;
  };
  sessionDetails?: {
    entryAt: string;
    exitAt?: string;
    durationMinutes?: number;
    maxStayMinutes?: number;
  };
  siteContext?: string[];
  policyApplied?: string;
  spikeDetected?: boolean;
  overrideReason?: string;
}

export default function RecommendationsPage() {
  const { toast } = useToast();
  const [selectedSiteId, setSelectedSiteId] = useState<string>("");
  const [actionFilter, setActionFilter] = useState<string>("all");
  const [selectedRecommendation, setSelectedRecommendation] = useState<PcnRecommendation | null>(null);
  const [overrideDialogOpen, setOverrideDialogOpen] = useState(false);
  const [overrideAction, setOverrideAction] = useState<string>("");
  const [overrideReason, setOverrideReason] = useState("");

  const { data: sites = [] } = useQuery<ParkingSite[]>({
    queryKey: ["/api/parking-sites"],
  });

  const { data: recommendations = [], isLoading, refetch } = useQuery<PcnRecommendation[]>({
    queryKey: ["/api/recommendations", selectedSiteId, actionFilter],
    queryFn: async () => {
      if (!selectedSiteId) return [];
      const params = new URLSearchParams({ siteId: selectedSiteId });
      if (actionFilter !== "all") params.append("action", actionFilter);
      const res = await fetch(`/api/recommendations?${params}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("auth_token")}` },
      });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!selectedSiteId,
  });

  const overrideMutation = useMutation({
    mutationFn: async ({ id, action, reason }: { id: number; action: string; reason: string }) => {
      return apiRequest("POST", `/api/recommendations/${id}/override`, { action, reason });
    },
    onSuccess: () => {
      toast({ title: "Override applied", description: "Recommendation has been updated" });
      setOverrideDialogOpen(false);
      setOverrideReason("");
      queryClient.invalidateQueries({ queryKey: ["/api/recommendations"] });
    },
    onError: (error: Error) => {
      toast({ title: "Override failed", description: error.message, variant: "destructive" });
    },
  });

  const getActionBadge = (action: string) => {
    switch (action) {
      case "PROCEED_PCN":
        return <Badge variant="destructive">Issue PCN</Badge>;
      case "HOLD_PCN":
        return <Badge className="bg-amber-500 hover:bg-amber-600">Hold PCN</Badge>;
      case "REVIEW_REQUIRED":
        return <Badge variant="secondary">Review Required</Badge>;
      case "AUTO_DISMISS":
        return <Badge variant="outline" className="text-green-600 border-green-600">Auto Dismissed</Badge>;
      default:
        return <Badge variant="outline">{action}</Badge>;
    }
  };

  const getSourceBadge = (source: string, isOverride: boolean) => {
    if (isOverride) {
      return <Badge variant="outline" className="text-purple-600 border-purple-600">Manual Override</Badge>;
    }
    return source === "SYSTEM" 
      ? <Badge variant="outline">AI Generated</Badge>
      : <Badge variant="outline" className="text-blue-600 border-blue-600">User Decision</Badge>;
  };

  const formatDuration = (minutes?: number) => {
    if (!minutes) return "N/A";
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

  const handleOverride = () => {
    if (!selectedRecommendation || !overrideAction || !overrideReason.trim()) return;
    overrideMutation.mutate({
      id: selectedRecommendation.id,
      action: overrideAction,
      reason: overrideReason.trim(),
    });
  };

  const stats = {
    total: recommendations.length,
    proceed: recommendations.filter(r => r.action === "PROCEED_PCN").length,
    hold: recommendations.filter(r => r.action === "HOLD_PCN").length,
    review: recommendations.filter(r => r.action === "REVIEW_REQUIRED").length,
    dismissed: recommendations.filter(r => r.action === "AUTO_DISMISS").length,
  };

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Brain className="h-6 w-6" />
            AI Analysis Reports
          </h1>
          <p className="text-muted-foreground">View context-aware enforcement recommendations with full evidence breakdown</p>
        </div>
        <Button variant="outline" size="icon" onClick={() => refetch()} data-testid="button-refresh">
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex flex-wrap gap-4">
        <Select value={selectedSiteId} onValueChange={setSelectedSiteId}>
          <SelectTrigger className="w-[280px]" data-testid="select-site">
            <SelectValue placeholder="Select a site" />
          </SelectTrigger>
          <SelectContent>
            {sites.map((site) => (
              <SelectItem key={site.id} value={String(site.id)}>
                <div className="flex items-center gap-2">
                  <MapPin className="h-3 w-3" />
                  {site.siteName}
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={actionFilter} onValueChange={setActionFilter}>
          <SelectTrigger className="w-[180px]" data-testid="select-action-filter">
            <SelectValue placeholder="Filter by action" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Actions</SelectItem>
            <SelectItem value="PROCEED_PCN">Issue PCN</SelectItem>
            <SelectItem value="HOLD_PCN">Hold PCN</SelectItem>
            <SelectItem value="REVIEW_REQUIRED">Review Required</SelectItem>
            <SelectItem value="AUTO_DISMISS">Auto Dismissed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {selectedSiteId && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <Card>
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold">{stats.total}</p>
              <p className="text-sm text-muted-foreground">Total</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-red-600">{stats.proceed}</p>
              <p className="text-sm text-muted-foreground">Issue PCN</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-amber-600">{stats.hold}</p>
              <p className="text-sm text-muted-foreground">Hold</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-blue-600">{stats.review}</p>
              <p className="text-sm text-muted-foreground">Review</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-green-600">{stats.dismissed}</p>
              <p className="text-sm text-muted-foreground">Dismissed</p>
            </CardContent>
          </Card>
        </div>
      )}

      {!selectedSiteId ? (
        <Card>
          <CardContent className="p-12 text-center">
            <MapPin className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
            <p className="text-lg font-medium">Select a site to view recommendations</p>
            <p className="text-sm text-muted-foreground">Choose a parking site from the dropdown above</p>
          </CardContent>
        </Card>
      ) : isLoading ? (
        <Card>
          <CardContent className="p-12 text-center">
            <Loader2 className="h-12 w-12 mx-auto animate-spin text-muted-foreground/50 mb-4" />
            <p className="text-lg font-medium">Loading recommendations...</p>
          </CardContent>
        </Card>
      ) : recommendations.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <Brain className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
            <p className="text-lg font-medium">No recommendations found</p>
            <p className="text-sm text-muted-foreground">Generate recommendations by analyzing parking sessions</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {recommendations.map((rec) => {
            const evidence = rec.evidenceJson as RecommendationEvidence | null;
            return (
              <Card 
                key={rec.id} 
                className="hover-elevate cursor-pointer"
                onClick={() => setSelectedRecommendation(rec)}
                data-testid={`recommendation-card-${rec.id}`}
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 space-y-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        {getActionBadge(rec.action)}
                        {getSourceBadge(rec.source, rec.isOverride || false)}
                        <Badge variant="outline" className="font-mono">
                          <Car className="h-3 w-3 mr-1" />
                          {rec.vrm}
                        </Badge>
                        <Badge variant="outline">
                          {Math.round((rec.confidence || 0) * 100)}% Confidence
                        </Badge>
                      </div>
                      
                      <p className="text-sm">{rec.reasonPlain}</p>
                      
                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        {evidence?.sessionDetails && (
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            Duration: {formatDuration(evidence.sessionDetails.durationMinutes)}
                          </span>
                        )}
                        {evidence?.weatherConditions && (
                          <span className="flex items-center gap-1">
                            <CloudRain className="h-3 w-3" />
                            {evidence.weatherConditions}
                          </span>
                        )}
                        {evidence?.localEvents && evidence.localEvents.length > 0 && (
                          <span className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            {evidence.localEvents.length} event(s)
                          </span>
                        )}
                        {evidence?.driverProfile && (
                          <span className="flex items-center gap-1">
                            <User className="h-3 w-3" />
                            {evidence.driverProfile.classification}
                          </span>
                        )}
                      </div>
                    </div>
                    <ChevronRight className="h-5 w-5 text-muted-foreground" />
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={!!selectedRecommendation && !overrideDialogOpen} onOpenChange={() => setSelectedRecommendation(null)}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Brain className="h-5 w-5" />
              AI Analysis Report
            </DialogTitle>
          </DialogHeader>
          
          {selectedRecommendation && (
            <ScrollArea className="flex-1 pr-4">
              <div className="space-y-6">
                <div className="flex items-center gap-2 flex-wrap">
                  {getActionBadge(selectedRecommendation.action)}
                  {getSourceBadge(selectedRecommendation.source, selectedRecommendation.isOverride || false)}
                  <Badge variant="outline" className="font-mono text-base">
                    <Car className="h-4 w-4 mr-1" />
                    {selectedRecommendation.vrm}
                  </Badge>
                </div>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <TrendingUp className="h-4 w-4" />
                      Confidence Score
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center gap-4">
                      <Progress value={(selectedRecommendation.confidence || 0) * 100} className="flex-1" />
                      <span className="font-bold text-lg">{Math.round((selectedRecommendation.confidence || 0) * 100)}%</span>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <FileText className="h-4 w-4" />
                      Recommendation Summary
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm font-medium mb-1">{selectedRecommendation.reason}</p>
                    <p className="text-sm text-muted-foreground">{selectedRecommendation.reasonPlain}</p>
                  </CardContent>
                </Card>

                {(() => {
                  const evidence = selectedRecommendation.evidenceJson as RecommendationEvidence | null;
                  if (!evidence) return null;

                  return (
                    <>
                      {evidence.sessionDetails && (
                        <Card>
                          <CardHeader className="pb-2">
                            <CardTitle className="text-sm flex items-center gap-2">
                              <Clock className="h-4 w-4" />
                              Session Details
                            </CardTitle>
                          </CardHeader>
                          <CardContent>
                            <div className="grid grid-cols-2 gap-4 text-sm">
                              <div>
                                <p className="text-muted-foreground">Entry Time</p>
                                <p className="font-medium">{formatDate(evidence.sessionDetails.entryAt)}</p>
                              </div>
                              <div>
                                <p className="text-muted-foreground">Exit Time</p>
                                <p className="font-medium">{formatDate(evidence.sessionDetails.exitAt)}</p>
                              </div>
                              <div>
                                <p className="text-muted-foreground">Duration</p>
                                <p className="font-medium">{formatDuration(evidence.sessionDetails.durationMinutes)}</p>
                              </div>
                              <div>
                                <p className="text-muted-foreground">Max Stay Allowed</p>
                                <p className="font-medium">{formatDuration(evidence.sessionDetails.maxStayMinutes)}</p>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      )}

                      {evidence.weatherConditions && (
                        <Card>
                          <CardHeader className="pb-2">
                            <CardTitle className="text-sm flex items-center gap-2">
                              <ThermometerSun className="h-4 w-4" />
                              Weather Conditions
                            </CardTitle>
                          </CardHeader>
                          <CardContent>
                            <p className="font-medium capitalize">{evidence.weatherConditions}</p>
                            {evidence.weatherAlerts && evidence.weatherAlerts.length > 0 && (
                              <div className="mt-2 space-y-1">
                                {evidence.weatherAlerts.map((alert, i) => (
                                  <div key={i} className="flex items-center gap-2 text-sm text-amber-600">
                                    <AlertTriangle className="h-3 w-3" />
                                    {alert}
                                  </div>
                                ))}
                              </div>
                            )}
                          </CardContent>
                        </Card>
                      )}

                      {evidence.localEvents && evidence.localEvents.length > 0 && (
                        <Card>
                          <CardHeader className="pb-2">
                            <CardTitle className="text-sm flex items-center gap-2">
                              <Calendar className="h-4 w-4" />
                              Local Events Detected
                            </CardTitle>
                          </CardHeader>
                          <CardContent>
                            <div className="space-y-2">
                              {evidence.localEvents.map((event, i) => (
                                <div key={i} className="flex items-center justify-between p-2 rounded-md bg-muted">
                                  <div>
                                    <p className="font-medium text-sm">{event.name}</p>
                                    <p className="text-xs text-muted-foreground capitalize">{event.type}</p>
                                  </div>
                                  {event.distance && (
                                    <Badge variant="outline" className="text-xs">{event.distance}</Badge>
                                  )}
                                </div>
                              ))}
                            </div>
                          </CardContent>
                        </Card>
                      )}

                      {evidence.driverProfile && (
                        <Card>
                          <CardHeader className="pb-2">
                            <CardTitle className="text-sm flex items-center gap-2">
                              <User className="h-4 w-4" />
                              Driver Profile Analysis
                            </CardTitle>
                          </CardHeader>
                          <CardContent>
                            <div className="grid grid-cols-3 gap-4 text-sm">
                              <div>
                                <p className="text-muted-foreground">Classification</p>
                                <Badge variant="secondary" className="mt-1">
                                  {evidence.driverProfile.classification.replace(/_/g, " ")}
                                </Badge>
                              </div>
                              <div>
                                <p className="text-muted-foreground">Risk Score</p>
                                <p className="font-medium text-lg">{evidence.driverProfile.riskScore}</p>
                              </div>
                              <div>
                                <p className="text-muted-foreground">Risk Flag</p>
                                <Badge 
                                  variant={evidence.driverProfile.riskFlag === "NONE" ? "outline" : "secondary"}
                                  className={evidence.driverProfile.riskFlag.includes("MISUSE") ? "bg-red-100 text-red-700" : ""}
                                >
                                  {evidence.driverProfile.riskFlag.replace(/_/g, " ")}
                                </Badge>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      )}

                      {evidence.policyApplied && (
                        <Card>
                          <CardHeader className="pb-2">
                            <CardTitle className="text-sm flex items-center gap-2">
                              <Shield className="h-4 w-4" />
                              Policy Applied
                            </CardTitle>
                          </CardHeader>
                          <CardContent>
                            <p className="text-sm">{evidence.policyApplied}</p>
                          </CardContent>
                        </Card>
                      )}

                      {evidence.siteContext && evidence.siteContext.length > 0 && (
                        <Card>
                          <CardHeader className="pb-2">
                            <CardTitle className="text-sm flex items-center gap-2">
                              <MapPin className="h-4 w-4" />
                              Site Context
                            </CardTitle>
                          </CardHeader>
                          <CardContent>
                            <ul className="space-y-1">
                              {evidence.siteContext.map((ctx, i) => (
                                <li key={i} className="text-sm flex items-start gap-2">
                                  <CheckCircle2 className="h-3 w-3 mt-1 text-green-500 shrink-0" />
                                  {ctx}
                                </li>
                              ))}
                            </ul>
                          </CardContent>
                        </Card>
                      )}

                      {evidence.spikeDetected && (
                        <Card className="border-amber-200 bg-amber-50 dark:bg-amber-900/20">
                          <CardContent className="p-4">
                            <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
                              <AlertTriangle className="h-4 w-4" />
                              <span className="font-medium">Overstay Spike Detected</span>
                            </div>
                            <p className="text-sm text-muted-foreground mt-1">
                              Unusual spike in overstays detected during this period
                            </p>
                          </CardContent>
                        </Card>
                      )}

                      {evidence.overrideReason && (
                        <Card className="border-purple-200 bg-purple-50 dark:bg-purple-900/20">
                          <CardContent className="p-4">
                            <div className="flex items-center gap-2 text-purple-700 dark:text-purple-400">
                              <User className="h-4 w-4" />
                              <span className="font-medium">Manual Override Applied</span>
                            </div>
                            <p className="text-sm text-muted-foreground mt-1">
                              {evidence.overrideReason}
                            </p>
                          </CardContent>
                        </Card>
                      )}
                    </>
                  );
                })()}

                <Separator />

                <div className="flex justify-end gap-2">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setOverrideAction(selectedRecommendation.action);
                      setOverrideDialogOpen(true);
                    }}
                    data-testid="button-override"
                  >
                    Override Decision
                  </Button>
                </div>
              </div>
            </ScrollArea>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={overrideDialogOpen} onOpenChange={setOverrideDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Override Recommendation</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>New Action</Label>
              <Select value={overrideAction} onValueChange={setOverrideAction}>
                <SelectTrigger data-testid="select-override-action">
                  <SelectValue placeholder="Select action" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PROCEED_PCN">Issue PCN</SelectItem>
                  <SelectItem value="HOLD_PCN">Hold PCN</SelectItem>
                  <SelectItem value="REVIEW_REQUIRED">Review Required</SelectItem>
                  <SelectItem value="AUTO_DISMISS">Auto Dismiss</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Reason for Override</Label>
              <Textarea
                placeholder="Explain why you are overriding the AI recommendation..."
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                rows={4}
                data-testid="input-override-reason"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOverrideDialogOpen(false)}>
              Cancel
            </Button>
            <Button 
              onClick={handleOverride}
              disabled={!overrideReason.trim() || overrideMutation.isPending}
              data-testid="button-confirm-override"
            >
              {overrideMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Applying...
                </>
              ) : (
                "Apply Override"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
