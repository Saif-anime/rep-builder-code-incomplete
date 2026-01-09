import { useQuery } from "@tanstack/react-query";
import {
  Camera,
  FileText,
  AlertTriangle,
  CheckCircle,
  Clock,
  Car,
  MapPin,
  HardDrive,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatCard } from "@/components/stat-card";
import { ActivityItem } from "@/components/activity-item";
import { DashboardSkeleton } from "@/components/loading-skeleton";
import { ConfidenceMeter } from "@/components/confidence-meter";
import { ViolationBadge } from "@/components/violation-badge";
import { format } from "date-fns";

interface DashboardStats {
  pendingReview: number;
  totalViolations: number;
  processedToday: number;
  activeCameras: number;
  totalSites: number;
  storageUsed: string;
  recentEvents: Array<{
    id: number;
    violationType: string;
    plateText: string;
    timestamp: string;
    confidence: number;
    status: string;
  }>;
  recentActivity: Array<{
    id: number;
    action: string;
    entityType: string;
    entityId: string;
    userName: string;
    timestamp: string;
    details?: string;
  }>;
}

export default function DashboardPage() {
  const { data: stats, isLoading } = useQuery<DashboardStats>({
    queryKey: ["/api/dashboard/stats"],
  });

  if (isLoading) {
    return <DashboardSkeleton />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Overview of parking enforcement activity
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Pending Review"
          value={stats?.pendingReview || 0}
          icon={Clock}
          trend={{ value: 12, isPositive: false }}
          description="Awaiting officer review"
        />
        <StatCard
          title="Violations Today"
          value={stats?.totalViolations || 0}
          icon={AlertTriangle}
          trend={{ value: 8, isPositive: true }}
          description="Confirmed violations"
        />
        <StatCard
          title="Processed Today"
          value={stats?.processedToday || 0}
          icon={CheckCircle}
          trend={{ value: 15, isPositive: true }}
          description="Evidence items reviewed"
        />
        <StatCard
          title="Active Cameras"
          value={stats?.activeCameras || 0}
          icon={Camera}
          description="Online and recording"
        />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-blue-500/10">
                <MapPin className="h-5 w-5 text-blue-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats?.totalSites || 0}</p>
                <p className="text-xs text-muted-foreground">Active Sites</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-purple-500/10">
                <HardDrive className="h-5 w-5 text-purple-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats?.storageUsed || "0 GB"}</p>
                <p className="text-xs text-muted-foreground">Storage Used</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-green-500/10">
                <Car className="h-5 w-5 text-green-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">
                  {(stats?.recentEvents?.length || 0) > 0 ? stats?.recentEvents.length : 0}
                </p>
                <p className="text-xs text-muted-foreground">Recent ANPR Captures</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg font-medium flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Recent Violations
            </CardTitle>
          </CardHeader>
          <CardContent>
            {stats?.recentEvents && stats.recentEvents.length > 0 ? (
              <div className="space-y-4">
                {stats.recentEvents.slice(0, 5).map((event) => (
                  <div
                    key={event.id}
                    className="flex items-center justify-between gap-4 rounded-md border p-3"
                    data-testid={`event-item-${event.id}`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-md bg-muted">
                        <Car className="h-5 w-5 text-muted-foreground" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-sm">
                            {event.plateText}
                          </span>
                          <ViolationBadge type={event.violationType} showIcon={false} />
                        </div>
                        <span className="font-mono text-xs text-muted-foreground">
                          {format(new Date(event.timestamp), "dd/MM/yyyy HH:mm")}
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <Badge
                        variant={event.status === "confirmed" ? "default" : "secondary"}
                      >
                        {event.status}
                      </Badge>
                      <ConfidenceMeter
                        value={event.confidence}
                        showLabel={false}
                        size="sm"
                        className="w-16"
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <AlertTriangle className="h-10 w-10 text-muted-foreground/50 mb-3" />
                <p className="text-sm text-muted-foreground">No recent violations</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg font-medium flex items-center gap-2">
              <Clock className="h-5 w-5" />
              Recent Activity
            </CardTitle>
          </CardHeader>
          <CardContent>
            {stats?.recentActivity && stats.recentActivity.length > 0 ? (
              <div className="divide-y">
                {stats.recentActivity.slice(0, 6).map((activity) => (
                  <ActivityItem
                    key={activity.id}
                    action={activity.action}
                    entityType={activity.entityType}
                    entityId={activity.entityId}
                    userName={activity.userName}
                    timestamp={new Date(activity.timestamp)}
                    details={activity.details}
                  />
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <Clock className="h-10 w-10 text-muted-foreground/50 mb-3" />
                <p className="text-sm text-muted-foreground">No recent activity</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
