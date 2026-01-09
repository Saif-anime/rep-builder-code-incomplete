import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  FileText,
  Search,
  Filter,
  Plus,
  Eye,
  Download,
  Loader2,
  Printer,
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ViolationBadge } from "@/components/violation-badge";
import { EmptyState } from "@/components/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { format } from "date-fns";
import type { ParkingEvent } from "@shared/schema";

interface PCNEvent extends ParkingEvent {
  plateText?: string;
}

export default function PCNPage() {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selectedPCN, setSelectedPCN] = useState<PCNEvent | null>(null);

  const { data: events, isLoading } = useQuery<PCNEvent[]>({
    queryKey: ["/api/parking-events", { hasPcn: true, status: statusFilter }],
  });

  const generatePCNMutation = useMutation({
    mutationFn: async (eventId: number) => {
      return apiRequest("POST", `/api/parking-events/${eventId}/generate-pcn`);
    },
    onSuccess: () => {
      toast({
        title: "PCN generated",
        description: "Penalty Charge Notice has been generated successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/parking-events"] });
    },
    onError: () => {
      toast({
        title: "Generation failed",
        description: "Failed to generate PCN. Please try again.",
        variant: "destructive",
      });
    },
  });

  const filteredEvents = events?.filter((e) => {
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      return (
        e.pcnNumber?.toLowerCase().includes(query) ||
        e.plateText?.toLowerCase().includes(query)
      );
    }
    return true;
  });

  const confirmedWithoutPCN = events?.filter(
    (e) => e.status === "confirmed" && !e.pcnNumber
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">PCN Management</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage Penalty Charge Notices for confirmed violations
          </p>
        </div>
      </div>

      {confirmedWithoutPCN && confirmedWithoutPCN.length > 0 && (
        <Card className="border-orange-500/30 bg-orange-500/5">
          <CardContent className="p-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-md bg-orange-500/10">
                  <FileText className="h-5 w-5 text-orange-500" />
                </div>
                <div>
                  <p className="font-medium text-sm">
                    {confirmedWithoutPCN.length} confirmed violation(s) awaiting PCN generation
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Generate PCNs for these confirmed violations
                  </p>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  confirmedWithoutPCN.forEach((e) =>
                    generatePCNMutation.mutate(e.id)
                  );
                }}
                disabled={generatePCNMutation.isPending}
                data-testid="button-generate-all-pcn"
              >
                {generatePCNMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4 mr-2" />
                )}
                Generate All
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by PCN number or plate..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
            data-testid="input-search-pcn"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[140px]" data-testid="select-status-filter">
            <Filter className="h-4 w-4 mr-2" />
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="confirmed">Confirmed</SelectItem>
            <SelectItem value="appealed">Appealed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <Card>
          <div className="p-4 space-y-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-4 w-32" />
              </div>
            ))}
          </div>
        </Card>
      ) : filteredEvents && filteredEvents.filter((e) => e.pcnNumber).length > 0 ? (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>PCN Number</TableHead>
                <TableHead>Plate</TableHead>
                <TableHead>Violation</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Issued</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredEvents
                .filter((e) => e.pcnNumber)
                .map((event) => (
                  <TableRow key={event.id} data-testid={`pcn-row-${event.id}`}>
                    <TableCell>
                      <span className="font-mono font-bold text-sm">
                        {event.pcnNumber}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1 rounded-md border-2 border-yellow-400 bg-yellow-300 px-2 py-0.5 w-fit dark:border-yellow-500 dark:bg-yellow-400">
                        <span className="font-mono text-xs font-bold text-black">
                          {event.plateText || "N/A"}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      {event.violationType && (
                        <ViolationBadge type={event.violationType} showIcon={false} />
                      )}
                    </TableCell>
                    <TableCell>
                      <span className="font-medium">
                        £{event.pcnAmount?.toFixed(2) || "0.00"}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          event.status === "confirmed"
                            ? "default"
                            : event.status === "appealed"
                            ? "secondary"
                            : "outline"
                        }
                      >
                        {event.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <span className="font-mono text-xs text-muted-foreground">
                        {event.pcnIssuedAt
                          ? format(new Date(event.pcnIssuedAt), "dd/MM/yyyy")
                          : "N/A"}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setSelectedPCN(event)}
                          data-testid={`button-view-pcn-${event.id}`}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          data-testid={`button-download-pcn-${event.id}`}
                        >
                          <Download className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          data-testid={`button-print-pcn-${event.id}`}
                        >
                          <Printer className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </Card>
      ) : (
        <EmptyState
          icon={FileText}
          title="No PCNs Generated"
          description="Penalty Charge Notices will appear here once violations are confirmed and PCNs are generated."
        />
      )}

      <Dialog open={!!selectedPCN} onOpenChange={() => setSelectedPCN(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>PCN Details</DialogTitle>
          </DialogHeader>
          {selectedPCN && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">PCN Number</span>
                  <p className="font-mono font-bold">{selectedPCN.pcnNumber}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Vehicle</span>
                  <p className="font-mono font-bold">{selectedPCN.plateText || "N/A"}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Violation Type</span>
                  {selectedPCN.violationType && (
                    <ViolationBadge type={selectedPCN.violationType} className="mt-1" />
                  )}
                </div>
                <div>
                  <span className="text-muted-foreground">Amount</span>
                  <p className="font-bold text-lg">
                    £{selectedPCN.pcnAmount?.toFixed(2) || "0.00"}
                  </p>
                </div>
              </div>

              {selectedPCN.aiExplanation && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium">
                      Violation Explanation
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm">{selectedPCN.aiExplanation}</p>
                  </CardContent>
                </Card>
              )}

              <div className="flex justify-end gap-3">
                <Button variant="outline" data-testid="button-print-pcn-dialog">
                  <Printer className="h-4 w-4 mr-2" />
                  Print
                </Button>
                <Button data-testid="button-download-pcn-dialog">
                  <Download className="h-4 w-4 mr-2" />
                  Download PDF
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
