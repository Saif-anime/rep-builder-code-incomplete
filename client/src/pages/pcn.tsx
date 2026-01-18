import { useState, useCallback } from "react";
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
import { useToast } from "@/hooks/use-toast";
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
  const { toast } = useToast();

  const { data: pcns, isLoading } = useQuery<PCN[]>({
    queryKey: ["/api/pcns"],
  });

  const generatePCNContent = useCallback((pcn: PCN) => {
    const issuedDate = pcn.issuedAt 
      ? new Date(pcn.issuedAt).toLocaleDateString('en-GB', { 
          day: '2-digit', month: '2-digit', year: 'numeric', 
          hour: '2-digit', minute: '2-digit' 
        })
      : 'N/A';
    
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <title>PCN ${pcn.pcnNumber}</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 40px; max-width: 800px; margin: 0 auto; }
          .header { text-align: center; border-bottom: 2px solid #1e40af; padding-bottom: 20px; margin-bottom: 30px; }
          .header h1 { color: #1e40af; margin: 0; font-size: 24px; }
          .header p { color: #666; margin: 5px 0 0; }
          .pcn-number { background: #1e40af; color: white; padding: 10px 20px; font-size: 18px; font-weight: bold; display: inline-block; margin: 20px 0; }
          .details { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 30px; }
          .detail-box { border: 1px solid #ddd; padding: 15px; border-radius: 5px; }
          .detail-box label { color: #666; font-size: 12px; display: block; margin-bottom: 5px; }
          .detail-box .value { font-size: 16px; font-weight: bold; }
          .vrm { background: #fcd34d; border: 2px solid #f59e0b; padding: 8px 15px; font-family: monospace; font-weight: bold; display: inline-block; }
          .amount { color: #dc2626; font-size: 24px; }
          .explanation { background: #f3f4f6; padding: 20px; border-radius: 5px; margin-top: 20px; }
          .explanation h3 { margin-top: 0; color: #374151; }
          .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #ddd; font-size: 12px; color: #666; text-align: center; }
          @media print { body { padding: 20px; } }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>PENALTY CHARGE NOTICE</h1>
          <p>Euro Parking Services</p>
        </div>
        
        <div style="text-align: center;">
          <div class="pcn-number">${pcn.pcnNumber}</div>
        </div>
        
        <div class="details">
          <div class="detail-box">
            <label>Vehicle Registration</label>
            <div class="vrm">${pcn.vrm || 'N/A'}</div>
          </div>
          <div class="detail-box">
            <label>Amount Due</label>
            <div class="value amount">£${pcn.amount?.toFixed(2) || '0.00'}</div>
          </div>
          <div class="detail-box">
            <label>Status</label>
            <div class="value">${pcn.status}</div>
          </div>
          <div class="detail-box">
            <label>Date Issued</label>
            <div class="value">${issuedDate}</div>
          </div>
          <div class="detail-box">
            <label>Case Reference</label>
            <div class="value">${pcn.caseId || 'N/A'}</div>
          </div>
          <div class="detail-box">
            <label>Eligibility</label>
            <div class="value">${pcn.eligibility || 'Standard'}</div>
          </div>
        </div>
        
        ${pcn.explanation ? `
        <div class="explanation">
          <h3>Violation Details</h3>
          <p>${pcn.explanation}</p>
        </div>
        ` : ''}
        
        <div class="footer">
          <p>This is an official Penalty Charge Notice issued by Euro Parking Services.</p>
          <p>For queries or appeals, please quote your PCN number: ${pcn.pcnNumber}</p>
        </div>
      </body>
      </html>
    `;
  }, []);

  const handleDownload = useCallback((pcn: PCN) => {
    const content = generatePCNContent(pcn);
    const blob = new Blob([content], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `PCN-${pcn.pcnNumber}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    toast({
      title: "PCN Downloaded",
      description: `${pcn.pcnNumber} has been downloaded successfully.`,
    });
  }, [generatePCNContent, toast]);

  const handlePrint = useCallback((pcn: PCN) => {
    const content = generatePCNContent(pcn);
    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(content);
      printWindow.document.close();
      printWindow.focus();
      setTimeout(() => {
        printWindow.print();
      }, 250);
    } else {
      toast({
        title: "Print Failed",
        description: "Please allow pop-ups to print the PCN.",
        variant: "destructive",
      });
    }
  }, [generatePCNContent, toast]);

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
                        onClick={() => handleDownload(pcn)}
                        title="Download PCN"
                        data-testid={`button-download-pcn-${pcn.id}`}
                      >
                        <Download className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handlePrint(pcn)}
                        title="Print PCN"
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
                <Button 
                  variant="outline" 
                  onClick={() => handlePrint(selectedPCN)}
                  data-testid="button-print-pcn-dialog"
                >
                  <Printer className="h-4 w-4 mr-2" />
                  Print
                </Button>
                <Button 
                  onClick={() => handleDownload(selectedPCN)}
                  data-testid="button-download-pcn-dialog"
                >
                  <Download className="h-4 w-4 mr-2" />
                  Download
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
