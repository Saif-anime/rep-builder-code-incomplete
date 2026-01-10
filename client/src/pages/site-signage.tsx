import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute, Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { 
  Upload, FileText, Archive, CheckCircle, 
  AlertTriangle, ArrowLeft, Clock, Eye, RotateCcw, Loader2, File
} from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { ParkingSite, ParkingSiteSignage } from "@shared/schema";

interface SignageWithFiles extends ParkingSiteSignage {
  files?: Array<{
    id: number;
    filePath: string;
    fileType: string;
    extractedText?: string;
    aiAnalysis?: any;
  }>;
}

// Helper function to format enforcement hours object to string
function formatEnforcementHours(hours: any): string {
  if (!hours) return "Not detected";
  if (typeof hours === "string") return hours;
  if (typeof hours === "object") {
    const { start, end, days } = hours;
    let result = "";
    if (start && end) {
      result = `${start} - ${end}`;
    }
    if (Array.isArray(days) && days.length > 0) {
      result += result ? ` (${days.join(", ")})` : days.join(", ");
    }
    return result || "Not detected";
  }
  return "Not detected";
}

export default function SiteSignagePage() {
  const { toast } = useToast();
  const [, params] = useRoute("/sites/:siteId/signage");
  const siteId = params?.siteId ? parseInt(params.siteId) : null;
  
  const [selectedSignage, setSelectedSignage] = useState<SignageWithFiles | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: site } = useQuery<ParkingSite>({
    queryKey: ["/api/parking-sites", siteId],
    enabled: !!siteId,
  });

  const { data: signageList = [], isLoading } = useQuery<SignageWithFiles[]>({
    queryKey: ["/api/sites", siteId, "signage"],
    enabled: !!siteId,
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      setIsUploading(true);
      const formData = new FormData();
      formData.append("file", file);
      const token = localStorage.getItem("auth_token");
      const res = await fetch(`/api/sites/${siteId}/signage/upload`, {
        method: "POST",
        body: formData,
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({ message: "Upload failed" }));
        throw new Error(error.message || "Upload failed");
      }
      return res.json();
    },
    onSuccess: (result) => {
      setIsUploading(false);
      const confidence = result.confidenceScore || 0;
      if (confidence >= 0.6) {
        toast({ title: "PDF processed successfully", description: "Signage rules extracted and saved" });
      } else if (confidence >= 0.3) {
        toast({ 
          title: "PDF processed with low confidence", 
          description: "Some rules may need manual review",
          variant: "default"
        });
      } else {
        toast({ 
          title: "PDF processed", 
          description: "Could not extract clear rules - please review",
          variant: "destructive"
        });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/sites", siteId, "signage"] });
    },
    onError: (error: Error) => {
      setIsUploading(false);
      toast({ title: "Failed to process PDF", description: error.message, variant: "destructive" });
    },
  });

  const archiveMutation = useMutation({
    mutationFn: async (signageId: string) => {
      const res = await apiRequest("POST", `/api/signage/${signageId}/archive`, {});
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Signage archived" });
      queryClient.invalidateQueries({ queryKey: ["/api/sites", siteId, "signage"] });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to archive", description: error.message, variant: "destructive" });
    },
  });

  const activateMutation = useMutation({
    mutationFn: async (signageId: string) => {
      const res = await apiRequest("POST", `/api/signage/${signageId}/activate`, {});
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Signage activated" });
      queryClient.invalidateQueries({ queryKey: ["/api/sites", siteId, "signage"] });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to activate", description: error.message, variant: "destructive" });
    },
  });

  const activeSignage = signageList.filter(s => s.status === "ACTIVE");
  const archivedSignage = signageList.filter(s => s.status === "ARCHIVED");

  const handleFileSelect = (file: File) => {
    if (file.type === "application/pdf" || file.name.endsWith(".pdf")) {
      uploadMutation.mutate(file);
    } else {
      toast({ title: "Invalid file type", description: "Please upload a PDF file", variant: "destructive" });
    }
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelect(e.dataTransfer.files[0]);
    }
  };

  const getConfidenceColor = (score: number) => {
    if (score >= 0.6) return "bg-green-500/10 text-green-700 border-green-200";
    if (score >= 0.3) return "bg-amber-500/10 text-amber-700 border-amber-200";
    return "bg-red-500/10 text-red-700 border-red-200";
  };

  const getConfidenceLabel = (score: number) => {
    if (score >= 0.6) return "High";
    if (score >= 0.3) return "Low";
    return "Very Low";
  };

  if (!siteId) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">Invalid site ID</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/admin/sites">
          <Button variant="ghost" size="icon" data-testid="button-back">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Enforcement Signage</h1>
          <p className="text-muted-foreground" data-testid="text-site-name">
            {site?.siteName || "Loading..."}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-green-600" />
              <div>
                <p className="text-2xl font-bold" data-testid="text-active-count">{activeSignage.length}</p>
                <p className="text-sm text-muted-foreground">Active Signage</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <Archive className="h-5 w-5 text-gray-500" />
              <div>
                <p className="text-2xl font-bold" data-testid="text-archived-count">{archivedSignage.length}</p>
                <p className="text-sm text-muted-foreground">Archived</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              <div>
                <p className="text-2xl font-bold" data-testid="text-low-confidence">
                  {activeSignage.filter(s => (s.confidenceScore || 0) < 0.6).length}
                </p>
                <p className="text-sm text-muted-foreground">Needs Review</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            Upload Signage PDF
          </CardTitle>
          <CardDescription>
            Upload a PDF of your site signage. Rules will be automatically extracted.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div
            className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
              dragActive ? "border-primary bg-primary/5" : "border-muted-foreground/25"
            } ${isUploading ? "opacity-50 pointer-events-none" : "cursor-pointer hover:border-primary/50"}`}
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
            onClick={() => !isUploading && fileInputRef.current?.click()}
            data-testid="upload-dropzone"
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,application/pdf"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0])}
              disabled={isUploading}
            />
            {isUploading ? (
              <div className="flex flex-col items-center gap-3">
                <Loader2 className="h-12 w-12 animate-spin text-primary" />
                <p className="text-lg font-medium">Processing PDF...</p>
                <p className="text-sm text-muted-foreground">Extracting signage rules</p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3">
                <File className="h-12 w-12 text-muted-foreground" />
                <p className="text-lg font-medium">Drop PDF here or click to upload</p>
                <p className="text-sm text-muted-foreground">
                  Max stay, grace period, and enforcement hours will be extracted automatically
                </p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="active" className="w-full">
        <TabsList>
          <TabsTrigger value="active" data-testid="tab-active">
            Active ({activeSignage.length})
          </TabsTrigger>
          <TabsTrigger value="archived" data-testid="tab-archived">
            Archived ({archivedSignage.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="active">
          <Card>
            <CardHeader>
              <CardTitle>Active Signage</CardTitle>
              <CardDescription>
                These signage records are used for enforcement decisions
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : activeSignage.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>No active signage configured</p>
                  <p className="text-sm">Upload a PDF to extract enforcement rules</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {activeSignage.map((signage) => (
                    <SignageCard
                      key={signage.id}
                      signage={signage}
                      onArchive={() => archiveMutation.mutate(signage.id)}
                      onView={() => setSelectedSignage(signage)}
                      getConfidenceColor={getConfidenceColor}
                      getConfidenceLabel={getConfidenceLabel}
                    />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="archived">
          <Card>
            <CardHeader>
              <CardTitle>Archived Signage</CardTitle>
              <CardDescription>
                Historical signage records no longer used for enforcement
              </CardDescription>
            </CardHeader>
            <CardContent>
              {archivedSignage.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Archive className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>No archived signage</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {archivedSignage.map((signage) => (
                    <SignageCard
                      key={signage.id}
                      signage={signage}
                      onActivate={() => activateMutation.mutate(signage.id)}
                      onView={() => setSelectedSignage(signage)}
                      getConfidenceColor={getConfidenceColor}
                      getConfidenceLabel={getConfidenceLabel}
                      isArchived
                    />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={!!selectedSignage} onOpenChange={() => setSelectedSignage(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              {selectedSignage?.title}
            </DialogTitle>
          </DialogHeader>
          {selectedSignage && (
            <ScrollArea className="max-h-[60vh]">
              <div className="space-y-4 pr-4">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant={selectedSignage.status === "ACTIVE" ? "default" : "secondary"}>
                    {selectedSignage.status}
                  </Badge>
                  <Badge className={getConfidenceColor(selectedSignage.confidenceScore || 0)} variant="outline">
                    {getConfidenceLabel(selectedSignage.confidenceScore || 0)} Confidence
                  </Badge>
                </div>

                <Card>
                  <CardHeader className="py-3">
                    <CardTitle className="text-sm">Extracted Rules</CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-sm text-muted-foreground">Max Stay</p>
                        <p className="font-medium">
                          {(selectedSignage.extractedData as any)?.maxStayMinutes 
                            ? `${(selectedSignage.extractedData as any).maxStayMinutes} minutes`
                            : "Not detected"}
                        </p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Grace Period</p>
                        <p className="font-medium">
                          {(selectedSignage.extractedData as any)?.graceMinutes 
                            ? `${(selectedSignage.extractedData as any).graceMinutes} minutes`
                            : "Not detected"}
                        </p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Enforcement Hours</p>
                        <p className="font-medium">
                          {formatEnforcementHours((selectedSignage.extractedData as any)?.enforcementHours)}
                        </p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Confidence Score</p>
                        <div className="flex items-center gap-2">
                          <Progress value={(selectedSignage.confidenceScore || 0) * 100} className="flex-1" />
                          <span className="text-sm font-medium">
                            {((selectedSignage.confidenceScore || 0) * 100).toFixed(0)}%
                          </span>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {(selectedSignage.extractedData as any)?.bayRestrictions?.length > 0 && (
                  <Card>
                    <CardHeader className="py-3">
                      <CardTitle className="text-sm">Bay Restrictions</CardTitle>
                    </CardHeader>
                    <CardContent className="pt-0">
                      <div className="flex flex-wrap gap-2">
                        {(selectedSignage.extractedData as any).bayRestrictions.map((bay: string, i: number) => (
                          <Badge key={i} variant="outline">{bay}</Badge>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {(selectedSignage.extractedData as any)?.paymentTerms && (
                  <Card>
                    <CardHeader className="py-3">
                      <CardTitle className="text-sm">Payment Terms</CardTitle>
                    </CardHeader>
                    <CardContent className="pt-0">
                      <p className="text-sm">{(selectedSignage.extractedData as any).paymentTerms}</p>
                    </CardContent>
                  </Card>
                )}

                {(selectedSignage.extractedData as any)?.rawTextExtracted && (
                  <Card>
                    <CardHeader className="py-3">
                      <CardTitle className="text-sm">Extracted Text</CardTitle>
                    </CardHeader>
                    <CardContent className="pt-0">
                      <pre className="text-xs whitespace-pre-wrap bg-muted p-3 rounded max-h-40 overflow-auto">
                        {(selectedSignage.extractedData as any).rawTextExtracted}
                      </pre>
                    </CardContent>
                  </Card>
                )}

                {(selectedSignage.extractedData as any)?.extractionNotes?.length > 0 && (
                  <Card>
                    <CardHeader className="py-3">
                      <CardTitle className="text-sm">Processing Notes</CardTitle>
                    </CardHeader>
                    <CardContent className="pt-0">
                      <ul className="text-sm space-y-1 list-disc list-inside text-muted-foreground">
                        {(selectedSignage.extractedData as any).extractionNotes.map((note: string, i: number) => (
                          <li key={i}>{note}</li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                )}

                <div className="text-xs text-muted-foreground pt-2 border-t">
                  <p>Created: {selectedSignage.createdAt ? new Date(selectedSignage.createdAt).toLocaleString() : "Unknown"}</p>
                  {selectedSignage.effectiveFrom && (
                    <p>Effective from: {new Date(selectedSignage.effectiveFrom).toLocaleDateString()}</p>
                  )}
                </div>
              </div>
            </ScrollArea>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SignageCard({ 
  signage, 
  onArchive, 
  onActivate,
  onView,
  getConfidenceColor,
  getConfidenceLabel,
  isArchived = false 
}: {
  signage: SignageWithFiles;
  onArchive?: () => void;
  onActivate?: () => void;
  onView: () => void;
  getConfidenceColor: (score: number) => string;
  getConfidenceLabel: (score: number) => string;
  isArchived?: boolean;
}) {
  const extractedData = signage.extractedData as any;
  const confidence = signage.confidenceScore || 0;
  
  return (
    <div className="flex items-center justify-between p-4 border rounded-lg hover-elevate" data-testid={`card-signage-${signage.id}`}>
      <div className="flex items-center gap-4 flex-1 min-w-0">
        <div className="p-2 bg-muted rounded shrink-0">
          <FileText className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-medium truncate">{signage.title}</p>
            <Badge className={getConfidenceColor(confidence)} variant="outline">
              {getConfidenceLabel(confidence)}
            </Badge>
            {confidence < 0.6 && (
              <Badge variant="outline" className="bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400">
                <AlertTriangle className="h-3 w-3 mr-1" />
                Review
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-4 text-sm text-muted-foreground mt-1 flex-wrap">
            {extractedData?.maxStayMinutes && (
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                Max {extractedData.maxStayMinutes}m
              </span>
            )}
            {extractedData?.graceMinutes && (
              <span>Grace: {extractedData.graceMinutes}m</span>
            )}
            {extractedData?.enforcementHours && (
              <span>{formatEnforcementHours(extractedData.enforcementHours)}</span>
            )}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <Button variant="ghost" size="icon" onClick={onView} data-testid={`button-view-${signage.id}`}>
          <Eye className="h-4 w-4" />
        </Button>
        {isArchived ? (
          <Button variant="ghost" size="icon" onClick={onActivate} data-testid={`button-activate-${signage.id}`}>
            <RotateCcw className="h-4 w-4" />
          </Button>
        ) : (
          <Button variant="ghost" size="icon" onClick={onArchive} data-testid={`button-archive-${signage.id}`}>
            <Archive className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
