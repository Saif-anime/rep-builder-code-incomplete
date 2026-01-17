import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  FileText,
  Search,
  Filter,
  Eye,
  Download,
  Printer,
  Receipt,
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
import { EmptyState } from "@/components/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";

interface PCN {
  id: number;
  pcnNumber: string;
  caseId: string;
  siteId: number | null;
  vrm: string;
  status: string;
  eligibility: string;
  amount: number;
  explanation: string | null;
  issuedAt: string | null;
  createdAt: string | null;
}

export default function PCNPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selectedPCN, setSelectedPCN] = useState<PCN | null>(null);

  const { data: pcns, isLoading } = useQuery<PCN[]>({
    queryKey: ["/api/pcns"],
  });

  const filteredPcns = pcns?.filter((p) => {
    const matchesSearch = !searchQuery || 
      p.pcnNumber?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.vrm?.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesStatus = statusFilter === "all" || p.status === statusFilter;
    
    return matchesSearch && matchesStatus;
  });

  const getStatusBadge = (status: string) => {
    switch (status?.toUpperCase()) {
      case "ISSUED":
        return <Badge variant="default">Issued</Badge>;
      case "PAID":
        return <Badge className="bg-green-600">Paid</Badge>;
      case "APPEALED":
        return <Badge variant="secondary">Appealed</Badge>;
      case "CANCELLED":
        return <Badge variant="outline">Cancelled</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

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
            <SelectItem value="ISSUED">Issued</SelectItem>
            <SelectItem value="PAID">Paid</SelectItem>
            <SelectItem value="APPEALED">Appealed</SelectItem>
            <SelectItem value="CANCELLED">Cancelled</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <Card>
          <div className="p-4 space-y-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-24" />
              </div>
            ))}
          </div>
        </Card>
      ) : filteredPcns && filteredPcns.length > 0 ? (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>PCN Number</TableHead>
                <TableHead>Vehicle</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Issued Date</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredPcns.map((pcn) => (
                <TableRow key={pcn.id} data-testid={`pcn-row-${pcn.id}`}>
                  <TableCell>
                    <span className="font-mono font-bold text-sm">
                      {pcn.pcnNumber}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1 rounded-md border-2 border-yellow-400 bg-yellow-300 px-2 py-0.5 w-fit dark:border-yellow-500 dark:bg-yellow-400">
                      <span className="font-mono text-xs font-bold text-black">
                        {pcn.vrm || "N/A"}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="font-medium">
                      £{pcn.amount?.toFixed(2) || "0.00"}
                    </span>
                  </TableCell>
                  <TableCell>
                    {getStatusBadge(pcn.status)}
                  </TableCell>
                  <TableCell>
                    <span className="font-mono text-xs text-muted-foreground">
                      {pcn.issuedAt
                        ? format(new Date(pcn.issuedAt), "dd/MM/yyyy HH:mm")
                        : "N/A"}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setSelectedPCN(pcn)}
                        data-testid={`button-view-pcn-${pcn.id}`}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        data-testid={`button-download-pcn-${pcn.id}`}
                      >
                        <Download className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        data-testid={`button-print-pcn-${pcn.id}`}
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
          icon={Receipt}
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
                  <p className="font-mono font-bold">{selectedPCN.vrm || "N/A"}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Amount</span>
                  <p className="font-bold text-lg">
                    £{selectedPCN.amount?.toFixed(2) || "0.00"}
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground">Status</span>
                  <div className="mt-1">{getStatusBadge(selectedPCN.status)}</div>
                </div>
                <div>
                  <span className="text-muted-foreground">Eligibility</span>
                  <p className="font-medium capitalize">{selectedPCN.eligibility || "Standard"}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Issued</span>
                  <p className="font-mono text-xs">
                    {selectedPCN.issuedAt
                      ? format(new Date(selectedPCN.issuedAt), "dd/MM/yyyy HH:mm")
                      : "N/A"}
                  </p>
                </div>
              </div>

              {selectedPCN.explanation && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium">
                      Violation Explanation
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm">{selectedPCN.explanation}</p>
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
