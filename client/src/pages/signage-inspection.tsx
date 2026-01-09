import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useRoute } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { ArrowLeft, Loader2, CheckCircle, XCircle, Upload, FileText, AlertCircle, Clock, MapPin, User, Calendar } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import type { ParkingSite, SignageInspection, SignagePhoto } from "@shared/schema";

interface ExtractedSections {
  siteInformation?: Record<string, any>;
  entranceSignage?: Record<string, any>;
  termsAndConditions?: Record<string, any>;
  baySignage?: Record<string, any>;
  generalSignage?: Record<string, any>;
  declaration?: Record<string, any>;
}

interface PdfParseResponse {
  success: boolean;
  pdfFileName: string;
  extractedData: ExtractedSections;
  flatData: Record<string, any>;
  extractedText: string;
  pageCount: number;
}

function FieldRow({ label, value }: { label: string; value: any }) {
  if (value === undefined || value === null) return null;
  
  let displayValue: React.ReactNode;
  if (typeof value === "boolean") {
    displayValue = value ? (
      <Badge variant="default" className="bg-green-600"><CheckCircle className="h-3 w-3 mr-1" /> Yes</Badge>
    ) : (
      <Badge variant="destructive"><XCircle className="h-3 w-3 mr-1" /> No</Badge>
    );
  } else if (typeof value === "number") {
    displayValue = <span className="font-medium">{value}</span>;
  } else {
    displayValue = <span className="font-medium">{String(value)}</span>;
  }

  return (
    <div className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
      <span className="text-muted-foreground text-sm">{label}</span>
      {displayValue}
    </div>
  );
}

function SectionCard({ title, icon: Icon, data, fieldLabels }: { 
  title: string; 
  icon: React.ComponentType<{ className?: string }>;
  data: Record<string, any>; 
  fieldLabels: Record<string, string>;
}) {
  const entries = Object.entries(data).filter(([_, v]) => v !== undefined && v !== null);
  if (entries.length === 0) return null;

  return (
    <Card data-testid={`card-section-${title.toLowerCase().replace(/\s+/g, "-")}`}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Icon className="h-5 w-5 text-primary" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-1">
          {entries.map(([key, value]) => (
            <FieldRow 
              key={key} 
              label={fieldLabels[key] || key.replace(/([A-Z])/g, " $1").replace(/^./, s => s.toUpperCase())} 
              value={value} 
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

const siteInfoLabels: Record<string, string> = {
  inspectorName: "Inspector Name",
  siteCode: "Site Code",
  siteAddress: "Site Address",
  inspectionDate: "Inspection Date",
};

const entranceLabels: Record<string, string> = {
  signagePresent: "Signage Present",
  clearlyVisible: "Clearly Visible",
  correctWording: "Correct Wording",
  heightCompliant: "Height Compliant",
  lightingDay: "Daytime Lighting",
  lightingNight: "Night Lighting",
  condition: "Condition",
};

const tcLabels: Record<string, string> = {
  tariffVisible: "Tariff Visible",
  fontReadable: "Font Readable",
  languageCorrect: "Language Correct",
  lightingPresent: "Lighting Present",
  readableDistance: "Readable Distance (m)",
};

const bayLabels: Record<string, string> = {
  disabledSignPresent: "Disabled Sign Present",
  disabledMarkingsVisible: "Disabled Markings Visible",
  disabledUprightSign: "Disabled Upright Sign",
  disabledWordingCorrect: "Disabled Wording Correct",
  evSignPresent: "EV Sign Present",
  evMarkingsVisible: "EV Markings Visible",
  evUprightSign: "EV Upright Sign",
  evWordingCorrect: "EV Wording Correct",
  parentChildSignPresent: "Parent & Child Sign Present",
  parentChildMarkingsVisible: "Parent & Child Markings Visible",
  parentChildUprightSign: "Parent & Child Upright Sign",
  parentChildWordingCorrect: "Parent & Child Wording Correct",
};

const generalLabels: Record<string, string> = {
  bpaIpcCompliant: "BPA/IPC Compliant",
  conflictingSignagePresent: "Conflicting Signage",
  obstructionsPresent: "Obstructions Present",
  weatherDamage: "Weather Damage",
  graffitiPresent: "Graffiti Present",
  notes: "General Notes",
};

const declarationLabels: Record<string, string> = {
  signedBy: "Signed By",
  date: "Date",
};

export default function SignageInspectionPage() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [, params] = useRoute("/signage/:siteId/:inspectionId?");
  const siteId = params?.siteId ? parseInt(params.siteId) : null;
  const inspectionId = params?.inspectionId ? parseInt(params.inspectionId) : null;

  const [pdfDialogOpen, setPdfDialogOpen] = useState(false);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [parsedData, setParsedData] = useState<PdfParseResponse | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const pdfInputRef = useRef<HTMLInputElement>(null);

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

  const { data: inspection, isLoading: inspectionLoading } = useQuery<SignageInspection & { photos: SignagePhoto[] }>({
    queryKey: ["/api/signage-inspections", inspectionId],
    enabled: !!inspectionId,
  });

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setPdfFile(file);
      setParsedData(null);
    }
  };

  const handleParsePdf = async () => {
    if (!pdfFile) return;
    setIsParsing(true);
    try {
      const formData = new FormData();
      formData.append("pdf", pdfFile);
      const res = await fetch(`/api/signage-inspections/parse-pdf`, {
        method: "POST",
        headers: { Authorization: `Bearer ${localStorage.getItem("auth_token")}` },
        body: formData,
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        toast({ title: "PDF Error", description: data.message || "Failed to parse PDF", variant: "destructive" });
        return;
      }
      setParsedData(data);
      toast({ title: "PDF Parsed", description: `Extracted ${Object.keys(data.extractedData).length} sections` });
    } catch {
      toast({ title: "Failed to parse PDF", description: "Network or server error", variant: "destructive" });
    } finally {
      setIsParsing(false);
    }
  };

  const handleUploadAndCreate = async () => {
    if (!pdfFile || !siteId) return;
    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append("pdf", pdfFile);
      const res = await fetch(`/api/sites/${siteId}/signage-inspections/upload-pdf`, {
        method: "POST",
        headers: { Authorization: `Bearer ${localStorage.getItem("auth_token")}` },
        body: formData,
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        toast({ title: "Upload Error", description: data.message || "Failed to upload PDF", variant: "destructive" });
        return;
      }
      toast({ title: "Inspection Created", description: "PDF data has been imported successfully" });
      setPdfDialogOpen(false);
      setPdfFile(null);
      setParsedData(null);
      setLocation(`/signage/${siteId}/${data.inspection.id}`);
    } catch {
      toast({ title: "Upload Failed", description: "Network or server error", variant: "destructive" });
    } finally {
      setIsUploading(false);
    }
  };

  const buildExtractedDataFromInspection = (insp: SignageInspection): ExtractedSections => {
    const result: ExtractedSections = {};
    
    const siteInfo: Record<string, any> = {};
    if (insp.inspectorName) siteInfo.inspectorName = insp.inspectorName;
    if (insp.siteCode) siteInfo.siteCode = insp.siteCode;
    if (insp.siteAddress) siteInfo.siteAddress = insp.siteAddress;
    if (insp.inspectionDate) siteInfo.inspectionDate = new Date(insp.inspectionDate).toLocaleDateString();
    if (Object.keys(siteInfo).length > 0) result.siteInformation = siteInfo;

    const entrance: Record<string, any> = {};
    if (insp.entranceSignagePresent !== null) entrance.signagePresent = insp.entranceSignagePresent;
    if (insp.entranceClearlyVisible !== null) entrance.clearlyVisible = insp.entranceClearlyVisible;
    if (insp.entranceCorrectWording !== null) entrance.correctWording = insp.entranceCorrectWording;
    if (insp.entranceHeightCompliant !== null) entrance.heightCompliant = insp.entranceHeightCompliant;
    if (insp.entranceLightingDay !== null) entrance.lightingDay = insp.entranceLightingDay;
    if (insp.entranceLightingNight !== null) entrance.lightingNight = insp.entranceLightingNight;
    if (insp.entranceCondition) entrance.condition = insp.entranceCondition;
    if (Object.keys(entrance).length > 0) result.entranceSignage = entrance;

    const tc: Record<string, any> = {};
    if (insp.tcTariffVisible !== null) tc.tariffVisible = insp.tcTariffVisible;
    if (insp.tcFontReadable !== null) tc.fontReadable = insp.tcFontReadable;
    if (insp.tcLanguageCorrect !== null) tc.languageCorrect = insp.tcLanguageCorrect;
    if (insp.tcLightingPresent !== null) tc.lightingPresent = insp.tcLightingPresent;
    if (insp.tcDistanceReadable !== null) tc.readableDistance = insp.tcDistanceReadable;
    if (Object.keys(tc).length > 0) result.termsAndConditions = tc;

    const bay: Record<string, any> = {};
    if (insp.disabledSignPresent !== null) bay.disabledSignPresent = insp.disabledSignPresent;
    if (insp.disabledMarkingsVisible !== null) bay.disabledMarkingsVisible = insp.disabledMarkingsVisible;
    if (insp.disabledUprightSign !== null) bay.disabledUprightSign = insp.disabledUprightSign;
    if (insp.disabledWordingCorrect !== null) bay.disabledWordingCorrect = insp.disabledWordingCorrect;
    if (insp.evSignPresent !== null) bay.evSignPresent = insp.evSignPresent;
    if (insp.evMarkingsVisible !== null) bay.evMarkingsVisible = insp.evMarkingsVisible;
    if (insp.evUprightSign !== null) bay.evUprightSign = insp.evUprightSign;
    if (insp.evWordingCorrect !== null) bay.evWordingCorrect = insp.evWordingCorrect;
    if (insp.parentChildSignPresent !== null) bay.parentChildSignPresent = insp.parentChildSignPresent;
    if (insp.parentChildMarkingsVisible !== null) bay.parentChildMarkingsVisible = insp.parentChildMarkingsVisible;
    if (insp.parentChildUprightSign !== null) bay.parentChildUprightSign = insp.parentChildUprightSign;
    if (insp.parentChildWordingCorrect !== null) bay.parentChildWordingCorrect = insp.parentChildWordingCorrect;
    if (Object.keys(bay).length > 0) result.baySignage = bay;

    const general: Record<string, any> = {};
    if (insp.bpaIpcCompliant !== null) general.bpaIpcCompliant = insp.bpaIpcCompliant;
    if (insp.conflictingSignagePresent !== null) general.conflictingSignagePresent = insp.conflictingSignagePresent;
    if (insp.obstructionsPresent !== null) general.obstructionsPresent = insp.obstructionsPresent;
    if (insp.weatherDamage !== null) general.weatherDamage = insp.weatherDamage;
    if (insp.graffitiPresent !== null) general.graffitiPresent = insp.graffitiPresent;
    if (insp.generalNotes) general.notes = insp.generalNotes;
    if (Object.keys(general).length > 0) result.generalSignage = general;

    return result;
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
        <Button onClick={() => setLocation("/admin/sites")} className="mt-4" data-testid="button-back-to-sites">
          Back to Sites
        </Button>
      </div>
    );
  }

  const extractedData = inspection ? buildExtractedDataFromInspection(inspection) : null;
  const hasData = extractedData && Object.keys(extractedData).length > 0;

  return (
    <ScrollArea className="h-full">
      <div className="p-6 space-y-6 max-w-4xl mx-auto">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => setLocation(`/admin/sites`)} data-testid="button-back">
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold">Signage Inspection</h1>
              <p className="text-muted-foreground">{site.siteName || site.locationCode}</p>
            </div>
          </div>
          {!inspectionId && (
            <Button onClick={() => setPdfDialogOpen(true)} data-testid="button-import-pdf">
              <Upload className="h-4 w-4 mr-2" />
              Import from PDF
            </Button>
          )}
        </div>

        <Separator />

        {!inspectionId && !hasData && (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-16">
              <FileText className="h-16 w-16 text-muted-foreground/50 mb-4" />
              <h3 className="text-lg font-semibold mb-2">No Inspection Data</h3>
              <p className="text-muted-foreground text-center mb-6 max-w-md">
                Please upload a signage inspection PDF to view the inspection data.
                The system will automatically extract and display all relevant information.
              </p>
              <Button onClick={() => setPdfDialogOpen(true)} size="lg" data-testid="button-upload-pdf-cta">
                <Upload className="h-5 w-5 mr-2" />
                Import from PDF
              </Button>
            </CardContent>
          </Card>
        )}

        {inspection && (
          <Card className="bg-muted/30" data-testid="card-pdf-metadata">
            <CardContent className="py-4">
              <div className="flex items-center gap-6 flex-wrap">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-primary" />
                  <span className="text-sm font-medium">Inspection #{inspection.id}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">
                    Created: {new Date(inspection.createdAt).toLocaleString()}
                  </span>
                </div>
                <Badge variant={inspection.status === "approved" ? "default" : inspection.status === "rejected" ? "destructive" : "secondary"}>
                  {inspection.status}
                </Badge>
                {inspection.overallComplianceScore !== null && (
                  <Badge variant="outline">
                    Compliance: {inspection.overallComplianceScore}%
                  </Badge>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {hasData && extractedData && (
          <div className="space-y-4">
            {extractedData.siteInformation && (
              <SectionCard 
                title="Site Information" 
                icon={MapPin} 
                data={extractedData.siteInformation} 
                fieldLabels={siteInfoLabels} 
              />
            )}
            {extractedData.entranceSignage && (
              <SectionCard 
                title="Entrance Signage" 
                icon={AlertCircle} 
                data={extractedData.entranceSignage} 
                fieldLabels={entranceLabels} 
              />
            )}
            {extractedData.termsAndConditions && (
              <SectionCard 
                title="Terms & Conditions" 
                icon={FileText} 
                data={extractedData.termsAndConditions} 
                fieldLabels={tcLabels} 
              />
            )}
            {extractedData.baySignage && (
              <SectionCard 
                title="Bay Signage" 
                icon={MapPin} 
                data={extractedData.baySignage} 
                fieldLabels={bayLabels} 
              />
            )}
            {extractedData.generalSignage && (
              <SectionCard 
                title="General Signage" 
                icon={CheckCircle} 
                data={extractedData.generalSignage} 
                fieldLabels={generalLabels} 
              />
            )}
            {extractedData.declaration && (
              <SectionCard 
                title="Declaration" 
                icon={User} 
                data={extractedData.declaration} 
                fieldLabels={declarationLabels} 
              />
            )}
          </div>
        )}

        <Dialog open={pdfDialogOpen} onOpenChange={setPdfDialogOpen}>
          <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
            <DialogHeader>
              <DialogTitle>Import Signage Inspection from PDF</DialogTitle>
              <DialogDescription>
                Upload a signage inspection PDF to automatically extract the data.
              </DialogDescription>
            </DialogHeader>
            
            <div className="flex-1 overflow-y-auto space-y-4 py-4">
              <div className="border-2 border-dashed rounded-lg p-6 text-center">
                <input
                  ref={pdfInputRef}
                  type="file"
                  accept=".pdf,application/pdf"
                  onChange={handleFileSelect}
                  className="hidden"
                  data-testid="input-pdf-file"
                />
                <FileText className="h-12 w-12 text-muted-foreground/50 mx-auto mb-3" />
                {pdfFile ? (
                  <div>
                    <p className="font-medium">{pdfFile.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {(pdfFile.size / 1024).toFixed(1)} KB
                    </p>
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="mt-2"
                      onClick={() => pdfInputRef.current?.click()}
                      data-testid="button-change-file"
                    >
                      Change File
                    </Button>
                  </div>
                ) : (
                  <div>
                    <p className="text-muted-foreground mb-2">
                      Drag and drop a PDF file, or click to select
                    </p>
                    <Button onClick={() => pdfInputRef.current?.click()} data-testid="button-select-pdf">
                      Select PDF
                    </Button>
                  </div>
                )}
              </div>

              {pdfFile && !parsedData && (
                <Button 
                  onClick={handleParsePdf} 
                  disabled={isParsing} 
                  className="w-full"
                  data-testid="button-preview-pdf"
                >
                  {isParsing ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Parsing PDF...
                    </>
                  ) : (
                    "Preview Extracted Data"
                  )}
                </Button>
              )}

              {parsedData && (
                <div className="space-y-4">
                  <Card className="bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-900">
                    <CardContent className="py-3">
                      <div className="flex items-center gap-2 text-green-700 dark:text-green-400">
                        <CheckCircle className="h-4 w-4" />
                        <span className="font-medium">PDF Parsed Successfully</span>
                      </div>
                      <p className="text-sm text-muted-foreground mt-1">
                        Extracted {Object.keys(parsedData.extractedData).length} sections from {parsedData.pageCount} page(s)
                      </p>
                    </CardContent>
                  </Card>

                  <ScrollArea className="h-64 border rounded-lg p-4">
                    <div className="space-y-3">
                      {parsedData.extractedData.siteInformation && (
                        <SectionCard 
                          title="Site Information" 
                          icon={MapPin} 
                          data={parsedData.extractedData.siteInformation} 
                          fieldLabels={siteInfoLabels} 
                        />
                      )}
                      {parsedData.extractedData.entranceSignage && (
                        <SectionCard 
                          title="Entrance Signage" 
                          icon={AlertCircle} 
                          data={parsedData.extractedData.entranceSignage} 
                          fieldLabels={entranceLabels} 
                        />
                      )}
                      {parsedData.extractedData.termsAndConditions && (
                        <SectionCard 
                          title="Terms & Conditions" 
                          icon={FileText} 
                          data={parsedData.extractedData.termsAndConditions} 
                          fieldLabels={tcLabels} 
                        />
                      )}
                      {parsedData.extractedData.baySignage && (
                        <SectionCard 
                          title="Bay Signage" 
                          icon={MapPin} 
                          data={parsedData.extractedData.baySignage} 
                          fieldLabels={bayLabels} 
                        />
                      )}
                      {parsedData.extractedData.generalSignage && (
                        <SectionCard 
                          title="General Signage" 
                          icon={CheckCircle} 
                          data={parsedData.extractedData.generalSignage} 
                          fieldLabels={generalLabels} 
                        />
                      )}
                      {parsedData.extractedData.declaration && (
                        <SectionCard 
                          title="Declaration" 
                          icon={User} 
                          data={parsedData.extractedData.declaration} 
                          fieldLabels={declarationLabels} 
                        />
                      )}
                      {Object.keys(parsedData.extractedData).length === 0 && (
                        <div className="text-center py-8 text-muted-foreground">
                          <AlertCircle className="h-8 w-8 mx-auto mb-2 opacity-50" />
                          <p>No structured data could be extracted from this PDF.</p>
                          <p className="text-sm">The PDF may not be in a recognized format.</p>
                        </div>
                      )}
                    </div>
                  </ScrollArea>
                </div>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => { setPdfDialogOpen(false); setPdfFile(null); setParsedData(null); }} data-testid="button-cancel-upload">
                Cancel
              </Button>
              {parsedData && Object.keys(parsedData.extractedData).length > 0 && (
                <Button onClick={handleUploadAndCreate} disabled={isUploading} data-testid="button-confirm-import">
                  {isUploading ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Creating Inspection...
                    </>
                  ) : (
                    "Create Inspection"
                  )}
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </ScrollArea>
  );
}
