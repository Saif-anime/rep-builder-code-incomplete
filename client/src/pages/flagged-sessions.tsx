import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Flag,
  Filter,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Clock,
  ChevronDown,
  ChevronRight,
  X,
  FileJson,
  ArrowRightLeft,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { format, subDays } from "date-fns";

interface SessionFlag {
  id: number;
  sessionId: number;
  siteId: number;
  enrichmentRunId: number | null;
  flagType: string;
  severity: string;
  reason: string;
  recommendation: string | null;
  evidence: {
    weatherConditions?: string;
    weatherAlerts?: string[];
    localEvents?: Array<{ name: string; type: string; distance?: string }>;
    overstayRate?: number;
    baselineRate?: number;
    spikeMultiplier?: number;
    siteInventoryHits?: string[];
  } | null;
  status: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolutionNotes: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ParkingSession {
  id: number;
  siteId: number;
  vrm: string;
  entryAt: string | null;
  exitAt: string | null;
  durationMinutes: number | null;
  status: string;
}

interface ParkingSite {
  id: number;
  name: string;
  locationCode: string | null;
}

interface SiteRule {
  maxStayMinutes: number | null;
}

interface FlagWithSession extends SessionFlag {
  session?: ParkingSession;
  site?: ParkingSite;
  rules?: SiteRule;
}

// Helper to format duration as X hours Y minutes
function formatDurationHoursMinutes(minutes: number | null): string {
  if (minutes == null || isNaN(minutes)) return "N/A";
  if (minutes === 0) return "0 minutes";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0 && m > 0) return `${h} hour${h > 1 ? "s" : ""} ${m} minute${m > 1 ? "s" : ""}`;
  if (h > 0) return `${h} hour${h > 1 ? "s" : ""}`;
  return `${m} minute${m > 1 ? "s" : ""}`;
}

export default function FlaggedSessionsPage() {
  const { toast } = useToast();
  const [selectedSiteId, setSelectedSiteId] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState<string>(
    format(subDays(new Date(), 7), "yyyy-MM-dd")
  );
  const [dateTo, setDateTo] = useState<string>(format(new Date(), "yyyy-MM-dd"));
  const [flagTypeFilter, setFlagTypeFilter] = useState<string>("all");
  const [recommendationFilter, setRecommendationFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("OPEN");
  
  const [selectedFlag, setSelectedFlag] = useState<FlagWithSession | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [overrideDialogOpen, setOverrideDialogOpen] = useState(false);
  const [overrideAction, setOverrideAction] = useState<string>("HOLD_PCN");
  const [overrideReason, setOverrideReason] = useState("");
  const [resolveDialogOpen, setResolveDialogOpen] = useState(false);
  const [resolveNotes, setResolveNotes] = useState("");
  const [dismissDialogOpen, setDismissDialogOpen] = useState(false);
  const [dismissNotes, setDismissNotes] = useState("");

  const { data: sites } = useQuery<ParkingSite[]>({
    queryKey: ["/api/sites"],
  });

  const flagsQueryKey = [
    "/api/flags/search",
    selectedSiteId,
    dateFrom,
    dateTo,
    flagTypeFilter,
    recommendationFilter,
    statusFilter,
  ];

  const { data: flags, isLoading: flagsLoading } = useQuery<FlagWithSession[]>({
    queryKey: flagsQueryKey,
    queryFn: async () => {
      const siteIds = selectedSiteId === "all" ? sites?.map((s) => s.id) || [] : [parseInt(selectedSiteId)];
      if (siteIds.length === 0) return [];
      
      const allFlags: FlagWithSession[] = [];
      for (const siteId of siteIds.slice(0, 10)) {
        const params = new URLSearchParams();
        if (dateFrom) params.append("from", new Date(dateFrom).toISOString());
        if (dateTo) params.append("to", new Date(dateTo + "T23:59:59").toISOString());
        if (statusFilter !== "all") params.append("status", statusFilter);
        
        try {
          const res = await fetch(`/api/sites/${siteId}/flags?${params}`, {
            credentials: "include",
          });
          if (res.ok) {
            const siteFlags = await res.json();
            const site = sites?.find((s) => s.id === siteId);
            for (const flag of siteFlags) {
              let session: ParkingSession | undefined;
              try {
                const sessionRes = await fetch(`/api/parking-sessions/${flag.sessionId}`, {
                  credentials: "include",
                });
                if (sessionRes.ok) {
                  session = await sessionRes.json();
                }
              } catch {}
              
              let rules: SiteRule | undefined;
              try {
                const rulesRes = await fetch(`/api/sites/${siteId}/rules`, {
                  credentials: "include",
                });
                if (rulesRes.ok) {
                  rules = await rulesRes.json();
                }
              } catch {}

              const flagWithSession: FlagWithSession = {
                ...flag,
                session,
                site,
                rules,
              };
              
              if (flagTypeFilter !== "all" && flag.flagType !== flagTypeFilter) continue;
              if (recommendationFilter !== "all" && flag.recommendation !== recommendationFilter) continue;
              
              allFlags.push(flagWithSession);
            }
          }
        } catch {}
      }
      return allFlags.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    },
    enabled: !!sites && sites.length > 0,
  });

  const resolveMutation = useMutation({
    mutationFn: async ({ flagId, notes }: { flagId: number; notes: string }) => {
      const res = await apiRequest("POST", `/api/flags/${flagId}/resolve`, { notes });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: flagsQueryKey });
      setResolveDialogOpen(false);
      setResolveNotes("");
      setDrawerOpen(false);
      toast({ title: "Flag resolved", description: "The flag has been marked as resolved." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to resolve flag.", variant: "destructive" });
    },
  });

  const dismissMutation = useMutation({
    mutationFn: async ({ flagId, notes }: { flagId: number; notes: string }) => {
      const res = await apiRequest("POST", `/api/flags/${flagId}/dismiss`, { notes });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: flagsQueryKey });
      setDismissDialogOpen(false);
      setDismissNotes("");
      setDrawerOpen(false);
      toast({ title: "Flag dismissed", description: "The flag has been dismissed." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to dismiss flag.", variant: "destructive" });
    },
  });

  const overrideMutation = useMutation({
    mutationFn: async ({ flagId, action, reason }: { flagId: number; action: string; reason: string }) => {
      const res = await apiRequest("POST", `/api/flags/${flagId}/override`, { action, reason });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: flagsQueryKey });
      setOverrideDialogOpen(false);
      setOverrideAction("HOLD_PCN");
      setOverrideReason("");
      toast({ title: "Override saved", description: "Your recommendation override has been recorded." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save override.", variant: "destructive" });
    },
  });

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case "critical": return "bg-red-500/20 text-red-600 dark:text-red-400";
      case "high": return "bg-orange-500/20 text-orange-600 dark:text-orange-400";
      case "medium": return "bg-yellow-500/20 text-yellow-600 dark:text-yellow-400";
      case "low": return "bg-green-500/20 text-green-600 dark:text-green-400";
      default: return "bg-muted text-muted-foreground";
    }
  };

  const getRecommendationIcon = (recommendation: string | null) => {
    switch (recommendation) {
      case "HOLD_PCN": return <Clock className="h-4 w-4 text-amber-500" />;
      case "PROCEED_PCN": return <CheckCircle className="h-4 w-4 text-green-500" />;
      case "REVIEW_REQUIRED": return <AlertTriangle className="h-4 w-4 text-orange-500" />;
      case "AUTO_DISMISS": return <XCircle className="h-4 w-4 text-gray-500" />;
      default: return null;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "OPEN": return <Badge variant="outline" className="bg-blue-500/10 text-blue-600">Open</Badge>;
      case "RESOLVED": return <Badge variant="outline" className="bg-green-500/10 text-green-600">Resolved</Badge>;
      case "DISMISSED": return <Badge variant="outline" className="bg-gray-500/10 text-gray-600">Dismissed</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  const openFlagDetail = (flag: FlagWithSession) => {
    setSelectedFlag(flag);
    setDrawerOpen(true);
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-semibold">Flagged Sessions Review</h1>
        <p className="text-xs sm:text-sm text-muted-foreground mt-1">
          Review AI recommendations and make enforcement decisions
        </p>
      </div>

      <Card>
        <CardHeader className="pb-4 px-3 sm:px-6">
          <CardTitle className="text-sm sm:text-base flex items-center gap-2">
            <Filter className="h-4 w-4" />
            Filters
          </CardTitle>
        </CardHeader>
        <CardContent className="px-3 sm:px-6">
          <div className="grid gap-3 sm:gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
            <div className="space-y-2">
              <Label htmlFor="site-filter">Site</Label>
              <Select value={selectedSiteId} onValueChange={setSelectedSiteId}>
                <SelectTrigger id="site-filter" data-testid="select-site-filter">
                  <SelectValue placeholder="All sites" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Sites</SelectItem>
                  {sites?.slice(0, 50).map((site) => (
                    <SelectItem key={site.id} value={String(site.id)}>
                      {site.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="date-from">From</Label>
              <Input
                id="date-from"
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                data-testid="input-date-from"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="date-to">To</Label>
              <Input
                id="date-to"
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                data-testid="input-date-to"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="flag-type-filter">Flag Type</Label>
              <Select value={flagTypeFilter} onValueChange={setFlagTypeFilter}>
                <SelectTrigger id="flag-type-filter" data-testid="select-flag-type">
                  <SelectValue placeholder="All types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="POSSIBLE_DISRUPTION">Possible Disruption</SelectItem>
                  <SelectItem value="WEATHER_DISRUPTION">Weather Disruption</SelectItem>
                  <SelectItem value="EVENT_DISRUPTION">Event Disruption</SelectItem>
                  <SelectItem value="ROAD_INCIDENT">Road Incident</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="recommendation-filter">Recommendation</Label>
              <Select value={recommendationFilter} onValueChange={setRecommendationFilter}>
                <SelectTrigger id="recommendation-filter" data-testid="select-recommendation">
                  <SelectValue placeholder="All recommendations" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Recommendations</SelectItem>
                  <SelectItem value="HOLD_PCN">Hold PCN</SelectItem>
                  <SelectItem value="PROCEED_PCN">Proceed PCN</SelectItem>
                  <SelectItem value="REVIEW_REQUIRED">Review Required</SelectItem>
                  <SelectItem value="AUTO_DISMISS">Auto Dismiss</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="status-filter">Status</Label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger id="status-filter" data-testid="select-status">
                  <SelectValue placeholder="Open" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="OPEN">Open</SelectItem>
                  <SelectItem value="RESOLVED">Resolved</SelectItem>
                  <SelectItem value="DISMISSED">Dismissed</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base flex items-center gap-2">
            <Flag className="h-4 w-4" />
            Flagged Sessions
            {flags && <Badge variant="secondary">{flags.length}</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {flagsLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading flags...</div>
          ) : !flags || flags.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No flagged sessions found for the selected criteria.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-32">VRM</TableHead>
                    <TableHead>Observe From / To</TableHead>
                    <TableHead className="text-center">Duration</TableHead>
                    <TableHead className="text-center">Max Stay</TableHead>
                    <TableHead>Flag Type</TableHead>
                    <TableHead>Recommendation</TableHead>
                    <TableHead className="text-center">Severity</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {flags.map((flag) => (
                    <TableRow
                      key={flag.id}
                      className="cursor-pointer hover-elevate"
                      onClick={() => openFlagDetail(flag)}
                      data-testid={`row-flag-${flag.id}`}
                    >
                      <TableCell className="font-mono font-bold">
                        {flag.session?.vrm || "N/A"}
                      </TableCell>
                      <TableCell className="text-xs font-mono">
                        <div>{flag.session?.entryAt ? format(new Date(flag.session.entryAt), "dd/MM HH:mm") : "-"}</div>
                        <div className="text-muted-foreground">
                          {flag.session?.exitAt ? format(new Date(flag.session.exitAt), "dd/MM HH:mm") : "-"}
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        {flag.session?.durationMinutes ? `${flag.session.durationMinutes}m` : "-"}
                      </TableCell>
                      <TableCell className="text-center">
                        {flag.rules?.maxStayMinutes ? `${flag.rules.maxStayMinutes}m` : "-"}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">
                          {flag.flagType.replace(/_/g, " ")}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          {getRecommendationIcon(flag.recommendation)}
                          <span className="text-xs">{flag.recommendation?.replace(/_/g, " ") || "None"}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge className={`text-xs ${getSeverityColor(flag.severity)}`}>
                          {flag.severity}
                        </Badge>
                      </TableCell>
                      <TableCell>{getStatusBadge(flag.status)}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={(e) => {
                            e.stopPropagation();
                            openFlagDetail(flag);
                          }}
                          data-testid={`button-view-flag-${flag.id}`}
                        >
                          View
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Flag className="h-5 w-5" />
              Flag Details
            </SheetTitle>
            <SheetDescription>
              {selectedFlag?.session?.vrm || "Unknown VRM"} - {selectedFlag?.site?.name || "Unknown Site"}
            </SheetDescription>
          </SheetHeader>

          {selectedFlag && (
            <div className="mt-6 space-y-6">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Status</span>
                  {getStatusBadge(selectedFlag.status)}
                </div>
                
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Severity</span>
                  <Badge className={getSeverityColor(selectedFlag.severity)}>
                    {selectedFlag.severity}
                  </Badge>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Recommendation</span>
                  <div className="flex items-center gap-2">
                    {getRecommendationIcon(selectedFlag.recommendation)}
                    <span className="text-sm">{selectedFlag.recommendation?.replace(/_/g, " ") || "None"}</span>
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Created</span>
                  <span className="text-sm font-mono">
                    {format(new Date(selectedFlag.createdAt), "dd/MM/yyyy HH:mm")}
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                <h4 className="text-sm font-medium">Reason (Plain English)</h4>
                <Card>
                  <CardContent className="p-4">
                    <p className="text-sm">{selectedFlag.reason}</p>
                  </CardContent>
                </Card>
              </div>

              <div className="space-y-2">
                <h4 className="text-sm font-medium">Session Details</h4>
                <Card>
                  <CardContent className="p-4 space-y-2">
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">VRM</span>
                      <span className="text-sm font-mono font-bold">{selectedFlag.session?.vrm || "N/A"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">Observe From</span>
                      <span className="text-sm font-mono">
                        {selectedFlag.session?.entryAt
                          ? format(new Date(selectedFlag.session.entryAt), "HH:mm dd/MM/yyyy")
                          : "N/A"}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">Observe To</span>
                      <span className="text-sm font-mono">
                        {selectedFlag.session?.exitAt
                          ? format(new Date(selectedFlag.session.exitAt), "HH:mm dd/MM/yyyy")
                          : "N/A"}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">Duration</span>
                      <span className="text-sm">{selectedFlag.session?.durationMinutes ? formatDurationHoursMinutes(selectedFlag.session.durationMinutes) : "N/A"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">Max Stay</span>
                      <span className="text-sm">{selectedFlag.rules?.maxStayMinutes ? `${selectedFlag.rules.maxStayMinutes} minutes` : "N/A"}</span>
                    </div>
                  </CardContent>
                </Card>
              </div>

              <Collapsible>
                <CollapsibleTrigger className="flex items-center gap-2 text-sm font-medium w-full">
                  <FileJson className="h-4 w-4" />
                  Evidence JSON
                  <ChevronRight className="h-4 w-4 ml-auto transition-transform ui-expanded:rotate-90" />
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <Card className="mt-2">
                    <CardContent className="p-4">
                      <pre className="text-xs font-mono overflow-x-auto whitespace-pre-wrap max-h-64">
                        {JSON.stringify(selectedFlag.evidence, null, 2)}
                      </pre>
                    </CardContent>
                  </Card>
                </CollapsibleContent>
              </Collapsible>

              {selectedFlag.status === "OPEN" && (
                <div className="space-y-3 pt-4 border-t">
                  <h4 className="text-sm font-medium">Actions</h4>
                  <div className="grid grid-cols-3 gap-2">
                    <Button
                      variant="outline"
                      className="flex-1"
                      onClick={() => setResolveDialogOpen(true)}
                      data-testid="button-mark-resolved"
                    >
                      <CheckCircle className="h-4 w-4 mr-1" />
                      Resolve
                    </Button>
                    <Button
                      variant="outline"
                      className="flex-1"
                      onClick={() => setDismissDialogOpen(true)}
                      data-testid="button-dismiss"
                    >
                      <XCircle className="h-4 w-4 mr-1" />
                      Dismiss
                    </Button>
                    <Button
                      variant="default"
                      className="flex-1"
                      onClick={() => setOverrideDialogOpen(true)}
                      data-testid="button-override"
                    >
                      <ArrowRightLeft className="h-4 w-4 mr-1" />
                      Override
                    </Button>
                  </div>
                </div>
              )}

              {selectedFlag.status !== "OPEN" && selectedFlag.resolutionNotes && (
                <div className="space-y-2 pt-4 border-t">
                  <h4 className="text-sm font-medium">Resolution Notes</h4>
                  <Card>
                    <CardContent className="p-4">
                      <p className="text-sm">{selectedFlag.resolutionNotes}</p>
                      {selectedFlag.resolvedAt && (
                        <p className="text-xs text-muted-foreground mt-2">
                          Resolved: {format(new Date(selectedFlag.resolvedAt), "dd/MM/yyyy HH:mm")}
                        </p>
                      )}
                    </CardContent>
                  </Card>
                </div>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>

      <Dialog open={resolveDialogOpen} onOpenChange={setResolveDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark as Resolved</DialogTitle>
            <DialogDescription>
              Add notes about how this flag was resolved.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="resolve-notes">Resolution Notes</Label>
              <Textarea
                id="resolve-notes"
                value={resolveNotes}
                onChange={(e) => setResolveNotes(e.target.value)}
                placeholder="Enter notes about the resolution..."
                data-testid="textarea-resolve-notes"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResolveDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (selectedFlag) {
                  resolveMutation.mutate({ flagId: selectedFlag.id, notes: resolveNotes });
                }
              }}
              disabled={resolveMutation.isPending}
              data-testid="button-confirm-resolve"
            >
              {resolveMutation.isPending ? "Saving..." : "Mark Resolved"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dismissDialogOpen} onOpenChange={setDismissDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Dismiss Flag</DialogTitle>
            <DialogDescription>
              Provide a reason for dismissing this flag.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="dismiss-notes">Dismissal Reason</Label>
              <Textarea
                id="dismiss-notes"
                value={dismissNotes}
                onChange={(e) => setDismissNotes(e.target.value)}
                placeholder="Enter reason for dismissal..."
                data-testid="textarea-dismiss-notes"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDismissDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (selectedFlag) {
                  dismissMutation.mutate({ flagId: selectedFlag.id, notes: dismissNotes });
                }
              }}
              disabled={dismissMutation.isPending}
              data-testid="button-confirm-dismiss"
            >
              {dismissMutation.isPending ? "Saving..." : "Dismiss Flag"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={overrideDialogOpen} onOpenChange={setOverrideDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Override Recommendation</DialogTitle>
            <DialogDescription>
              Override the AI recommendation with your own decision. This will be recorded for audit purposes.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Current Recommendation</Label>
              <div className="flex items-center gap-2 p-2 bg-muted rounded-md">
                {getRecommendationIcon(selectedFlag?.recommendation || null)}
                <span className="text-sm">{selectedFlag?.recommendation?.replace(/_/g, " ") || "None"}</span>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="override-action">New Recommendation</Label>
              <Select value={overrideAction} onValueChange={setOverrideAction}>
                <SelectTrigger id="override-action" data-testid="select-override-action">
                  <SelectValue placeholder="Select action" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="HOLD_PCN">Hold PCN - Suspend enforcement</SelectItem>
                  <SelectItem value="PROCEED_PCN">Proceed PCN - Continue enforcement</SelectItem>
                  <SelectItem value="REVIEW_REQUIRED">Review Required - Manual review needed</SelectItem>
                  <SelectItem value="AUTO_DISMISS">Auto Dismiss - No action needed</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="override-reason">Reason for Override *</Label>
              <Textarea
                id="override-reason"
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                placeholder="Explain why you are overriding the AI recommendation..."
                data-testid="textarea-override-reason"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOverrideDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (selectedFlag && overrideReason.trim()) {
                  overrideMutation.mutate({
                    flagId: selectedFlag.id,
                    action: overrideAction,
                    reason: overrideReason,
                  });
                }
              }}
              disabled={overrideMutation.isPending || !overrideReason.trim()}
              data-testid="button-confirm-override"
            >
              {overrideMutation.isPending ? "Saving..." : "Save Override"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
