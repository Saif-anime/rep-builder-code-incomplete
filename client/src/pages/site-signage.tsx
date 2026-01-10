import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute, Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { 
  Plus, Upload, FileText, Image, Archive, CheckCircle, 
  AlertTriangle, ArrowLeft, Clock, Eye, Trash2, RotateCcw
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

export default function SiteSignagePage() {
  const { toast } = useToast();
  const [, params] = useRoute("/sites/:siteId/signage");
  const siteId = params?.siteId ? parseInt(params.siteId) : null;
  
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [selectedSignage, setSelectedSignage] = useState<SignageWithFiles | null>(null);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [newSignage, setNewSignage] = useState({
    title: "",
    signageType: "ENTRANCE" as string,
    maxStayMinutes: "",
    graceMinutes: "",
  });

  const { data: site } = useQuery<ParkingSite>({
    queryKey: ["/api/parking-sites", siteId],
    enabled: !!siteId,
  });

  const { data: signageList = [], isLoading } = useQuery<SignageWithFiles[]>({
    queryKey: ["/api/sites", siteId, "signage"],
    enabled: !!siteId,
  });

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", `/api/sites/${siteId}/signage`, data);
      return res.json();
    },
    onSuccess: async (signage) => {
      toast({ title: "Signage created successfully" });
      setAddDialogOpen(false);
      setNewSignage({ title: "", signageType: "ENTRANCE", maxStayMinutes: "", graceMinutes: "" });
      queryClient.invalidateQueries({ queryKey: ["/api/sites", siteId, "signage"] });
      
      if (uploadFile) {
        await uploadFileMutation.mutateAsync({ signageId: signage.id, file: uploadFile });
        setUploadFile(null);
      }
    },
    onError: (error: Error) => {
      toast({ title: "Failed to create signage", description: error.message, variant: "destructive" });
    },
  });

  const uploadFileMutation = useMutation({
    mutationFn: async ({ signageId, file }: { signageId: string; file: File }) => {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`/api/signage/${signageId}/files`, {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!res.ok) throw new Error("Upload failed");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "File uploaded and analyzed" });
      queryClient.invalidateQueries({ queryKey: ["/api/sites", siteId, "signage"] });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to upload file", description: error.message, variant: "destructive" });
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

  const handleCreateSignage = () => {
    const extractedData: any = {
      maxStayMinutes: newSignage.maxStayMinutes ? parseInt(newSignage.maxStayMinutes) : null,
      graceMinutes: newSignage.graceMinutes ? parseInt(newSignage.graceMinutes) : null,
      enforcementHours: null,
      bayRestrictions: [],
      paymentTerms: null,
      warningLanguage: null,
      rawTextExtracted: null,
      extractionNotes: ["Manually entered by operator"],
    };

    createMutation.mutate({
      title: newSignage.title,
      signageType: newSignage.signageType,
      source: uploadFile ? "IMAGE" : "MANUAL",
      extractedData,
      confidenceScore: uploadFile ? 0 : 1.0,
      displayPriority: newSignage.signageType === "ENTRANCE" ? 5 : (newSignage.signageType === "TERMS" ? 4 : 0),
    });
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case "ENTRANCE": return "bg-blue-500/10 text-blue-700 border-blue-200";
      case "TERMS": return "bg-purple-500/10 text-purple-700 border-purple-200";
      case "BAY": return "bg-green-500/10 text-green-700 border-green-200";
      case "PAYMENT": return "bg-amber-500/10 text-amber-700 border-amber-200";
      case "WARNING": return "bg-red-500/10 text-red-700 border-red-200";
      default: return "bg-gray-500/10 text-gray-700 border-gray-200";
    }
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

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
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
              <FileText className="h-5 w-5 text-blue-600" />
              <div>
                <p className="text-2xl font-bold" data-testid="text-files-count">
                  {signageList.reduce((acc, s) => acc + (s.files?.length || 0), 0)}
                </p>
                <p className="text-sm text-muted-foreground">Files Uploaded</p>
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
                <p className="text-sm text-muted-foreground">Low Confidence</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex justify-end">
        <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-signage">
              <Plus className="h-4 w-4 mr-2" />
              Add Signage
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Add Site Signage</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Title</Label>
                <Input
                  placeholder="e.g., Main Entrance Sign"
                  value={newSignage.title}
                  onChange={(e) => setNewSignage({ ...newSignage, title: e.target.value })}
                  data-testid="input-signage-title"
                />
              </div>
              <div>
                <Label>Type</Label>
                <Select
                  value={newSignage.signageType}
                  onValueChange={(v) => setNewSignage({ ...newSignage, signageType: v })}
                >
                  <SelectTrigger data-testid="select-signage-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ENTRANCE">Entrance Signage</SelectItem>
                    <SelectItem value="TERMS">Terms & Conditions</SelectItem>
                    <SelectItem value="BAY">Bay Restriction</SelectItem>
                    <SelectItem value="PAYMENT">Payment Information</SelectItem>
                    <SelectItem value="WARNING">Warning Notice</SelectItem>
                    <SelectItem value="OTHER">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Max Stay (minutes)</Label>
                  <Input
                    type="number"
                    placeholder="e.g., 120"
                    value={newSignage.maxStayMinutes}
                    onChange={(e) => setNewSignage({ ...newSignage, maxStayMinutes: e.target.value })}
                    data-testid="input-max-stay"
                  />
                </div>
                <div>
                  <Label>Grace Period (minutes)</Label>
                  <Input
                    type="number"
                    placeholder="e.g., 10"
                    value={newSignage.graceMinutes}
                    onChange={(e) => setNewSignage({ ...newSignage, graceMinutes: e.target.value })}
                    data-testid="input-grace-period"
                  />
                </div>
              </div>
              <div>
                <Label>Upload Photo/PDF (optional)</Label>
                <div className="mt-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*,.pdf"
                    className="hidden"
                    onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full"
                    data-testid="button-upload-file"
                  >
                    <Upload className="h-4 w-4 mr-2" />
                    {uploadFile ? uploadFile.name : "Select File"}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Upload signage photo for automatic rule extraction
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAddDialogOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleCreateSignage}
                disabled={!newSignage.title || createMutation.isPending}
                data-testid="button-save-signage"
              >
                {createMutation.isPending ? "Creating..." : "Create Signage"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

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
              {activeSignage.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>No active signage configured</p>
                  <p className="text-sm">Add signage to enable rule-based enforcement</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {activeSignage.map((signage) => (
                    <SignageCard
                      key={signage.id}
                      signage={signage}
                      onArchive={() => archiveMutation.mutate(signage.id)}
                      onView={() => setSelectedSignage(signage)}
                      getTypeColor={getTypeColor}
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
                <div className="space-y-4">
                  {archivedSignage.map((signage) => (
                    <SignageCard
                      key={signage.id}
                      signage={signage}
                      onActivate={() => activateMutation.mutate(signage.id)}
                      onView={() => setSelectedSignage(signage)}
                      getTypeColor={getTypeColor}
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
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{selectedSignage?.title}</DialogTitle>
          </DialogHeader>
          {selectedSignage && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Badge className={getTypeColor(selectedSignage.signageType)}>
                  {selectedSignage.signageType}
                </Badge>
                <Badge variant={selectedSignage.status === "ACTIVE" ? "default" : "secondary"}>
                  {selectedSignage.status}
                </Badge>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-muted-foreground">Max Stay</Label>
                  <p className="font-medium">
                    {(selectedSignage.extractedData as any)?.maxStayMinutes 
                      ? `${(selectedSignage.extractedData as any).maxStayMinutes} minutes`
                      : "Not specified"}
                  </p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Grace Period</Label>
                  <p className="font-medium">
                    {(selectedSignage.extractedData as any)?.graceMinutes 
                      ? `${(selectedSignage.extractedData as any).graceMinutes} minutes`
                      : "Not specified"}
                  </p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Confidence</Label>
                  <div className="flex items-center gap-2">
                    <Progress value={(selectedSignage.confidenceScore || 0) * 100} className="flex-1" />
                    <span className="text-sm font-medium">
                      {((selectedSignage.confidenceScore || 0) * 100).toFixed(0)}%
                    </span>
                  </div>
                </div>
                <div>
                  <Label className="text-muted-foreground">Effective From</Label>
                  <p className="font-medium">
                    {selectedSignage.effectiveFrom 
                      ? new Date(selectedSignage.effectiveFrom).toLocaleDateString()
                      : "Not set"}
                  </p>
                </div>
              </div>

              {selectedSignage.files && selectedSignage.files.length > 0 && (
                <div>
                  <Label className="text-muted-foreground">Uploaded Files</Label>
                  <div className="mt-2 space-y-2">
                    {selectedSignage.files.map((file) => (
                      <div key={file.id} className="flex items-center gap-2 p-2 border rounded">
                        {file.fileType === "image" ? (
                          <Image className="h-4 w-4" />
                        ) : (
                          <FileText className="h-4 w-4" />
                        )}
                        <span className="text-sm">{file.filePath.split("/").pop()}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {(selectedSignage.extractedData as any)?.extractionNotes?.length > 0 && (
                <div>
                  <Label className="text-muted-foreground">Notes</Label>
                  <ul className="mt-1 text-sm space-y-1">
                    {(selectedSignage.extractedData as any).extractionNotes.map((note: string, i: number) => (
                      <li key={i} className="text-muted-foreground">{note}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
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
  getTypeColor,
  isArchived = false 
}: {
  signage: SignageWithFiles;
  onArchive?: () => void;
  onActivate?: () => void;
  onView: () => void;
  getTypeColor: (type: string) => string;
  isArchived?: boolean;
}) {
  const extractedData = signage.extractedData as any;
  
  return (
    <div className="flex items-center justify-between p-4 border rounded-lg hover-elevate" data-testid={`card-signage-${signage.id}`}>
      <div className="flex items-center gap-4">
        <div className="p-2 bg-muted rounded">
          <FileText className="h-5 w-5" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <p className="font-medium">{signage.title}</p>
            <Badge className={getTypeColor(signage.signageType)} variant="outline">
              {signage.signageType}
            </Badge>
          </div>
          <div className="flex items-center gap-4 text-sm text-muted-foreground mt-1">
            {extractedData?.maxStayMinutes && (
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                Max {extractedData.maxStayMinutes}m
              </span>
            )}
            {extractedData?.graceMinutes && (
              <span>Grace: {extractedData.graceMinutes}m</span>
            )}
            <span>
              Confidence: {((signage.confidenceScore || 0) * 100).toFixed(0)}%
            </span>
            {signage.files && signage.files.length > 0 && (
              <span>{signage.files.length} file(s)</span>
            )}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
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
