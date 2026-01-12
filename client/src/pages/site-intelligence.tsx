import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute, Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { 
  ArrowLeft, Plus, Trash2, Edit, Upload, Image, Video, 
  FileText, Map, AlertTriangle, Car, Clock, Loader2,
  Eye, Lightbulb, MapPin
} from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface SiteIntelligenceBay {
  id: number;
  siteId: number;
  bayIdentifier: string;
  bayType: string;
  zone: string | null;
  signageClarityScore: number;
  markingConditionScore: number;
  commonMisusePatterns: string[];
  notes: string | null;
  isActive: boolean;
}

interface SiteBehaviorPattern {
  id: number;
  siteId: number;
  patternType: string;
  description: string;
  peakTimes: string[];
  affectedBays: string[];
  frequency: string | null;
  severity: string;
  notes: string | null;
  isActive: boolean;
}

interface SiteAttachment {
  id: number;
  siteId: number;
  bayId: number | null;
  attachmentType: string;
  category: string;
  title: string;
  description: string | null;
  filePath: string;
  fileType: string | null;
  mimeType: string | null;
  fileSize: number | null;
}

interface SiteIntelligenceData {
  siteId: number;
  siteName: string;
  bays: SiteIntelligenceBay[];
  behaviorPatterns: SiteBehaviorPattern[];
  attachments: SiteAttachment[];
  summary: {
    totalBays: number;
    totalPatterns: number;
    totalAttachments: number;
  };
}

const BAY_TYPES = ["Disabled", "EV Charging", "Parent & Child", "Permit", "Loading", "Standard"];
const PATTERN_TYPES = ["Overstay", "Unauthorized Parking", "Bay Misuse", "Peak Congestion", "Permit Violation"];
const ATTACHMENT_CATEGORIES = ["BAY_PHOTO", "SIGNAGE_PHOTO", "SITE_MAP", "WALKTHROUGH", "OTHER"];
const SEVERITY_LEVELS = ["LOW", "MEDIUM", "HIGH"];

export default function SiteIntelligencePage() {
  const { toast } = useToast();
  const [, params] = useRoute("/sites/:siteId/intelligence");
  const siteId = params?.siteId ? parseInt(params.siteId) : null;
  
  const [activeTab, setActiveTab] = useState("bays");
  const [bayDialogOpen, setBayDialogOpen] = useState(false);
  const [patternDialogOpen, setPatternDialogOpen] = useState(false);
  const [editingBay, setEditingBay] = useState<SiteIntelligenceBay | null>(null);
  const [editingPattern, setEditingPattern] = useState<SiteBehaviorPattern | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadCategory, setUploadCategory] = useState("BAY_PHOTO");
  const [aiInstructions, setAiInstructions] = useState("");

  const [bayForm, setBayForm] = useState({
    bayIdentifier: "",
    bayType: "Standard",
    zone: "",
    signageClarityScore: 3,
    markingConditionScore: 3,
    commonMisusePatterns: [] as string[],
    notes: ""
  });

  const [patternForm, setPatternForm] = useState({
    patternType: "Overstay",
    description: "",
    peakTimes: [] as string[],
    affectedBays: [] as string[],
    frequency: "",
    severity: "MEDIUM",
    notes: ""
  });

  const { data: intelligence, isLoading } = useQuery<SiteIntelligenceData>({
    queryKey: ["/api/sites", siteId, "intelligence"],
    enabled: !!siteId,
  });

  const { data: aiInstructionsData } = useQuery<{ siteId: number; siteName: string; aiInstructions: string }>({
    queryKey: ["/api/sites", siteId, "intelligence", "ai-instructions"],
    enabled: !!siteId,
  });

  useEffect(() => {
    if (aiInstructionsData) {
      setAiInstructions(aiInstructionsData.aiInstructions || "");
    }
  }, [aiInstructionsData, siteId]);

  const saveAiInstructionsMutation = useMutation({
    mutationFn: async (instructions: string) => {
      const res = await apiRequest("PUT", `/api/sites/${siteId}/intelligence/ai-instructions`, { aiInstructions: instructions });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "AI Instructions saved successfully" });
      queryClient.invalidateQueries({ queryKey: ["/api/sites", siteId, "intelligence", "ai-instructions"] });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to save AI instructions", description: error.message, variant: "destructive" });
    }
  });

  const createBayMutation = useMutation({
    mutationFn: async (data: typeof bayForm) => {
      const res = await apiRequest("POST", `/api/sites/${siteId}/intelligence/bays`, data);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Bay added successfully" });
      queryClient.invalidateQueries({ queryKey: ["/api/sites", siteId, "intelligence"] });
      setBayDialogOpen(false);
      resetBayForm();
    },
    onError: (error: Error) => {
      toast({ title: "Failed to add bay", description: error.message, variant: "destructive" });
    }
  });

  const updateBayMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: typeof bayForm }) => {
      const res = await apiRequest("PUT", `/api/sites/${siteId}/intelligence/bays/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Bay updated successfully" });
      queryClient.invalidateQueries({ queryKey: ["/api/sites", siteId, "intelligence"] });
      setBayDialogOpen(false);
      setEditingBay(null);
      resetBayForm();
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update bay", description: error.message, variant: "destructive" });
    }
  });

  const deleteBayMutation = useMutation({
    mutationFn: async (bayId: number) => {
      const res = await apiRequest("DELETE", `/api/sites/${siteId}/intelligence/bays/${bayId}`, {});
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Bay removed" });
      queryClient.invalidateQueries({ queryKey: ["/api/sites", siteId, "intelligence"] });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to remove bay", description: error.message, variant: "destructive" });
    }
  });

  const createPatternMutation = useMutation({
    mutationFn: async (data: typeof patternForm) => {
      const res = await apiRequest("POST", `/api/sites/${siteId}/intelligence/patterns`, data);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Behavior pattern added" });
      queryClient.invalidateQueries({ queryKey: ["/api/sites", siteId, "intelligence"] });
      setPatternDialogOpen(false);
      resetPatternForm();
    },
    onError: (error: Error) => {
      toast({ title: "Failed to add pattern", description: error.message, variant: "destructive" });
    }
  });

  const updatePatternMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: typeof patternForm }) => {
      const res = await apiRequest("PUT", `/api/sites/${siteId}/intelligence/patterns/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Pattern updated successfully" });
      queryClient.invalidateQueries({ queryKey: ["/api/sites", siteId, "intelligence"] });
      setPatternDialogOpen(false);
      setEditingPattern(null);
      resetPatternForm();
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update pattern", description: error.message, variant: "destructive" });
    }
  });

  const deletePatternMutation = useMutation({
    mutationFn: async (patternId: number) => {
      const res = await apiRequest("DELETE", `/api/sites/${siteId}/intelligence/patterns/${patternId}`, {});
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Pattern removed" });
      queryClient.invalidateQueries({ queryKey: ["/api/sites", siteId, "intelligence"] });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to remove pattern", description: error.message, variant: "destructive" });
    }
  });

  const deleteAttachmentMutation = useMutation({
    mutationFn: async (attachmentId: number) => {
      const res = await apiRequest("DELETE", `/api/sites/${siteId}/intelligence/attachments/${attachmentId}`, {});
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Attachment deleted" });
      queryClient.invalidateQueries({ queryKey: ["/api/sites", siteId, "intelligence"] });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to delete attachment", description: error.message, variant: "destructive" });
    }
  });

  const resetBayForm = () => {
    setBayForm({
      bayIdentifier: "",
      bayType: "Standard",
      zone: "",
      signageClarityScore: 3,
      markingConditionScore: 3,
      commonMisusePatterns: [],
      notes: ""
    });
  };

  const resetPatternForm = () => {
    setPatternForm({
      patternType: "Overstay",
      description: "",
      peakTimes: [],
      affectedBays: [],
      frequency: "",
      severity: "MEDIUM",
      notes: ""
    });
  };

  const handleEditBay = (bay: SiteIntelligenceBay) => {
    setEditingBay(bay);
    setBayForm({
      bayIdentifier: bay.bayIdentifier,
      bayType: bay.bayType,
      zone: bay.zone || "",
      signageClarityScore: bay.signageClarityScore,
      markingConditionScore: bay.markingConditionScore,
      commonMisusePatterns: bay.commonMisusePatterns || [],
      notes: bay.notes || ""
    });
    setBayDialogOpen(true);
  };

  const handleEditPattern = (pattern: SiteBehaviorPattern) => {
    setEditingPattern(pattern);
    setPatternForm({
      patternType: pattern.patternType,
      description: pattern.description,
      peakTimes: pattern.peakTimes || [],
      affectedBays: pattern.affectedBays || [],
      frequency: pattern.frequency || "",
      severity: pattern.severity,
      notes: pattern.notes || ""
    });
    setPatternDialogOpen(true);
  };

  const handleFileUpload = async (file: File, title: string) => {
    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("category", uploadCategory);
      formData.append("title", title || file.name);
      
      const token = localStorage.getItem("auth_token");
      const res = await fetch(`/api/sites/${siteId}/intelligence/attachments`, {
        method: "POST",
        body: formData,
        headers: { Authorization: `Bearer ${token}` }
      });
      
      if (!res.ok) {
        throw new Error("Upload failed");
      }
      
      toast({ title: "File uploaded successfully" });
      queryClient.invalidateQueries({ queryKey: ["/api/sites", siteId, "intelligence"] });
    } catch (error: any) {
      toast({ title: "Upload failed", description: error.message, variant: "destructive" });
    } finally {
      setIsUploading(false);
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 4) return "text-green-600 dark:text-green-400";
    if (score >= 3) return "text-yellow-600 dark:text-yellow-400";
    return "text-red-600 dark:text-red-400";
  };

  const getScoreLabel = (score: number) => {
    if (score >= 5) return "Excellent";
    if (score >= 4) return "Good";
    if (score >= 3) return "Average";
    if (score >= 2) return "Poor";
    return "Very Poor";
  };

  const getSeverityVariant = (severity: string) => {
    switch (severity) {
      case "HIGH": return "destructive";
      case "MEDIUM": return "default";
      default: return "secondary";
    }
  };

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case "BAY_PHOTO": return <Car className="h-4 w-4" />;
      case "SIGNAGE_PHOTO": return <FileText className="h-4 w-4" />;
      case "SITE_MAP": return <Map className="h-4 w-4" />;
      case "WALKTHROUGH": return <Video className="h-4 w-4" />;
      default: return <Image className="h-4 w-4" />;
    }
  };

  if (!siteId) {
    return <div className="p-6">Invalid site ID</div>;
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Link href="/parking-sites">
            <Button variant="ghost" size="icon" data-testid="button-back">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold">Site Intelligence</h1>
            <p className="text-muted-foreground">{intelligence?.siteName || "Loading..."}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="gap-1">
            <Lightbulb className="h-3 w-3" />
            {intelligence?.summary.totalBays || 0} Bays
          </Badge>
          <Badge variant="outline" className="gap-1">
            <AlertTriangle className="h-3 w-3" />
            {intelligence?.summary.totalPatterns || 0} Patterns
          </Badge>
          <Badge variant="outline" className="gap-1">
            <Image className="h-3 w-3" />
            {intelligence?.summary.totalAttachments || 0} Attachments
          </Badge>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="bays" data-testid="tab-bays">Bay Details</TabsTrigger>
          <TabsTrigger value="patterns" data-testid="tab-patterns">Behavior Patterns</TabsTrigger>
          <TabsTrigger value="attachments" data-testid="tab-attachments">Attachments</TabsTrigger>
          <TabsTrigger value="ai-instructions" data-testid="tab-ai-instructions">AI Instructions</TabsTrigger>
        </TabsList>

        <TabsContent value="bays" className="space-y-4">
          <div className="flex justify-between items-center">
            <p className="text-sm text-muted-foreground">
              Define bay-level intelligence with signage and marking clarity scores
            </p>
            <Button onClick={() => { resetBayForm(); setEditingBay(null); setBayDialogOpen(true); }} data-testid="button-add-bay">
              <Plus className="h-4 w-4 mr-2" />
              Add Bay
            </Button>
          </div>

          {(!intelligence?.bays || intelligence.bays.length === 0) ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <MapPin className="h-12 w-12 text-muted-foreground mb-4" />
                <p className="text-muted-foreground">No bay intelligence recorded yet</p>
                <Button className="mt-4" onClick={() => { resetBayForm(); setBayDialogOpen(true); }}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add First Bay
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {intelligence.bays.filter(b => b.isActive).map((bay) => (
                <Card key={bay.id} data-testid={`card-bay-${bay.id}`}>
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <CardTitle className="text-base">{bay.bayIdentifier}</CardTitle>
                        <CardDescription>{bay.bayType}</CardDescription>
                      </div>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" onClick={() => handleEditBay(bay)} data-testid={`button-edit-bay-${bay.id}`}>
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => deleteBayMutation.mutate(bay.id)} data-testid={`button-delete-bay-${bay.id}`}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {bay.zone && (
                      <div className="text-sm">
                        <span className="text-muted-foreground">Zone:</span> {bay.zone}
                      </div>
                    )}
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Signage Clarity</span>
                        <span className={getScoreColor(bay.signageClarityScore)}>
                          {bay.signageClarityScore}/5 - {getScoreLabel(bay.signageClarityScore)}
                        </span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Marking Condition</span>
                        <span className={getScoreColor(bay.markingConditionScore)}>
                          {bay.markingConditionScore}/5 - {getScoreLabel(bay.markingConditionScore)}
                        </span>
                      </div>
                    </div>
                    {bay.commonMisusePatterns && bay.commonMisusePatterns.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {bay.commonMisusePatterns.map((pattern, idx) => (
                          <Badge key={idx} variant="secondary" className="text-xs">{pattern}</Badge>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="patterns" className="space-y-4">
          <div className="flex justify-between items-center">
            <p className="text-sm text-muted-foreground">
              Record observed motorist behavior patterns at this site
            </p>
            <Button onClick={() => { resetPatternForm(); setEditingPattern(null); setPatternDialogOpen(true); }} data-testid="button-add-pattern">
              <Plus className="h-4 w-4 mr-2" />
              Add Pattern
            </Button>
          </div>

          {(!intelligence?.behaviorPatterns || intelligence.behaviorPatterns.length === 0) ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <AlertTriangle className="h-12 w-12 text-muted-foreground mb-4" />
                <p className="text-muted-foreground">No behavior patterns recorded yet</p>
                <Button className="mt-4" onClick={() => { resetPatternForm(); setPatternDialogOpen(true); }}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add First Pattern
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {intelligence.behaviorPatterns.filter(p => p.isActive).map((pattern) => (
                <Card key={pattern.id} data-testid={`card-pattern-${pattern.id}`}>
                  <CardContent className="py-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 space-y-2">
                        <div className="flex items-center gap-2">
                          <Badge variant={getSeverityVariant(pattern.severity)}>{pattern.severity}</Badge>
                          <span className="font-medium">{pattern.patternType}</span>
                        </div>
                        <p className="text-sm text-muted-foreground">{pattern.description}</p>
                        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                          {pattern.frequency && (
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {pattern.frequency}
                            </span>
                          )}
                          {pattern.peakTimes && pattern.peakTimes.length > 0 && (
                            <span>Peak: {pattern.peakTimes.join(", ")}</span>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" onClick={() => handleEditPattern(pattern)} data-testid={`button-edit-pattern-${pattern.id}`}>
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => deletePatternMutation.mutate(pattern.id)} data-testid={`button-delete-pattern-${pattern.id}`}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="attachments" className="space-y-4">
          <div className="flex justify-between items-center gap-4">
            <p className="text-sm text-muted-foreground">
              Upload bay photos, signage photos, site maps, and walkthrough videos
            </p>
            <div className="flex items-center gap-2">
              <Select value={uploadCategory} onValueChange={setUploadCategory}>
                <SelectTrigger className="w-40" data-testid="select-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="BAY_PHOTO">Bay Photo</SelectItem>
                  <SelectItem value="SIGNAGE_PHOTO">Signage Photo</SelectItem>
                  <SelectItem value="SITE_MAP">Site Map</SelectItem>
                  <SelectItem value="WALKTHROUGH">Walkthrough</SelectItem>
                  <SelectItem value="OTHER">Other</SelectItem>
                </SelectContent>
              </Select>
              <input
                type="file"
                ref={fileInputRef}
                className="hidden"
                accept="image/*,video/*,.pdf"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFileUpload(file, file.name);
                }}
              />
              <Button onClick={() => fileInputRef.current?.click()} disabled={isUploading} data-testid="button-upload">
                {isUploading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
                Upload
              </Button>
            </div>
          </div>

          {(!intelligence?.attachments || intelligence.attachments.length === 0) ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Image className="h-12 w-12 text-muted-foreground mb-4" />
                <p className="text-muted-foreground">No attachments uploaded yet</p>
                <Button className="mt-4" onClick={() => fileInputRef.current?.click()}>
                  <Upload className="h-4 w-4 mr-2" />
                  Upload First Attachment
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {intelligence.attachments.map((attachment) => (
                <Card key={attachment.id} data-testid={`card-attachment-${attachment.id}`}>
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <Badge variant="outline" className="gap-1">
                        {getCategoryIcon(attachment.category)}
                        {attachment.category.replace("_", " ")}
                      </Badge>
                      <Button variant="ghost" size="icon" onClick={() => deleteAttachmentMutation.mutate(attachment.id)} data-testid={`button-delete-attachment-${attachment.id}`}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                    
                    {attachment.attachmentType === "IMAGE" && (
                      <div className="aspect-video bg-muted rounded-md overflow-hidden">
                        <img
                          src={attachment.filePath.replace(/^uploads\//, "/uploads/")}
                          alt={attachment.title}
                          className="w-full h-full object-cover"
                        />
                      </div>
                    )}
                    
                    <div>
                      <p className="font-medium text-sm truncate">{attachment.title}</p>
                      {attachment.description && (
                        <p className="text-xs text-muted-foreground truncate">{attachment.description}</p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="ai-instructions" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Lightbulb className="h-5 w-5" />
                Site-Specific AI Instructions
              </CardTitle>
              <CardDescription>
                Define custom AI analysis instructions for this parking site. These instructions will guide the AI when analyzing parking evidence at this location.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>AI Instructions</Label>
                <Textarea
                  value={aiInstructions}
                  onChange={(e) => setAiInstructions(e.target.value)}
                  placeholder="Enter site-specific AI instructions...

Example:
- This site has a mix of public and permit-only bays
- The disabled bays near the entrance have poor visibility due to overhanging trees
- Always check for UK Blue Badge display on the dashboard
- Loading bay has 20-minute maximum during business hours"
                  className="min-h-[400px] font-mono text-sm"
                  data-testid="textarea-ai-instructions"
                />
              </div>
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">
                  {aiInstructions.length} characters
                </p>
                <Button 
                  onClick={() => saveAiInstructionsMutation.mutate(aiInstructions)}
                  disabled={saveAiInstructionsMutation.isPending}
                  data-testid="button-save-ai-instructions"
                >
                  {saveAiInstructionsMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : null}
                  Save Instructions
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Instruction Guidelines</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="text-sm text-muted-foreground space-y-2">
                <li className="flex items-start gap-2">
                  <span className="text-primary font-medium">Site Context:</span>
                  Describe unique characteristics of this parking site
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary font-medium">Bay Rules:</span>
                  Specify any special rules for specific bay types
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary font-medium">Signage Notes:</span>
                  Document signage visibility issues or common confusion points
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary font-medium">Enforcement Priorities:</span>
                  Highlight areas that require extra attention
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary font-medium">Known Issues:</span>
                  Document recurring problems or patterns at this site
                </li>
              </ul>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={bayDialogOpen} onOpenChange={setBayDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingBay ? "Edit Bay" : "Add Bay Intelligence"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Bay Identifier</Label>
                <Input
                  value={bayForm.bayIdentifier}
                  onChange={(e) => setBayForm({ ...bayForm, bayIdentifier: e.target.value })}
                  placeholder="e.g., Bay D1, Zone A-3"
                  data-testid="input-bay-identifier"
                />
              </div>
              <div className="space-y-2">
                <Label>Bay Type</Label>
                <Select value={bayForm.bayType} onValueChange={(v) => setBayForm({ ...bayForm, bayType: v })}>
                  <SelectTrigger data-testid="select-bay-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {BAY_TYPES.map((type) => (
                      <SelectItem key={type} value={type}>{type}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Zone (optional)</Label>
              <Input
                value={bayForm.zone}
                onChange={(e) => setBayForm({ ...bayForm, zone: e.target.value })}
                placeholder="e.g., Ground Floor, North Wing"
                data-testid="input-zone"
              />
            </div>

            <div className="space-y-2">
              <Label>Signage Clarity Score: {bayForm.signageClarityScore}/5</Label>
              <Slider
                value={[bayForm.signageClarityScore]}
                onValueChange={([v]) => setBayForm({ ...bayForm, signageClarityScore: v })}
                min={1}
                max={5}
                step={1}
                data-testid="slider-signage"
              />
              <p className="text-xs text-muted-foreground">1 = Very Poor, 5 = Excellent</p>
            </div>

            <div className="space-y-2">
              <Label>Marking Condition Score: {bayForm.markingConditionScore}/5</Label>
              <Slider
                value={[bayForm.markingConditionScore]}
                onValueChange={([v]) => setBayForm({ ...bayForm, markingConditionScore: v })}
                min={1}
                max={5}
                step={1}
                data-testid="slider-marking"
              />
              <p className="text-xs text-muted-foreground">1 = Very Poor, 5 = Excellent</p>
            </div>

            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea
                value={bayForm.notes}
                onChange={(e) => setBayForm({ ...bayForm, notes: e.target.value })}
                placeholder="Additional observations about this bay..."
                data-testid="textarea-bay-notes"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBayDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={() => {
                if (editingBay) {
                  updateBayMutation.mutate({ id: editingBay.id, data: bayForm });
                } else {
                  createBayMutation.mutate(bayForm);
                }
              }}
              disabled={!bayForm.bayIdentifier || !bayForm.bayType}
              data-testid="button-save-bay"
            >
              {editingBay ? "Update" : "Add"} Bay
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={patternDialogOpen} onOpenChange={setPatternDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingPattern ? "Edit Pattern" : "Add Behavior Pattern"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Pattern Type</Label>
                <Select value={patternForm.patternType} onValueChange={(v) => setPatternForm({ ...patternForm, patternType: v })}>
                  <SelectTrigger data-testid="select-pattern-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PATTERN_TYPES.map((type) => (
                      <SelectItem key={type} value={type}>{type}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Severity</Label>
                <Select value={patternForm.severity} onValueChange={(v) => setPatternForm({ ...patternForm, severity: v })}>
                  <SelectTrigger data-testid="select-severity">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SEVERITY_LEVELS.map((level) => (
                      <SelectItem key={level} value={level}>{level}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea
                value={patternForm.description}
                onChange={(e) => setPatternForm({ ...patternForm, description: e.target.value })}
                placeholder="Describe the observed behavior pattern..."
                data-testid="textarea-description"
              />
            </div>

            <div className="space-y-2">
              <Label>Frequency (optional)</Label>
              <Input
                value={patternForm.frequency}
                onChange={(e) => setPatternForm({ ...patternForm, frequency: e.target.value })}
                placeholder="e.g., Daily, Weekly, During events"
                data-testid="input-frequency"
              />
            </div>

            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea
                value={patternForm.notes}
                onChange={(e) => setPatternForm({ ...patternForm, notes: e.target.value })}
                placeholder="Additional notes..."
                data-testid="textarea-pattern-notes"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPatternDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={() => {
                if (editingPattern) {
                  updatePatternMutation.mutate({ id: editingPattern.id, data: patternForm });
                } else {
                  createPatternMutation.mutate(patternForm);
                }
              }}
              disabled={!patternForm.patternType || !patternForm.description}
              data-testid="button-save-pattern"
            >
              {editingPattern ? "Update" : "Add"} Pattern
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
