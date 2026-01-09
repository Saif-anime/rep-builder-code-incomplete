import { useState, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Upload,
  FileImage,
  FileVideo,
  X,
  Loader2,
  Search,
  Filter,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Form,
  FormControl,
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
import { EvidenceCard } from "@/components/evidence-card";
import { EvidenceCardSkeleton } from "@/components/loading-skeleton";
import { EmptyState } from "@/components/empty-state";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Evidence } from "@shared/schema";

const uploadSchema = z.object({
  bayId: z.string().optional(),
  violationType: z.string().min(1, "Violation type is required"),
  notes: z.string().optional(),
});

type UploadFormValues = z.infer<typeof uploadSchema>;

export default function ManualUploadPage() {
  const { toast } = useToast();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const { data: evidence, isLoading } = useQuery<Evidence[]>({
    queryKey: ["/api/evidence", { type: "manual", status: statusFilter }],
  });

  const form = useForm<UploadFormValues>({
    resolver: zodResolver(uploadSchema),
    defaultValues: {
      bayId: "",
      violationType: "",
      notes: "",
    },
  });

  const uploadMutation = useMutation({
    mutationFn: async (data: UploadFormValues) => {
      const formData = new FormData();
      selectedFiles.forEach((file) => formData.append("files", file));
      formData.append("violationType", data.violationType);
      if (data.bayId) formData.append("bayId", data.bayId);
      if (data.notes) formData.append("notes", data.notes);

      const response = await fetch("/api/evidence/upload", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) throw new Error("Upload failed");
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Evidence uploaded",
        description: "The evidence has been uploaded successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/evidence"] });
      setSelectedFiles([]);
      form.reset();
      setIsDialogOpen(false);
    },
    onError: () => {
      toast({
        title: "Upload failed",
        description: "Failed to upload evidence. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files).filter(
      (file) => file.type.startsWith("image/") || file.type.startsWith("video/")
    );
    setSelectedFiles((prev) => [...prev, ...files]);
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const files = Array.from(e.target.files);
      setSelectedFiles((prev) => [...prev, ...files]);
    }
  }, []);

  const removeFile = (index: number) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const filteredEvidence = evidence?.filter((e) => {
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      return (
        e.id.toString().includes(query) ||
        e.notes?.toLowerCase().includes(query)
      );
    }
    return true;
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Manual Uploads</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Upload and manage manually collected evidence
          </p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-upload-evidence">
              <Upload className="h-4 w-4 mr-2" />
              Upload Evidence
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Upload Evidence</DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form
                onSubmit={form.handleSubmit((data) => uploadMutation.mutate(data))}
                className="space-y-4"
              >
                <div
                  className={`relative flex min-h-40 cursor-pointer flex-col items-center justify-center rounded-md border-2 border-dashed transition-colors ${
                    isDragging
                      ? "border-primary bg-primary/5"
                      : "border-muted-foreground/25 hover:border-primary/50"
                  }`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDragging(true);
                  }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={handleDrop}
                  onClick={() => document.getElementById("file-upload")?.click()}
                  data-testid="dropzone-upload"
                >
                  <input
                    id="file-upload"
                    type="file"
                    multiple
                    accept="image/*,video/*"
                    className="hidden"
                    onChange={handleFileSelect}
                  />
                  <Upload className="h-8 w-8 text-muted-foreground mb-2" />
                  <p className="text-sm text-muted-foreground">
                    Drag & drop files or click to browse
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Images and videos only
                  </p>
                </div>

                {selectedFiles.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-sm font-medium">
                      Selected files ({selectedFiles.length})
                    </p>
                    <div className="max-h-32 overflow-y-auto space-y-1">
                      {selectedFiles.map((file, index) => (
                        <div
                          key={index}
                          className="flex items-center justify-between rounded-md bg-muted px-3 py-2"
                        >
                          <div className="flex items-center gap-2">
                            {file.type.startsWith("image/") ? (
                              <FileImage className="h-4 w-4 text-blue-500" />
                            ) : (
                              <FileVideo className="h-4 w-4 text-purple-500" />
                            )}
                            <span className="text-sm truncate max-w-[200px]">
                              {file.name}
                            </span>
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={(e) => {
                              e.stopPropagation();
                              removeFile(index);
                            }}
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <FormField
                  control={form.control}
                  name="violationType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Violation Type *</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-violation-type">
                            <SelectValue placeholder="Select violation type" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="disabled_bay">Disabled Bay</SelectItem>
                          <SelectItem value="ev_bay">EV Bay</SelectItem>
                          <SelectItem value="parent_child">Parent & Child</SelectItem>
                          <SelectItem value="overstay">Overstay</SelectItem>
                          <SelectItem value="no_permit">No Permit</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="bayId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Bay (Optional)</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-bay">
                            <SelectValue placeholder="Select bay" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="1">Bay 1 - Disabled</SelectItem>
                          <SelectItem value="2">Bay 2 - EV</SelectItem>
                          <SelectItem value="3">Bay 3 - Parent & Child</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="notes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Officer Notes</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder="Add any relevant notes about this evidence..."
                          className="resize-none"
                          data-testid="textarea-notes"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="flex justify-end gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setIsDialogOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={selectedFiles.length === 0 || uploadMutation.isPending}
                    data-testid="button-submit-upload"
                  >
                    {uploadMutation.isPending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Uploading...
                      </>
                    ) : (
                      "Upload Evidence"
                    )}
                  </Button>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by ID or notes..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
            data-testid="input-search-manual"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[140px]" data-testid="select-status-filter">
            <Filter className="h-4 w-4 mr-2" />
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="reviewed">Reviewed</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <EvidenceCardSkeleton key={i} />
          ))}
        </div>
      ) : filteredEvidence && filteredEvidence.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filteredEvidence.map((e) => (
            <EvidenceCard
              key={e.id}
              evidence={e}
              onClick={() => {}}
              onDownload={() => {}}
            />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={Upload}
          title="No Manual Evidence"
          description="Upload evidence manually to get started."
          action={{
            label: "Upload Evidence",
            onClick: () => setIsDialogOpen(true),
          }}
        />
      )}
    </div>
  );
}
