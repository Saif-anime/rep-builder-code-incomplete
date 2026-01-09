import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useRoute } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { ArrowLeft, Save, Send, Camera, Trash2, Loader2, CheckCircle, XCircle, AlertTriangle, Upload, Eye } from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { ParkingSite, SignageInspection, SignagePhoto } from "@shared/schema";

interface InspectionFormData {
  inspectorName: string;
  inspectionDate: string;
  siteCode: string;
  siteAddress: string;
  entranceSignagePresent: boolean | null;
  entranceClearlyVisible: boolean | null;
  entranceCorrectWording: boolean | null;
  entranceHeightCompliant: boolean | null;
  entranceLightingDay: boolean | null;
  entranceLightingNight: boolean | null;
  entranceCondition: string;
  tcTariffVisible: boolean | null;
  tcFontReadable: boolean | null;
  tcDistanceReadable: number | null;
  tcLanguageCorrect: boolean | null;
  tcLightingPresent: boolean | null;
  disabledSignPresent: boolean | null;
  disabledMarkingsVisible: boolean | null;
  disabledUprightSign: boolean | null;
  disabledWordingCorrect: boolean | null;
  evSignPresent: boolean | null;
  evMarkingsVisible: boolean | null;
  evUprightSign: boolean | null;
  evWordingCorrect: boolean | null;
  parentChildSignPresent: boolean | null;
  parentChildMarkingsVisible: boolean | null;
  parentChildUprightSign: boolean | null;
  parentChildWordingCorrect: boolean | null;
  bpaIpcCompliant: boolean | null;
  conflictingSignagePresent: boolean | null;
  obstructionsPresent: boolean | null;
  weatherDamage: boolean | null;
  graffitiPresent: boolean | null;
  generalNotes: string;
  signatureData: string;
}

const defaultFormData: InspectionFormData = {
  inspectorName: "",
  inspectionDate: new Date().toISOString().split("T")[0],
  siteCode: "",
  siteAddress: "",
  entranceSignagePresent: null,
  entranceClearlyVisible: null,
  entranceCorrectWording: null,
  entranceHeightCompliant: null,
  entranceLightingDay: null,
  entranceLightingNight: null,
  entranceCondition: "",
  tcTariffVisible: null,
  tcFontReadable: null,
  tcDistanceReadable: null,
  tcLanguageCorrect: null,
  tcLightingPresent: null,
  disabledSignPresent: null,
  disabledMarkingsVisible: null,
  disabledUprightSign: null,
  disabledWordingCorrect: null,
  evSignPresent: null,
  evMarkingsVisible: null,
  evUprightSign: null,
  evWordingCorrect: null,
  parentChildSignPresent: null,
  parentChildMarkingsVisible: null,
  parentChildUprightSign: null,
  parentChildWordingCorrect: null,
  bpaIpcCompliant: null,
  conflictingSignagePresent: null,
  obstructionsPresent: null,
  weatherDamage: null,
  graffitiPresent: null,
  generalNotes: "",
  signatureData: "",
};

function YesNoToggle({ 
  value, 
  onChange, 
  label,
  required = false 
}: { 
  value: boolean | null; 
  onChange: (val: boolean | null) => void; 
  label: string;
  required?: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-2">
      <Label className="flex-1">{label} {required && <span className="text-destructive">*</span>}</Label>
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          variant={value === true ? "default" : "outline"}
          onClick={() => onChange(value === true ? null : true)}
          data-testid={`toggle-${label.toLowerCase().replace(/\s+/g, "-")}-yes`}
        >
          Yes
        </Button>
        <Button
          type="button"
          size="sm"
          variant={value === false ? "destructive" : "outline"}
          onClick={() => onChange(value === false ? null : false)}
          data-testid={`toggle-${label.toLowerCase().replace(/\s+/g, "-")}-no`}
        >
          No
        </Button>
      </div>
    </div>
  );
}

function PhotoUploadSection({
  inspectionId,
  section,
  photos,
  onUploadComplete,
  disabled = false,
}: {
  inspectionId: number;
  section: string;
  photos: SignagePhoto[];
  onUploadComplete: () => void;
  disabled?: boolean;
}) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  
  const sectionPhotos = photos.filter(p => p.section === section);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    const formData = new FormData();
    formData.append("photo", file);
    formData.append("section", section);
    
    try {
      const token = localStorage.getItem("auth_token");
      const res = await fetch(`/api/signage-inspections/${inspectionId}/photos`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (!res.ok) throw new Error("Upload failed");
      toast({ title: "Photo uploaded successfully" });
      onUploadComplete();
    } catch (error) {
      toast({ title: "Failed to upload photo", variant: "destructive" });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const deleteMutation = useMutation({
    mutationFn: async (photoId: number) => {
      return apiRequest("DELETE", `/api/signage-photos/${photoId}`);
    },
    onSuccess: () => {
      toast({ title: "Photo deleted" });
      onUploadComplete();
    },
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleUpload}
          className="hidden"
          disabled={disabled || uploading}
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled || uploading}
          data-testid={`button-upload-photo-${section}`}
        >
          {uploading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Camera className="h-4 w-4 mr-2" />}
          Upload Photo
        </Button>
        {sectionPhotos.length > 0 && (
          <Badge variant="secondary">{sectionPhotos.length} photo(s)</Badge>
        )}
      </div>
      {sectionPhotos.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {sectionPhotos.map((photo) => (
            <div key={photo.id} className="relative group">
              <img
                src={photo.photoPath}
                alt={`${section} signage`}
                className="w-full h-24 object-cover rounded border"
              />
              {!disabled && (
                <Button
                  type="button"
                  size="icon"
                  variant="destructive"
                  className="absolute top-1 right-1 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={() => deleteMutation.mutate(photo.id)}
                  data-testid={`button-delete-photo-${photo.id}`}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function SignageInspectionPage() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [, params] = useRoute("/signage/:siteId/:inspectionId?");
  const siteId = params?.siteId ? parseInt(params.siteId) : null;
  const inspectionId = params?.inspectionId ? parseInt(params.inspectionId) : null;
  
  const [formData, setFormData] = useState<InspectionFormData>(defaultFormData);
  const [activeTab, setActiveTab] = useState("site");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);

  const { data: site, isLoading: siteLoading } = useQuery<ParkingSite>({
    queryKey: ["/api/parking-sites", siteId],
    queryFn: async () => {
      const res = await fetch(`/api/parking-sites/${siteId}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("auth_token")}` },
      });
      return res.json();
    },
    enabled: !!siteId,
  });

  const { data: inspection, isLoading: inspectionLoading, refetch: refetchInspection } = useQuery<SignageInspection & { photos: SignagePhoto[] }>({
    queryKey: ["/api/signage-inspections", inspectionId],
    enabled: !!inspectionId,
  });

  const createMutation = useMutation({
    mutationFn: async (data: Partial<InspectionFormData>) => {
      const res = await apiRequest("POST", `/api/sites/${siteId}/signage-inspections`, data);
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Inspection created" });
      setLocation(`/signage/${siteId}/${data.id}`);
    },
    onError: () => {
      toast({ title: "Failed to create inspection", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: Partial<InspectionFormData>) => {
      const res = await apiRequest("PATCH", `/api/signage-inspections/${inspectionId}`, data);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Inspection saved" });
      refetchInspection();
    },
    onError: () => {
      toast({ title: "Failed to save inspection", variant: "destructive" });
    },
  });

  const submitMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/signage-inspections/${inspectionId}/submit`, {});
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Inspection submitted successfully" });
      refetchInspection();
    },
    onError: (error: Error) => {
      toast({ title: "Failed to submit", description: error.message, variant: "destructive" });
    },
  });

  const isReadOnly = inspection?.status !== "draft";
  const photos = inspection?.photos || [];

  const handleSave = () => {
    if (inspectionId) {
      updateMutation.mutate(formData);
    } else {
      createMutation.mutate({
        ...formData,
        siteCode: site?.locationCode || "",
        siteAddress: [site?.addressLine1, site?.city, site?.postcode].filter(Boolean).join(", "),
      });
    }
  };

  const handleSubmit = () => {
    if (!inspectionId) return;
    handleSave();
    setTimeout(() => submitMutation.mutate(), 500);
  };

  const updateField = <K extends keyof InspectionFormData>(field: K, value: InspectionFormData[K]) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isReadOnly) return;
    setIsDrawing(true);
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    ctx.beginPath();
    ctx.moveTo(e.clientX - rect.left, e.clientY - rect.top);
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing || isReadOnly) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    ctx.lineTo(e.clientX - rect.left, e.clientY - rect.top);
    ctx.stroke();
  };

  const stopDrawing = () => {
    if (!isDrawing) return;
    setIsDrawing(false);
    const canvas = canvasRef.current;
    if (!canvas) return;
    updateField("signatureData", canvas.toDataURL());
  };

  const clearSignature = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    updateField("signatureData", "");
  };

  if (siteLoading || inspectionLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!site) {
    return (
      <div className="text-center py-8">
        <p className="text-muted-foreground">Site not found</p>
        <Button onClick={() => setLocation("/admin/sites")} className="mt-4">
          Back to Sites
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => setLocation(`/admin/sites`)} data-testid="button-back">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold">Signage Inspection</h1>
            <p className="text-muted-foreground">{site.siteName}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {inspection && (
            <Badge variant={
              inspection.status === "draft" ? "secondary" :
              inspection.status === "submitted" ? "default" :
              inspection.status === "approved" ? "default" : "destructive"
            }>
              {inspection.status.toUpperCase()}
            </Badge>
          )}
          {!isReadOnly && (
            <>
              <Button variant="outline" onClick={handleSave} disabled={updateMutation.isPending || createMutation.isPending} data-testid="button-save">
                {(updateMutation.isPending || createMutation.isPending) ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                Save Draft
              </Button>
              {inspectionId && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button disabled={submitMutation.isPending} data-testid="button-submit">
                      {submitMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
                      Submit
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Submit Inspection?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Once submitted, this inspection cannot be modified. Ensure all required photos are uploaded.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={handleSubmit}>Submit</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </>
          )}
        </div>
      </div>

      {inspection?.overallComplianceScore !== undefined && inspection?.overallComplianceScore !== null && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Compliance Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <p className="text-sm text-muted-foreground">Overall Score</p>
                <div className="flex items-center gap-2">
                  <Progress value={inspection.overallComplianceScore} className="flex-1" />
                  <span className="font-semibold">{inspection.overallComplianceScore}%</span>
                </div>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Appeal Risk</p>
                <div className="flex items-center gap-2">
                  <Progress value={inspection.appealRiskScore || 0} className="flex-1" />
                  <span className={`font-semibold ${(inspection.appealRiskScore || 0) > 50 ? "text-destructive" : ""}`}>
                    {inspection.appealRiskScore || 0}%
                  </span>
                </div>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Night Visibility Risk</p>
                <div className="flex items-center gap-2">
                  <Progress value={inspection.nightVisibilityRisk || 0} className="flex-1" />
                  <span className={`font-semibold ${(inspection.nightVisibilityRisk || 0) > 50 ? "text-destructive" : ""}`}>
                    {inspection.nightVisibilityRisk || 0}%
                  </span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-6">
          <TabsTrigger value="site" data-testid="tab-site">Site Info</TabsTrigger>
          <TabsTrigger value="entrance" data-testid="tab-entrance">Entrance</TabsTrigger>
          <TabsTrigger value="tc" data-testid="tab-tc">T&C</TabsTrigger>
          <TabsTrigger value="bays" data-testid="tab-bays">Bay Signage</TabsTrigger>
          <TabsTrigger value="general" data-testid="tab-general">General</TabsTrigger>
          <TabsTrigger value="declaration" data-testid="tab-declaration">Declaration</TabsTrigger>
        </TabsList>

        <TabsContent value="site" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Section 1: Site Information</CardTitle>
              <CardDescription>Basic information about the parking site being inspected</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Parking Site</Label>
                  <Input value={site.siteName} disabled data-testid="input-site-name" />
                </div>
                <div className="space-y-2">
                  <Label>Site Code</Label>
                  <Input 
                    value={formData.siteCode || site.locationCode || ""} 
                    onChange={(e) => updateField("siteCode", e.target.value)}
                    disabled={isReadOnly}
                    data-testid="input-site-code"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Address</Label>
                <Input 
                  value={formData.siteAddress || [site.addressLine1, site.city, site.postcode].filter(Boolean).join(", ")}
                  onChange={(e) => updateField("siteAddress", e.target.value)}
                  disabled={isReadOnly}
                  data-testid="input-address"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Inspection Date</Label>
                  <Input 
                    type="date"
                    value={formData.inspectionDate}
                    onChange={(e) => updateField("inspectionDate", e.target.value)}
                    disabled={isReadOnly}
                    data-testid="input-inspection-date"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Inspector Name</Label>
                  <Input 
                    value={formData.inspectorName}
                    onChange={(e) => updateField("inspectorName", e.target.value)}
                    disabled={isReadOnly}
                    data-testid="input-inspector-name"
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="entrance" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Section 2: Entrance Signage</CardTitle>
              <CardDescription>Assessment of signage at the parking site entrance</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <YesNoToggle
                label="Entrance signage present"
                value={formData.entranceSignagePresent}
                onChange={(val) => updateField("entranceSignagePresent", val)}
                required
              />
              <YesNoToggle
                label="Clearly visible on entry"
                value={formData.entranceClearlyVisible}
                onChange={(val) => updateField("entranceClearlyVisible", val)}
              />
              <YesNoToggle
                label="Correct wording"
                value={formData.entranceCorrectWording}
                onChange={(val) => updateField("entranceCorrectWording", val)}
              />
              <YesNoToggle
                label="Height compliant"
                value={formData.entranceHeightCompliant}
                onChange={(val) => updateField("entranceHeightCompliant", val)}
              />
              <YesNoToggle
                label="Lighting adequate (Day)"
                value={formData.entranceLightingDay}
                onChange={(val) => updateField("entranceLightingDay", val)}
              />
              <YesNoToggle
                label="Lighting adequate (Night)"
                value={formData.entranceLightingNight}
                onChange={(val) => updateField("entranceLightingNight", val)}
              />
              <div className="space-y-2">
                <Label>Condition</Label>
                <Select 
                  value={formData.entranceCondition} 
                  onValueChange={(val) => updateField("entranceCondition", val)}
                  disabled={isReadOnly}
                >
                  <SelectTrigger data-testid="select-entrance-condition">
                    <SelectValue placeholder="Select condition" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="good">Good</SelectItem>
                    <SelectItem value="damaged">Damaged</SelectItem>
                    <SelectItem value="missing">Missing</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Separator />
              <div>
                <Label className="mb-2 block">Photo Upload</Label>
                {inspectionId ? (
                  <PhotoUploadSection
                    inspectionId={inspectionId}
                    section="entrance"
                    photos={photos}
                    onUploadComplete={() => refetchInspection()}
                    disabled={isReadOnly}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">Save the inspection first to upload photos</p>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="tc" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Section 3: Terms & Conditions Signage</CardTitle>
              <CardDescription>Assessment of terms, conditions and tariff signage</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <YesNoToggle
                label="Tariff visible"
                value={formData.tcTariffVisible}
                onChange={(val) => updateField("tcTariffVisible", val)}
                required
              />
              <YesNoToggle
                label="Font readable"
                value={formData.tcFontReadable}
                onChange={(val) => updateField("tcFontReadable", val)}
              />
              <div className="flex items-center justify-between py-2">
                <Label>Distance readable (meters)</Label>
                <Input 
                  type="number"
                  className="w-24"
                  value={formData.tcDistanceReadable || ""}
                  onChange={(e) => updateField("tcDistanceReadable", e.target.value ? parseFloat(e.target.value) : null)}
                  disabled={isReadOnly}
                  data-testid="input-tc-distance"
                />
              </div>
              <YesNoToggle
                label="Language correct"
                value={formData.tcLanguageCorrect}
                onChange={(val) => updateField("tcLanguageCorrect", val)}
              />
              <YesNoToggle
                label="Lighting present"
                value={formData.tcLightingPresent}
                onChange={(val) => updateField("tcLightingPresent", val)}
              />
              <Separator />
              <div>
                <Label className="mb-2 block">Photo Upload</Label>
                {inspectionId ? (
                  <PhotoUploadSection
                    inspectionId={inspectionId}
                    section="tc"
                    photos={photos}
                    onUploadComplete={() => refetchInspection()}
                    disabled={isReadOnly}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">Save the inspection first to upload photos</p>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="bays" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Section 4: Bay-Specific Signage - Disabled</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <YesNoToggle
                label="Sign present"
                value={formData.disabledSignPresent}
                onChange={(val) => updateField("disabledSignPresent", val)}
                required
              />
              <YesNoToggle
                label="Markings visible"
                value={formData.disabledMarkingsVisible}
                onChange={(val) => updateField("disabledMarkingsVisible", val)}
              />
              <YesNoToggle
                label="Upright sign present"
                value={formData.disabledUprightSign}
                onChange={(val) => updateField("disabledUprightSign", val)}
              />
              <YesNoToggle
                label="Wording correct"
                value={formData.disabledWordingCorrect}
                onChange={(val) => updateField("disabledWordingCorrect", val)}
              />
              <Separator />
              {inspectionId ? (
                <PhotoUploadSection
                  inspectionId={inspectionId}
                  section="disabled"
                  photos={photos}
                  onUploadComplete={() => refetchInspection()}
                  disabled={isReadOnly}
                />
              ) : (
                <p className="text-sm text-muted-foreground">Save the inspection first to upload photos</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Section 4: Bay-Specific Signage - EV</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <YesNoToggle
                label="Sign present"
                value={formData.evSignPresent}
                onChange={(val) => updateField("evSignPresent", val)}
              />
              <YesNoToggle
                label="Markings visible"
                value={formData.evMarkingsVisible}
                onChange={(val) => updateField("evMarkingsVisible", val)}
              />
              <YesNoToggle
                label="Upright sign present"
                value={formData.evUprightSign}
                onChange={(val) => updateField("evUprightSign", val)}
              />
              <YesNoToggle
                label="Wording correct"
                value={formData.evWordingCorrect}
                onChange={(val) => updateField("evWordingCorrect", val)}
              />
              <Separator />
              {inspectionId ? (
                <PhotoUploadSection
                  inspectionId={inspectionId}
                  section="ev"
                  photos={photos}
                  onUploadComplete={() => refetchInspection()}
                  disabled={isReadOnly}
                />
              ) : (
                <p className="text-sm text-muted-foreground">Save the inspection first to upload photos</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Section 4: Bay-Specific Signage - Parent & Child</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <YesNoToggle
                label="Sign present"
                value={formData.parentChildSignPresent}
                onChange={(val) => updateField("parentChildSignPresent", val)}
              />
              <YesNoToggle
                label="Markings visible"
                value={formData.parentChildMarkingsVisible}
                onChange={(val) => updateField("parentChildMarkingsVisible", val)}
              />
              <YesNoToggle
                label="Upright sign present"
                value={formData.parentChildUprightSign}
                onChange={(val) => updateField("parentChildUprightSign", val)}
              />
              <YesNoToggle
                label="Wording correct"
                value={formData.parentChildWordingCorrect}
                onChange={(val) => updateField("parentChildWordingCorrect", val)}
              />
              <Separator />
              {inspectionId ? (
                <PhotoUploadSection
                  inspectionId={inspectionId}
                  section="parent_child"
                  photos={photos}
                  onUploadComplete={() => refetchInspection()}
                  disabled={isReadOnly}
                />
              ) : (
                <p className="text-sm text-muted-foreground">Save the inspection first to upload photos</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="general" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Section 5: General Compliance Check</CardTitle>
              <CardDescription>Overall site compliance assessment</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <YesNoToggle
                label="BPA/IPC compliant"
                value={formData.bpaIpcCompliant}
                onChange={(val) => updateField("bpaIpcCompliant", val)}
                required
              />
              <YesNoToggle
                label="Conflicting signage present"
                value={formData.conflictingSignagePresent}
                onChange={(val) => updateField("conflictingSignagePresent", val)}
              />
              <YesNoToggle
                label="Obstructions present"
                value={formData.obstructionsPresent}
                onChange={(val) => updateField("obstructionsPresent", val)}
              />
              <YesNoToggle
                label="Weather damage"
                value={formData.weatherDamage}
                onChange={(val) => updateField("weatherDamage", val)}
              />
              <YesNoToggle
                label="Graffiti present"
                value={formData.graffitiPresent}
                onChange={(val) => updateField("graffitiPresent", val)}
              />
              <div className="space-y-2">
                <Label>Notes</Label>
                <Textarea
                  value={formData.generalNotes}
                  onChange={(e) => updateField("generalNotes", e.target.value)}
                  disabled={isReadOnly}
                  placeholder="Additional notes about general compliance..."
                  data-testid="textarea-general-notes"
                />
              </div>
              <Separator />
              {inspectionId ? (
                <PhotoUploadSection
                  inspectionId={inspectionId}
                  section="general"
                  photos={photos}
                  onUploadComplete={() => refetchInspection()}
                  disabled={isReadOnly}
                />
              ) : (
                <p className="text-sm text-muted-foreground">Save the inspection first to upload photos</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="declaration" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Section 6: Declaration</CardTitle>
              <CardDescription>Inspector signature and submission confirmation</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="p-4 bg-muted rounded-lg">
                <p className="text-sm">
                  I confirm that this signage inspection has been conducted accurately and to the best of my knowledge.
                  All information provided is true and complete as of the inspection date.
                </p>
              </div>
              <div className="space-y-2">
                <Label>Signature</Label>
                <div className="border rounded-lg p-2 bg-white">
                  <canvas
                    ref={canvasRef}
                    width={400}
                    height={150}
                    className="border rounded cursor-crosshair w-full"
                    onMouseDown={startDrawing}
                    onMouseMove={draw}
                    onMouseUp={stopDrawing}
                    onMouseLeave={stopDrawing}
                  />
                </div>
                {!isReadOnly && (
                  <Button type="button" variant="outline" size="sm" onClick={clearSignature} data-testid="button-clear-signature">
                    Clear Signature
                  </Button>
                )}
              </div>
              {inspection?.declarationTimestamp && (
                <div className="text-sm text-muted-foreground">
                  Submitted at: {new Date(inspection.declarationTimestamp).toLocaleString()}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
