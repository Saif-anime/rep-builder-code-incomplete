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
    <div className="space-y-4 sm:space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-semibold">Dashboard</h1>
        <p className="text-xs sm:text-sm text-muted-foreground mt-1">
          Overview of parking enforcement activity
        </p>
      </div>

      <div className="grid gap-3 sm:gap-4 grid-cols-2 lg:grid-cols-4">
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

      <div className="grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-3">
        <Card>
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="flex h-8 w-8 sm:h-10 sm:w-10 items-center justify-center rounded-md bg-blue-500/10 shrink-0">
                <MapPin className="h-4 w-4 sm:h-5 sm:w-5 text-blue-500" />
              </div>
              <div className="min-w-0">
                <p className="text-lg sm:text-2xl font-bold">
                  {stats?.totalSites || 0}
                </p>
                <p className="text-xs text-muted-foreground truncate">Sites</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="flex h-8 w-8 sm:h-10 sm:w-10 items-center justify-center rounded-md bg-purple-500/10 shrink-0">
                <HardDrive className="h-4 w-4 sm:h-5 sm:w-5 text-purple-500" />
              </div>
              <div className="min-w-0">
                <p className="text-lg sm:text-2xl font-bold truncate">
                  {stats?.storageUsed || "0 GB"}
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  Storage
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="flex h-8 w-8 sm:h-10 sm:w-10 items-center justify-center rounded-md bg-green-500/10 shrink-0">
                <Car className="h-4 w-4 sm:h-5 sm:w-5 text-green-500" />
              </div>
              <div className="min-w-0">
                <p className="text-lg sm:text-2xl font-bold">
                  {(stats?.recentEvents?.length || 0) > 0
                    ? stats?.recentEvents.length
                    : 0}
                </p>
                <p className="text-xs text-muted-foreground truncate">ANPR</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 sm:gap-6 grid-cols-1 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3 px-3 sm:px-6">
            <CardTitle className="text-base sm:text-lg font-medium flex items-center gap-2">
              <FileText className="h-4 w-4 sm:h-5 sm:w-5" />
              Recent Violations
            </CardTitle>
          </CardHeader>
          <CardContent className="px-3 sm:px-6">
            {stats?.recentEvents && stats.recentEvents.length > 0 ? (
              <div className="space-y-3 sm:space-y-4">
                {stats.recentEvents.slice(0, 5).map((event) => (
                  <div
                    key={event.id}
                    className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-4 rounded-md border p-2 sm:p-3"
                    data-testid={`event-item-${event.id}`}
                  >
                    <div className="flex items-center gap-2 sm:gap-3">
                      <div className="flex h-8 w-8 sm:h-10 sm:w-10 items-center justify-center rounded-md bg-muted shrink-0">
                        <Car className="h-4 w-4 sm:h-5 sm:w-5 text-muted-foreground" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono font-bold text-xs sm:text-sm">
                            {event.plateText}
                          </span>
                          <ViolationBadge
                            type={event.violationType}
                            showIcon={false}
                          />
                        </div>
                        <span className="font-mono text-[10px] sm:text-xs text-muted-foreground">
                          {format(
                            new Date(event.timestamp),
                            "dd/MM/yyyy HH:mm",
                          )}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center sm:flex-col gap-2 sm:items-end ml-10 sm:ml-0">
                      <Badge
                        variant={
                          event.status === "confirmed" ? "default" : "secondary"
                        }
                        className="text-[10px] sm:text-xs"
                      >
                        {event.status}
                      </Badge>
                      <ConfidenceMeter
                        value={event.confidence}
                        showLabel={false}
                        size="sm"
                        className="w-12 sm:w-16"
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <AlertTriangle className="h-10 w-10 text-muted-foreground/50 mb-3" />
                <p className="text-sm text-muted-foreground">
                  No recent violations
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3 px-3 sm:px-6">
            <CardTitle className="text-base sm:text-lg font-medium flex items-center gap-2">
              <Clock className="h-4 w-4 sm:h-5 sm:w-5" />
              Recent Activity
            </CardTitle>
          </CardHeader>
          <CardContent className="px-3 sm:px-6">
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
                <p className="text-sm text-muted-foreground">
                  No recent activity
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
