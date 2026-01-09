import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Brain,
  Search,
  Filter,
  Loader2,
  Eye,
  CheckCircle,
  XCircle,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ConfidenceMeter } from "@/components/confidence-meter";
import { ViolationBadge } from "@/components/violation-badge";
import { PlateDisplay } from "@/components/plate-display";
import { EmptyState } from "@/components/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { format } from "date-fns";
import type { ParkingEvent } from "@shared/schema";

interface AnalysisEvent extends Omit<ParkingEvent, 'aiReasoning'> {
  plateText?: string;
  aiReasoning?: {
    factors: string[];
    uncertainties: string[];
    recommendation: string;
  } | null;
}

export default function AnalysisPage() {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selectedEvent, setSelectedEvent] = useState<AnalysisEvent | null>(null);

  const { data: events, isLoading } = useQuery<AnalysisEvent[]>({
    queryKey: ["/api/parking-events", { status: statusFilter }],
  });

  const confirmMutation = useMutation({
    mutationFn: async ({ id, action }: { id: number; action: "confirm" | "dismiss" }) => {
      return apiRequest("POST", `/api/parking-events/${id}/${action}`);
    },
    onSuccess: (_, variables) => {
      toast({
        title: variables.action === "confirm" ? "Violation confirmed" : "Event dismissed",
        description: "The parking event has been updated.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/parking-events"] });
      setSelectedEvent(null);
    },
    onError: () => {
      toast({
        title: "Action failed",
        description: "Failed to update the parking event.",
        variant: "destructive",
      });
    },
  });

  const analyzeMutation = useMutation({
    mutationFn: async (eventId: number) => {
      return apiRequest("POST", `/api/parking-events/${eventId}/analyze`);
    },
    onSuccess: () => {
      toast({
        title: "Analysis complete",
        description: "AI analysis has been generated.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/parking-events"] });
    },
    onError: () => {
      toast({
        title: "Analysis failed",
        description: "Failed to generate AI analysis.",
        variant: "destructive",
      });
    },
  });

  const filteredEvents = events?.filter((e) => {
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      return (
        e.id.toString().includes(query) ||
        e.plateText?.toLowerCase().includes(query) ||
        e.violationType?.toLowerCase().includes(query)
      );
    }
    return true;
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">AI Analysis</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Review AI-powered violation detection and explanations
        </p>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by plate or violation type..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
            data-testid="input-search-analysis"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[140px]" data-testid="select-status-filter">
            <Filter className="h-4 w-4 mr-2" />
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="confirmed">Confirmed</SelectItem>
            <SelectItem value="dismissed">Dismissed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-4">
                <div className="flex items-center gap-4">
                  <Skeleton className="h-20 w-32 rounded-md" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-5 w-1/3" />
                    <Skeleton className="h-4 w-1/2" />
                    <Skeleton className="h-4 w-1/4" />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : filteredEvents && filteredEvents.length > 0 ? (
        <div className="space-y-4">
          {filteredEvents.map((event) => (
            <Card
              key={event.id}
              className="hover-elevate cursor-pointer transition-all"
              onClick={() => setSelectedEvent(event)}
              data-testid={`analysis-card-${event.id}`}
            >
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-4">
                    <div className="flex h-20 w-32 items-center justify-center rounded-md bg-muted">
                      <Brain className="h-8 w-8 text-muted-foreground/50" />
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        {event.plateText && (
                          <span className="font-mono font-bold">{event.plateText}</span>
                        )}
                        {event.violationType && (
                          <ViolationBadge type={event.violationType} />
                        )}
                        <Badge
                          variant={
                            event.status === "confirmed"
                              ? "default"
                              : event.status === "dismissed"
                              ? "secondary"
                              : "outline"
                          }
                        >
                          {event.status}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground line-clamp-2">
                        {event.aiExplanation || "AI analysis pending..."}
                      </p>
                      <span className="font-mono text-xs text-muted-foreground">
                        {format(new Date(event.createdAt), "dd/MM/yyyy HH:mm")}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <ConfidenceMeter
                      value={event.aiConfidence || 0}
                      className="w-32"
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedEvent(event);
                      }}
                      data-testid={`button-view-analysis-${event.id}`}
                    >
                      <Eye className="h-4 w-4 mr-1" />
                      View Details
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={Brain}
          title="No Analysis Results"
          description="Parking events with AI analysis will appear here."
        />
      )}

      <Dialog open={!!selectedEvent} onOpenChange={() => setSelectedEvent(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Brain className="h-5 w-5" />
              AI Analysis Details
            </DialogTitle>
          </DialogHeader>
          {selectedEvent && (
            <div className="space-y-6">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-2">
                  {selectedEvent.plateText && (
                    <PlateDisplay
                      plateText={selectedEvent.plateText}
                      isValid={true}
                    />
                  )}
                  {selectedEvent.violationType && (
                    <ViolationBadge type={selectedEvent.violationType} />
                  )}
                </div>
                <ConfidenceMeter
                  value={selectedEvent.aiConfidence || 0}
                  className="w-40"
                />
              </div>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-primary" />
                    AI Explanation
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm">
                    {selectedEvent.aiExplanation || "No AI explanation available."}
                  </p>
                </CardContent>
              </Card>

              {selectedEvent.aiReasoning && (
                <div className="grid gap-4 md:grid-cols-2">
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium">Detection Factors</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="space-y-1 text-sm">
                        {selectedEvent.aiReasoning.factors.map((factor, i) => (
                          <li key={i} className="flex items-start gap-2">
                            <CheckCircle className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
                            {factor}
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium">Uncertainties</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="space-y-1 text-sm">
                        {selectedEvent.aiReasoning.uncertainties.map((u, i) => (
                          <li key={i} className="flex items-start gap-2">
                            <XCircle className="h-4 w-4 text-orange-500 mt-0.5 shrink-0" />
                            {u}
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                </div>
              )}

              {selectedEvent.status === "pending" && (
                <div className="flex justify-end gap-3">
                  <Button
                    variant="outline"
                    onClick={() => analyzeMutation.mutate(selectedEvent.id)}
                    disabled={analyzeMutation.isPending}
                    data-testid="button-reanalyze"
                  >
                    {analyzeMutation.isPending ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Brain className="h-4 w-4 mr-2" />
                    )}
                    Re-analyze
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() =>
                      confirmMutation.mutate({ id: selectedEvent.id, action: "dismiss" })
                    }
                    disabled={confirmMutation.isPending}
                    data-testid="button-dismiss"
                  >
                    <XCircle className="h-4 w-4 mr-2" />
                    Dismiss
                  </Button>
                  <Button
                    onClick={() =>
                      confirmMutation.mutate({ id: selectedEvent.id, action: "confirm" })
                    }
                    disabled={confirmMutation.isPending}
                    data-testid="button-confirm"
                  >
                    <CheckCircle className="h-4 w-4 mr-2" />
                    Confirm Violation
                  </Button>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
