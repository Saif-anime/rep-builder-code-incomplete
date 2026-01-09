import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Camera, Filter, RefreshCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EvidenceCard } from "@/components/evidence-card";
import { EvidenceCardSkeleton } from "@/components/loading-skeleton";
import { EmptyState } from "@/components/empty-state";
import type { Evidence } from "@shared/schema";

export default function CameraEvidencePage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [cameraFilter, setCameraFilter] = useState<string>("all");

  const { data: evidence, isLoading, refetch, isRefetching } = useQuery<Evidence[]>({
    queryKey: ["/api/evidence", { type: "camera", status: statusFilter, camera: cameraFilter }],
  });

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
          <h1 className="text-2xl font-semibold">Camera Evidence</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Review evidence captured automatically by connected cameras
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => refetch()}
          disabled={isRefetching}
          data-testid="button-refresh-evidence"
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${isRefetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by ID or notes..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
            data-testid="input-search-evidence"
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
        <Select value={cameraFilter} onValueChange={setCameraFilter}>
          <SelectTrigger className="w-[140px]" data-testid="select-camera-filter">
            <Camera className="h-4 w-4 mr-2" />
            <SelectValue placeholder="Camera" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Cameras</SelectItem>
            <SelectItem value="1">Camera 1</SelectItem>
            <SelectItem value="2">Camera 2</SelectItem>
            <SelectItem value="3">Camera 3</SelectItem>
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
          icon={Camera}
          title="No Camera Evidence"
          description="Camera evidence will appear here once cameras are connected and configured."
        />
      )}
    </div>
  );
}
