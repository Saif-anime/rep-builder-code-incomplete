import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Plus, Upload, Edit, Trash2, MapPin, Loader2, FileJson, AlertTriangle, Search, ClipboardCheck } from "lucide-react";
import { Link } from "wouter";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import type { ParkingSite } from "@shared/schema";

interface SiteFormData {
  siteName: string;
  locationCode: string;
  addressLine1: string;
  city: string;
  postcode: string;
  regulations: string;
  totalBays: number;
  disabledBays: number;
  evBays: number;
  parentChildBays: number;
}

export default function AdminSitesPage() {
  const { toast } = useToast();
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editSite, setEditSite] = useState<ParkingSite | null>(null);
  const [deleteSite, setDeleteSite] = useState<ParkingSite | null>(null);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<any[] | null>(null);

  const form = useForm<SiteFormData>({
    defaultValues: {
      siteName: "",
      locationCode: "",
      addressLine1: "",
      city: "",
      postcode: "",
      regulations: "",
      totalBays: 0,
      disabledBays: 0,
      evBays: 0,
      parentChildBays: 0,
    },
  });

  const { data: sites = [], isLoading } = useQuery<ParkingSite[]>({
    queryKey: ["/api/parking-sites"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: SiteFormData) => {
      const res = await apiRequest("POST", "/api/parking-sites", data);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Parking site created successfully" });
      setAddDialogOpen(false);
      form.reset();
      queryClient.invalidateQueries({ queryKey: ["/api/parking-sites"] });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to create site", description: error.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: SiteFormData }) => {
      const res = await apiRequest("PUT", `/api/parking-sites/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Parking site updated successfully" });
      setEditSite(null);
      form.reset();
      queryClient.invalidateQueries({ queryKey: ["/api/parking-sites"] });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update site", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest("DELETE", `/api/parking-sites/${id}`);
    },
    onSuccess: () => {
      toast({ title: "Parking site deleted successfully" });
      setDeleteSite(null);
      queryClient.invalidateQueries({ queryKey: ["/api/parking-sites"] });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to delete site", description: error.message, variant: "destructive" });
    },
  });

  const importMutation = useMutation({
    mutationFn: async (sites: any[]) => {
      const res = await apiRequest("POST", "/api/parking-sites/import-json", sites);
      return res.json();
    },
    onSuccess: (data: any) => {
      let message = `Imported ${data.imported} parking sites successfully`;
      if (data.skipped > 0) {
        message += ` (${data.skipped} skipped)`;
      }
      toast({ title: message });
      setImportDialogOpen(false);
      setImportFile(null);
      setImportPreview(null);
      queryClient.invalidateQueries({ queryKey: ["/api/parking-sites"] });
    },
    onError: (error: Error) => {
      const message = error.message.includes("413") 
        ? "File too large. Maximum size is 20MB." 
        : error.message.includes("400")
        ? "Invalid JSON format"
        : error.message;
      toast({ title: "Failed to import sites", description: message, variant: "destructive" });
    },
  });

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImportFile(file);
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const sitesArray = Array.isArray(data) ? data : [data];
      setImportPreview(sitesArray.slice(0, 5));
    } catch (err) {
      toast({ title: "Invalid JSON file", variant: "destructive" });
      setImportFile(null);
      setImportPreview(null);
    }
  };

  const handleImport = async () => {
    if (!importFile) return;
    const text = await importFile.text();
    const data = JSON.parse(text);
    const sitesArray = Array.isArray(data) ? data : [data];
    importMutation.mutate(sitesArray);
  };

  const handleEdit = (site: ParkingSite) => {
    setEditSite(site);
    form.reset({
      siteName: site.siteName,
      locationCode: site.locationCode || "",
      addressLine1: site.addressLine1 || "",
      city: site.city || "",
      postcode: site.postcode || "",
      regulations: site.regulations || "",
      totalBays: site.totalBays || 0,
      disabledBays: site.disabledBays || 0,
      evBays: site.evBays || 0,
      parentChildBays: site.parentChildBays || 0,
    });
  };

  const onSubmit = (data: SiteFormData) => {
    if (editSite) {
      updateMutation.mutate({ id: editSite.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const filteredSites = sites.filter((site) =>
    site.siteName.toLowerCase().includes(searchQuery.toLowerCase()) ||
    site.city?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    site.postcode?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    site.locationCode?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Parking Sites</h1>
          <p className="text-muted-foreground">Manage parking sites and their regulations</p>
        </div>
        <div className="flex items-center gap-2">
          <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" data-testid="button-import-json">
                <FileJson className="h-4 w-4 mr-2" />
                Import JSON
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>Import Parking Sites from JSON</DialogTitle>
              </DialogHeader>
              <div className="flex flex-col gap-4 py-4">
                <Input
                  ref={fileInputRef}
                  type="file"
                  accept=".json"
                  onChange={handleFileSelect}
                  data-testid="input-import-file"
                />
                {importPreview && (
                  <div className="border rounded-lg p-3 bg-muted/50">
                    <p className="text-sm font-medium mb-2">Preview ({importPreview.length} sites shown):</p>
                    <ScrollArea className="h-[200px]">
                      {importPreview.map((site, idx) => (
                        <div key={idx} className="text-xs mb-2 p-2 bg-background rounded">
                          <strong>{site.Name || site.siteName}</strong>
                          <br />
                          {site["Town/City"] || site.city} - {site.Postcode || site.postcode}
                        </div>
                      ))}
                    </ScrollArea>
                  </div>
                )}
                <Button 
                  onClick={handleImport} 
                  disabled={!importFile || importMutation.isPending}
                  data-testid="button-confirm-import"
                >
                  {importMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Importing...
                    </>
                  ) : (
                    "Import Sites"
                  )}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
          <Dialog open={addDialogOpen} onOpenChange={(open) => { setAddDialogOpen(open); if (!open) form.reset(); }}>
            <DialogTrigger asChild>
              <Button data-testid="button-add-site">
                <Plus className="h-4 w-4 mr-2" />
                Add Site
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>Add Parking Site</DialogTitle>
              </DialogHeader>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
                  <FormField
                    control={form.control}
                    name="siteName"
                    rules={{ required: "Site name is required" }}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Site Name</FormLabel>
                        <FormControl>
                          <Input {...field} placeholder="e.g., Euro Parking - Heathrow" data-testid="input-site-name" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="locationCode"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Location Code</FormLabel>
                        <FormControl>
                          <Input {...field} placeholder="e.g., EUR0011-182" data-testid="input-location-code" />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="addressLine1"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Address</FormLabel>
                        <FormControl>
                          <Input {...field} placeholder="Street address" data-testid="input-address" />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="city"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>City</FormLabel>
                          <FormControl>
                            <Input {...field} placeholder="City" data-testid="input-city" />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="postcode"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Postcode</FormLabel>
                          <FormControl>
                            <Input {...field} placeholder="Postcode" data-testid="input-postcode" />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                  </div>
                  <FormField
                    control={form.control}
                    name="regulations"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Regulations</FormLabel>
                        <FormControl>
                          <Textarea {...field} placeholder="Parking regulations..." className="resize-none" data-testid="input-regulations" />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <div className="grid grid-cols-4 gap-2">
                    <FormField
                      control={form.control}
                      name="totalBays"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Total</FormLabel>
                          <FormControl>
                            <Input type="number" {...field} onChange={(e) => field.onChange(parseInt(e.target.value) || 0)} data-testid="input-total-bays" />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="disabledBays"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Disabled</FormLabel>
                          <FormControl>
                            <Input type="number" {...field} onChange={(e) => field.onChange(parseInt(e.target.value) || 0)} data-testid="input-disabled-bays" />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="evBays"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>EV</FormLabel>
                          <FormControl>
                            <Input type="number" {...field} onChange={(e) => field.onChange(parseInt(e.target.value) || 0)} data-testid="input-ev-bays" />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="parentChildBays"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>P&C</FormLabel>
                          <FormControl>
                            <Input type="number" {...field} onChange={(e) => field.onChange(parseInt(e.target.value) || 0)} data-testid="input-parent-child-bays" />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                  </div>
                  <Button type="submit" disabled={createMutation.isPending} data-testid="button-submit-site">
                    {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add Site"}
                  </Button>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-4">
            <CardTitle className="flex items-center gap-2">
              <MapPin className="h-5 w-5" />
              All Sites ({sites.length})
            </CardTitle>
            <div className="relative w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search sites..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
                data-testid="input-search-sites"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : filteredSites.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12">
              <MapPin className="h-12 w-12 text-muted-foreground/50 mb-4" />
              <p className="text-lg font-medium text-muted-foreground">No parking sites found</p>
              <p className="text-sm text-muted-foreground">Add sites manually or import from JSON</p>
            </div>
          ) : (
            <ScrollArea className="h-[500px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Site Name</TableHead>
                    <TableHead>Location Code</TableHead>
                    <TableHead>City</TableHead>
                    <TableHead>Postcode</TableHead>
                    <TableHead className="text-center">Bays</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredSites.map((site) => (
                    <TableRow key={site.id} data-testid={`site-row-${site.id}`}>
                      <TableCell className="font-medium max-w-[200px] truncate">{site.siteName}</TableCell>
                      <TableCell className="font-mono text-xs">{site.locationCode || "-"}</TableCell>
                      <TableCell>{site.city || "-"}</TableCell>
                      <TableCell>{site.postcode || "-"}</TableCell>
                      <TableCell className="text-center">
                        <div className="flex items-center justify-center gap-1">
                          <Badge variant="outline" className="text-[10px]">{site.totalBays || 0}</Badge>
                          {(site.disabledBays || 0) > 0 && <Badge variant="secondary" className="text-[10px]">D:{site.disabledBays}</Badge>}
                          {(site.evBays || 0) > 0 && <Badge variant="secondary" className="text-[10px]">EV:{site.evBays}</Badge>}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Link href={`/signage/${site.id}`}>
                            <Button size="icon" variant="ghost" title="Signage Inspection" data-testid={`button-signage-site-${site.id}`}>
                              <ClipboardCheck className="h-4 w-4" />
                            </Button>
                          </Link>
                          <Button size="icon" variant="ghost" onClick={() => handleEdit(site)} data-testid={`button-edit-site-${site.id}`}>
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button size="icon" variant="ghost" onClick={() => setDeleteSite(site)} data-testid={`button-delete-site-${site.id}`}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!editSite} onOpenChange={(open) => { if (!open) { setEditSite(null); form.reset(); } }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Parking Site</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
              <FormField
                control={form.control}
                name="siteName"
                rules={{ required: "Site name is required" }}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Site Name</FormLabel>
                    <FormControl>
                      <Input {...field} data-testid="input-edit-site-name" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="locationCode"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Location Code</FormLabel>
                    <FormControl>
                      <Input {...field} data-testid="input-edit-location-code" />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="addressLine1"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Address</FormLabel>
                    <FormControl>
                      <Input {...field} data-testid="input-edit-address" />
                    </FormControl>
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="city"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>City</FormLabel>
                      <FormControl>
                        <Input {...field} data-testid="input-edit-city" />
                      </FormControl>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="postcode"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Postcode</FormLabel>
                      <FormControl>
                        <Input {...field} data-testid="input-edit-postcode" />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={form.control}
                name="regulations"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Regulations</FormLabel>
                    <FormControl>
                      <Textarea {...field} className="resize-none" data-testid="input-edit-regulations" />
                    </FormControl>
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-4 gap-2">
                <FormField
                  control={form.control}
                  name="totalBays"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Total</FormLabel>
                      <FormControl>
                        <Input type="number" {...field} onChange={(e) => field.onChange(parseInt(e.target.value) || 0)} data-testid="input-edit-total-bays" />
                      </FormControl>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="disabledBays"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Disabled</FormLabel>
                      <FormControl>
                        <Input type="number" {...field} onChange={(e) => field.onChange(parseInt(e.target.value) || 0)} data-testid="input-edit-disabled-bays" />
                      </FormControl>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="evBays"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>EV</FormLabel>
                      <FormControl>
                        <Input type="number" {...field} onChange={(e) => field.onChange(parseInt(e.target.value) || 0)} data-testid="input-edit-ev-bays" />
                      </FormControl>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="parentChildBays"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>P&C</FormLabel>
                      <FormControl>
                        <Input type="number" {...field} onChange={(e) => field.onChange(parseInt(e.target.value) || 0)} data-testid="input-edit-parent-child-bays" />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </div>
              <Button type="submit" disabled={updateMutation.isPending} data-testid="button-update-site">
                {updateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Update Site"}
              </Button>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteSite} onOpenChange={() => setDeleteSite(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Delete Parking Site
            </DialogTitle>
          </DialogHeader>
          <p>Are you sure you want to delete <strong>{deleteSite?.siteName}</strong>? This action cannot be undone.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteSite(null)}>Cancel</Button>
            <Button 
              variant="destructive" 
              onClick={() => deleteSite && deleteMutation.mutate(deleteSite.id)}
              disabled={deleteMutation.isPending}
              data-testid="button-confirm-delete"
            >
              {deleteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
