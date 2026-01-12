import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Settings,
  Camera,
  MapPin,
  Brain,
  Save,
  Loader2,
  Plus,
  Trash2,
  RefreshCw,
  Wifi,
  WifiOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Camera as CameraType, Bay, ParkingSite } from "@shared/schema";

const cameraSchema = z.object({
  name: z.string().min(1, "Name is required"),
  siteId: z.string().min(1, "Parking site is required"),
  ipAddress: z.string().min(1, "IP address is required"),
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
});

const baySchema = z.object({
  name: z.string().min(1, "Name is required"),
  type: z.string().min(1, "Bay type is required"),
  location: z.string().optional(),
  cameraId: z.string().optional(),
});

type CameraFormValues = z.infer<typeof cameraSchema>;
type BayFormValues = z.infer<typeof baySchema>;

export default function SettingsPage() {
  const { toast } = useToast();
  const [isCameraDialogOpen, setIsCameraDialogOpen] = useState(false);
  const [isBayDialogOpen, setIsBayDialogOpen] = useState(false);

  const { data: cameras, isLoading: camerasLoading } = useQuery<CameraType[]>({
    queryKey: ["/api/cameras"],
  });

  const { data: bays, isLoading: baysLoading } = useQuery<Bay[]>({
    queryKey: ["/api/bays"],
  });

  const { data: aiSettings, isLoading: aiSettingsLoading } = useQuery<{
    detectionThreshold: number;
    anprThreshold: number;
    autoAnalyze: boolean;
    autoPcn: boolean;
  }>({
    queryKey: ["/api/settings/ai"],
  });

  const { data: parkingSites = [] } = useQuery<ParkingSite[]>({
    queryKey: ["/api/parking-sites"],
  });

  const cameraForm = useForm<CameraFormValues>({
    resolver: zodResolver(cameraSchema),
    defaultValues: {
      name: "",
      siteId: "",
      ipAddress: "",
      username: "",
      password: "",
    },
  });

  const bayForm = useForm<BayFormValues>({
    resolver: zodResolver(baySchema),
    defaultValues: {
      name: "",
      type: "",
      location: "",
      cameraId: "",
    },
  });

  const addCameraMutation = useMutation({
    mutationFn: async (data: CameraFormValues) => {
      return apiRequest("POST", "/api/cameras", data);
    },
    onSuccess: () => {
      toast({ title: "Camera added", description: "Camera has been configured successfully." });
      queryClient.invalidateQueries({ queryKey: ["/api/cameras"] });
      cameraForm.reset();
      setIsCameraDialogOpen(false);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to add camera.", variant: "destructive" });
    },
  });

  const addBayMutation = useMutation({
    mutationFn: async (data: BayFormValues) => {
      const payload = {
        name: data.name,
        type: data.type,
        location: data.location || undefined,
        cameraId: data.cameraId ? Number(data.cameraId) : undefined,
      };
      return apiRequest("POST", "/api/bays", payload);
    },
    onSuccess: () => {
      toast({ title: "Bay added", description: "Parking bay has been configured successfully." });
      queryClient.invalidateQueries({ queryKey: ["/api/bays"] });
      bayForm.reset();
      setIsBayDialogOpen(false);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message || "Failed to add bay.", variant: "destructive" });
    },
  });

  const updateAiSettingsMutation = useMutation({
    mutationFn: async (data: { detectionThreshold: number; anprThreshold: number; autoAnalyze: boolean; autoPcn: boolean }) => {
      const response = await apiRequest("PATCH", "/api/settings/ai", data);
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || "Failed to save settings");
      }
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Settings saved", description: "AI settings have been updated." });
      queryClient.invalidateQueries({ queryKey: ["/api/settings/ai"] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message || "Failed to save settings.", variant: "destructive" });
    },
  });

  const deleteCameraMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest("DELETE", `/api/cameras/${id}`);
    },
    onSuccess: () => {
      toast({ title: "Camera deleted" });
      queryClient.invalidateQueries({ queryKey: ["/api/cameras"] });
    },
  });

  const deleteBayMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest("DELETE", `/api/bays/${id}`);
    },
    onSuccess: () => {
      toast({ title: "Bay deleted" });
      queryClient.invalidateQueries({ queryKey: ["/api/bays"] });
    },
  });

  const [checkingCameraId, setCheckingCameraId] = useState<number | null>(null);

  const checkCameraMutation = useMutation({
    mutationFn: async (id: number) => {
      setCheckingCameraId(id);
      const response = await apiRequest("POST", `/api/cameras/${id}/check`);
      return response.json();
    },
    onSuccess: (data) => {
      setCheckingCameraId(null);
      queryClient.invalidateQueries({ queryKey: ["/api/cameras"] });
      toast({
        title: data.online ? "Camera Online" : "Camera Offline",
        description: data.message,
        variant: data.online ? "default" : "destructive",
      });
    },
    onError: () => {
      setCheckingCameraId(null);
      toast({ title: "Error", description: "Failed to check camera status.", variant: "destructive" });
    },
  });

  const [localAiSettings, setLocalAiSettings] = useState({
    detectionThreshold: 85,
    anprThreshold: 80,
    autoAnalyze: true,
    autoPcn: false,
  });

  useEffect(() => {
    if (aiSettings) {
      setLocalAiSettings({
        detectionThreshold: aiSettings.detectionThreshold,
        anprThreshold: aiSettings.anprThreshold,
        autoAnalyze: aiSettings.autoAnalyze,
        autoPcn: aiSettings.autoPcn,
      });
    }
  }, [aiSettings]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Configure cameras, parking bays, and AI detection thresholds
        </p>
      </div>

      <Tabs defaultValue="cameras" className="space-y-6">
        <TabsList>
          <TabsTrigger value="cameras" data-testid="tab-cameras">
            <Camera className="h-4 w-4 mr-2" />
            Cameras
          </TabsTrigger>
          <TabsTrigger value="bays" data-testid="tab-bays">
            <MapPin className="h-4 w-4 mr-2" />
            Bays
          </TabsTrigger>
          <TabsTrigger value="ai" data-testid="tab-ai">
            <Brain className="h-4 w-4 mr-2" />
            AI Settings
          </TabsTrigger>
        </TabsList>

        <TabsContent value="cameras" className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-medium">Camera Configuration</h2>
              <p className="text-sm text-muted-foreground">
                Manage Hikvision ColorVu Pro camera connections
              </p>
            </div>
            <Dialog open={isCameraDialogOpen} onOpenChange={setIsCameraDialogOpen}>
              <DialogTrigger asChild>
                <Button data-testid="button-add-camera">
                  <Plus className="h-4 w-4 mr-2" />
                  Add Camera
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add Camera</DialogTitle>
                </DialogHeader>
                <Form {...cameraForm}>
                  <form onSubmit={cameraForm.handleSubmit((data) => addCameraMutation.mutate(data))} className="space-y-4">
                    <FormField
                      control={cameraForm.control}
                      name="name"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Camera Name</FormLabel>
                          <FormControl>
                            <Input placeholder="Entrance Camera 1" data-testid="input-camera-name" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={cameraForm.control}
                      name="siteId"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Parking Site</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger data-testid="select-camera-site">
                                <SelectValue placeholder="Select a parking site" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {parkingSites.map((site) => (
                                <SelectItem key={site.id} value={site.id.toString()}>
                                  {site.siteName} {site.city && `- ${site.city}`}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={cameraForm.control}
                      name="ipAddress"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>IP Address</FormLabel>
                          <FormControl>
                            <Input placeholder="192.168.1.100" data-testid="input-camera-ip" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <div className="grid grid-cols-2 gap-4">
                      <FormField
                        control={cameraForm.control}
                        name="username"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Username</FormLabel>
                            <FormControl>
                              <Input placeholder="admin" data-testid="input-camera-username" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={cameraForm.control}
                        name="password"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Password</FormLabel>
                            <FormControl>
                              <Input type="password" placeholder="••••••••" data-testid="input-camera-password" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                    <div className="flex justify-end gap-3 pt-2">
                      <Button type="button" variant="outline" onClick={() => setIsCameraDialogOpen(false)}>Cancel</Button>
                      <Button type="submit" disabled={addCameraMutation.isPending} data-testid="button-save-camera">
                        {addCameraMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                        Add Camera
                      </Button>
                    </div>
                  </form>
                </Form>
              </DialogContent>
            </Dialog>
          </div>

          {camerasLoading ? (
            <div className="space-y-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <Card key={i}>
                  <CardContent className="p-4">
                    <div className="flex items-center gap-4">
                      <Skeleton className="h-12 w-12 rounded-md" />
                      <div className="flex-1 space-y-2">
                        <Skeleton className="h-4 w-1/3" />
                        <Skeleton className="h-3 w-1/4" />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : cameras && cameras.length > 0 ? (
            <div className="space-y-4">
              {cameras.map((camera) => {
                const isChecking = checkingCameraId === camera.id || camera.status === "checking";
                const statusVariant = camera.status === "online" ? "default" : 
                                     camera.status === "checking" ? "outline" : "secondary";
                return (
                  <Card key={camera.id} data-testid={`camera-card-${camera.id}`}>
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-4">
                          <div className={`flex h-12 w-12 items-center justify-center rounded-md ${
                            camera.status === "online" ? "bg-green-100 dark:bg-green-900/30" : 
                            camera.status === "checking" ? "bg-yellow-100 dark:bg-yellow-900/30" : 
                            "bg-muted"
                          }`}>
                            <Camera className={`h-6 w-6 ${
                              camera.status === "online" ? "text-green-600 dark:text-green-400" : 
                              camera.status === "checking" ? "text-yellow-600 dark:text-yellow-400" : 
                              "text-muted-foreground"
                            }`} />
                          </div>
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="font-medium">{camera.name}</p>
                              <Badge variant={statusVariant} className="gap-1">
                                {isChecking ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : camera.status === "online" ? (
                                  <Wifi className="h-3 w-3" />
                                ) : (
                                  <WifiOff className="h-3 w-3" />
                                )}
                                {isChecking ? "Checking..." : camera.status}
                              </Badge>
                            </div>
                            <p className="text-sm text-muted-foreground">
                              {parkingSites.find(s => s.id.toString() === String(camera.siteId))?.siteName || "No site assigned"}
                            </p>
                            <p className="font-mono text-xs text-muted-foreground">{camera.ipAddress}</p>
                            {camera.statusMessage && (
                              <p className="text-xs text-muted-foreground mt-1">{camera.statusMessage}</p>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            onClick={() => checkCameraMutation.mutate(camera.id)}
                            disabled={isChecking}
                            data-testid={`button-refresh-camera-${camera.id}`}
                          >
                            <RefreshCw className={`h-4 w-4 ${isChecking ? "animate-spin" : ""}`} />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => deleteCameraMutation.mutate(camera.id)}
                            data-testid={`button-delete-camera-${camera.id}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          ) : (
            <Card>
              <CardContent className="p-8 text-center">
                <Camera className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
                <p className="text-sm text-muted-foreground">No cameras configured</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="bays" className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-medium">Parking Bay Configuration</h2>
              <p className="text-sm text-muted-foreground">
                Define parking bays and their restriction types
              </p>
            </div>
            <Dialog open={isBayDialogOpen} onOpenChange={setIsBayDialogOpen}>
              <DialogTrigger asChild>
                <Button data-testid="button-add-bay">
                  <Plus className="h-4 w-4 mr-2" />
                  Add Bay
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add Parking Bay</DialogTitle>
                </DialogHeader>
                <Form {...bayForm}>
                  <form onSubmit={bayForm.handleSubmit((data) => addBayMutation.mutate(data))} className="space-y-4">
                    <FormField
                      control={bayForm.control}
                      name="name"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Bay Name</FormLabel>
                          <FormControl>
                            <Input placeholder="Bay A1" data-testid="input-bay-name" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={bayForm.control}
                      name="type"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Bay Type</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger data-testid="select-bay-type">
                                <SelectValue placeholder="Select type" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="disabled">Disabled</SelectItem>
                              <SelectItem value="ev">Electric Vehicle</SelectItem>
                              <SelectItem value="parent_child">Parent & Child</SelectItem>
                              <SelectItem value="standard">Standard</SelectItem>
                              <SelectItem value="loading">Loading</SelectItem>
                              <SelectItem value="permit">Permit Only</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={bayForm.control}
                      name="location"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Location (Optional)</FormLabel>
                          <FormControl>
                            <Input placeholder="Ground Floor" data-testid="input-bay-location" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <div className="flex justify-end gap-3 pt-2">
                      <Button type="button" variant="outline" onClick={() => setIsBayDialogOpen(false)}>Cancel</Button>
                      <Button type="submit" disabled={addBayMutation.isPending} data-testid="button-save-bay">
                        {addBayMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                        Add Bay
                      </Button>
                    </div>
                  </form>
                </Form>
              </DialogContent>
            </Dialog>
          </div>

          {baysLoading ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Card key={i}>
                  <CardContent className="p-4">
                    <Skeleton className="h-4 w-2/3 mb-2" />
                    <Skeleton className="h-3 w-1/2" />
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : bays && bays.length > 0 ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {bays.map((bay) => (
                <Card key={bay.id} data-testid={`bay-card-${bay.id}`}>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium">{bay.name}</p>
                        <Badge variant="outline" className="mt-1">
                          {bay.type.charAt(0).toUpperCase() + bay.type.slice(1).replace("_", " & ")}
                        </Badge>
                        {bay.location && (
                          <p className="text-xs text-muted-foreground mt-1">{bay.location}</p>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => deleteBayMutation.mutate(bay.id)}
                        data-testid={`button-delete-bay-${bay.id}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="p-8 text-center">
                <MapPin className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
                <p className="text-sm text-muted-foreground">No parking bays configured</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="ai" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">AI Detection Settings</CardTitle>
              <CardDescription>
                Configure detection thresholds and automation options
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-4">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <Label>Object Detection Threshold</Label>
                    <span className="text-sm font-medium">
                      {localAiSettings.detectionThreshold}%
                    </span>
                  </div>
                  <Slider
                    value={[localAiSettings.detectionThreshold]}
                    onValueChange={([value]) => setLocalAiSettings((s) => ({ ...s, detectionThreshold: value }))}
                    max={100}
                    min={50}
                    step={5}
                    data-testid="slider-detection-threshold"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Minimum confidence required to register object detections
                  </p>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <Label>ANPR Confidence Threshold</Label>
                    <span className="text-sm font-medium">
                      {localAiSettings.anprThreshold}%
                    </span>
                  </div>
                  <Slider
                    value={[localAiSettings.anprThreshold]}
                    onValueChange={([value]) => setLocalAiSettings((s) => ({ ...s, anprThreshold: value }))}
                    max={100}
                    min={50}
                    step={5}
                    data-testid="slider-anpr-threshold"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Minimum confidence for number plate recognition
                  </p>
                </div>
              </div>

              <div className="space-y-4 pt-4 border-t">
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Auto-Analyze Evidence</Label>
                    <p className="text-xs text-muted-foreground">
                      Automatically run AI analysis on new evidence
                    </p>
                  </div>
                  <Switch
                    checked={localAiSettings.autoAnalyze}
                    onCheckedChange={(checked) => setLocalAiSettings((s) => ({ ...s, autoAnalyze: checked }))}
                    data-testid="switch-auto-analyze"
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <Label>Auto-Generate PCN</Label>
                    <p className="text-xs text-muted-foreground">
                      Automatically generate PCNs for high-confidence violations
                    </p>
                  </div>
                  <Switch
                    checked={localAiSettings.autoPcn}
                    onCheckedChange={(checked) => setLocalAiSettings((s) => ({ ...s, autoPcn: checked }))}
                    data-testid="switch-auto-pcn"
                  />
                </div>
              </div>

              <div className="flex justify-end pt-4">
                <Button
                  onClick={() => updateAiSettingsMutation.mutate(localAiSettings)}
                  disabled={updateAiSettingsMutation.isPending}
                  data-testid="button-save-ai-settings"
                >
                  {updateAiSettingsMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4 mr-2" />
                  )}
                  Save Settings
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
