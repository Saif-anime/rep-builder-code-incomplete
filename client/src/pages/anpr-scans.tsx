import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { FolderSearch, Car, RefreshCw, Loader2, CheckCircle, XCircle, Eye, Trash2 } from "lucide-react";

interface AnprScan {
  id: number;
  folder_path: string;
  image_filename: string;
  image_path: string;
  vrm: string | null;
  vrm_confidence: number | null;
  timestamp_extracted: string | null;
  dvla_make: string | null;
  dvla_model: string | null;
  dvla_colour: string | null;
  dvla_fuel_type: string | null;
  dvla_tax_status: string | null;
  dvla_mot_status: string | null;
  dvla_year: number | null;
  dvla_verified: boolean;
  dvla_error: string | null;
  status: string;
  error_message: string | null;
  created_at: string;
}

export default function AnprScansPage() {
  const { toast } = useToast();
  const [folderPath, setFolderPath] = useState("");
  const [runDvla, setRunDvla] = useState(true);
  const [selectedScan, setSelectedScan] = useState<AnprScan | null>(null);

  const { data: scansData, isLoading } = useQuery<{ success: boolean; scans: AnprScan[]; total: number }>({
    queryKey: ["/api/anpr/scans"],
  });

  const scanMutation = useMutation({
    mutationFn: async (data: { folder_path: string; run_dvla: boolean }) => {
      const res = await apiRequest("POST", "/api/anpr/scan", data);
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/anpr/scans"] });
      toast({
        title: "Scan Complete",
        description: `Processed ${data.images_processed} of ${data.images_found} images`,
      });
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: "Scan Failed",
        description: error.message,
      });
    },
  });

  const clearMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("DELETE", "/api/anpr/scans");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/anpr/scans"] });
      toast({ title: "Cleared", description: "All scan records deleted" });
    },
  });

  const handleScan = () => {
    if (!folderPath.trim()) {
      toast({ variant: "destructive", title: "Error", description: "Please enter a folder path" });
      return;
    }
    scanMutation.mutate({ folder_path: folderPath, run_dvla: runDvla });
  };

  const scans = scansData?.scans || [];

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Car className="h-6 w-6" />
          ANPR Folder Scanner
        </h1>
        <p className="text-muted-foreground">
          Scan a folder of images to extract VRMs and fetch DVLA vehicle data
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FolderSearch className="h-5 w-5" />
            Scan Folder
          </CardTitle>
          <CardDescription>
            Enter the full path to a folder containing ANPR camera images
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-4">
            <Input
              placeholder="D:\ANPR-FTP\incoming\Camera01"
              value={folderPath}
              onChange={(e) => setFolderPath(e.target.value)}
              className="flex-1"
              data-testid="input-folder-path"
            />
            <Button
              onClick={handleScan}
              disabled={scanMutation.isPending}
              data-testid="button-scan-folder"
            >
              {scanMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Scanning...
                </>
              ) : (
                <>
                  <FolderSearch className="h-4 w-4 mr-2" />
                  Scan Folder
                </>
              )}
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="run-dvla"
              checked={runDvla}
              onCheckedChange={(checked) => setRunDvla(checked === true)}
              data-testid="checkbox-run-dvla"
            />
            <Label htmlFor="run-dvla" className="text-sm">
              Automatically lookup DVLA data for extracted VRMs
            </Label>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <div>
            <CardTitle>Scan Results</CardTitle>
            <CardDescription>
              {scansData?.total || 0} total records
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => queryClient.invalidateQueries({ queryKey: ["/api/anpr/scans"] })}
              data-testid="button-refresh-scans"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => clearMutation.mutate()}
              disabled={clearMutation.isPending}
              data-testid="button-clear-scans"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : scans.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Car className="h-12 w-12 mb-4 opacity-50" />
              <p>No scan results yet</p>
              <p className="text-sm">Enter a folder path and click Scan</p>
            </div>
          ) : (
            <ScrollArea className="h-[500px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>VRM</TableHead>
                    <TableHead>Confidence</TableHead>
                    <TableHead>Make / Model</TableHead>
                    <TableHead>Colour</TableHead>
                    <TableHead>Tax</TableHead>
                    <TableHead>MOT</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {scans.map((scan) => (
                    <TableRow key={scan.id} data-testid={`row-scan-${scan.id}`}>
                      <TableCell className="font-mono font-bold text-lg">
                        {scan.vrm || "-"}
                      </TableCell>
                      <TableCell>
                        {scan.vrm_confidence ? (
                          <Badge variant={scan.vrm_confidence >= 80 ? "default" : "secondary"}>
                            {Math.round(scan.vrm_confidence)}%
                          </Badge>
                        ) : (
                          "-"
                        )}
                      </TableCell>
                      <TableCell>
                        {scan.dvla_make && scan.dvla_model
                          ? `${scan.dvla_make} ${scan.dvla_model}`
                          : scan.dvla_make || "-"}
                      </TableCell>
                      <TableCell>{scan.dvla_colour || "-"}</TableCell>
                      <TableCell>
                        {scan.dvla_tax_status ? (
                          <Badge
                            variant={scan.dvla_tax_status === "Taxed" ? "default" : "destructive"}
                          >
                            {scan.dvla_tax_status}
                          </Badge>
                        ) : (
                          "-"
                        )}
                      </TableCell>
                      <TableCell>
                        {scan.dvla_mot_status ? (
                          <Badge
                            variant={scan.dvla_mot_status === "Valid" ? "default" : "destructive"}
                          >
                            {scan.dvla_mot_status}
                          </Badge>
                        ) : (
                          "-"
                        )}
                      </TableCell>
                      <TableCell>
                        {scan.status === "completed" ? (
                          <CheckCircle className="h-4 w-4 text-green-500" />
                        ) : scan.status === "error" ? (
                          <XCircle className="h-4 w-4 text-red-500" />
                        ) : (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => setSelectedScan(scan)}
                          data-testid={`button-view-scan-${scan.id}`}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!selectedScan} onOpenChange={() => setSelectedScan(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Car className="h-5 w-5" />
              Scan Details: {selectedScan?.vrm || "Unknown VRM"}
            </DialogTitle>
          </DialogHeader>
          {selectedScan && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-muted-foreground text-xs">Image File</Label>
                  <p className="font-mono text-sm">{selectedScan.image_filename}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground text-xs">VRM Confidence</Label>
                  <p className="font-bold">{selectedScan.vrm_confidence ? `${Math.round(selectedScan.vrm_confidence)}%` : "-"}</p>
                </div>
              </div>
              
              <div className="border-t pt-4">
                <h4 className="font-semibold mb-3">DVLA Vehicle Data</h4>
                {selectedScan.dvla_verified ? (
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <Label className="text-muted-foreground text-xs">Make</Label>
                      <p>{selectedScan.dvla_make || "-"}</p>
                    </div>
                    <div>
                      <Label className="text-muted-foreground text-xs">Model</Label>
                      <p>{selectedScan.dvla_model || "-"}</p>
                    </div>
                    <div>
                      <Label className="text-muted-foreground text-xs">Colour</Label>
                      <p>{selectedScan.dvla_colour || "-"}</p>
                    </div>
                    <div>
                      <Label className="text-muted-foreground text-xs">Year</Label>
                      <p>{selectedScan.dvla_year || "-"}</p>
                    </div>
                    <div>
                      <Label className="text-muted-foreground text-xs">Fuel Type</Label>
                      <p>{selectedScan.dvla_fuel_type || "-"}</p>
                    </div>
                    <div>
                      <Label className="text-muted-foreground text-xs">Tax Status</Label>
                      <Badge variant={selectedScan.dvla_tax_status === "Taxed" ? "default" : "destructive"}>
                        {selectedScan.dvla_tax_status || "-"}
                      </Badge>
                    </div>
                    <div>
                      <Label className="text-muted-foreground text-xs">MOT Status</Label>
                      <Badge variant={selectedScan.dvla_mot_status === "Valid" ? "default" : "destructive"}>
                        {selectedScan.dvla_mot_status || "-"}
                      </Badge>
                    </div>
                  </div>
                ) : (
                  <p className="text-muted-foreground text-sm">
                    {selectedScan.dvla_error || "DVLA data not available"}
                  </p>
                )}
              </div>

              <div className="border-t pt-4">
                <Label className="text-muted-foreground text-xs">Full Image Path</Label>
                <p className="font-mono text-xs break-all">{selectedScan.image_path}</p>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
