import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import {
  Clock,
  Cloud,
  CloudRain,
  CloudSnow,
  Sun,
  Moon,
  Wind,
  Eye,
  Thermometer,
  Check,
  Loader2,
  Calendar,
  RefreshCw,
} from "lucide-react";

interface HourlyWeather {
  hour: number;
  time: string;
  temperature_c: number | null;
  humidity_percent: number | null;
  precipitation_mm: number | null;
  rain_mm: number | null;
  snowfall_mm: number | null;
  visibility_m: number | null;
  wind_speed_mph: number | null;
  wind_direction_deg: number | null;
  weather_code: number | null;
  weather_description: string | null;
  condition: string | null;
  is_day: boolean;
  severity: string;
}

interface HourlyWeatherResponse {
  hourly: HourlyWeather[] | null;
  date: string;
  site_id: number;
  site_name: string;
  site_postcode: string;
  message?: string;
}

interface Props {
  siteId: number;
  caseIdentifier?: string | number;
  defaultDate?: string;
  onWeatherSelected?: (weather: HourlyWeather) => void;
}

function getWeatherIcon(condition: string | null, isDay: boolean) {
  if (!condition) return <Cloud className="h-4 w-4" />;
  
  const iconMap: Record<string, typeof Cloud> = {
    Clear: isDay ? Sun : Moon,
    Cloudy: Cloud,
    Rain: CloudRain,
    Snow: CloudSnow,
    Fog: Cloud,
    Ice: CloudSnow,
    Storm: CloudRain,
  };
  
  const Icon = iconMap[condition] || Cloud;
  return <Icon className="h-4 w-4" />;
}

function getSeverityColor(severity: string) {
  switch (severity) {
    case "Normal":
      return "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400";
    case "Reduced Visibility":
      return "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400";
    case "Adverse":
      return "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400";
    case "Severe":
      return "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400";
    default:
      return "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400";
  }
}

function formatHour(hour: number) {
  const period = hour >= 12 ? "PM" : "AM";
  const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return `${displayHour}:00 ${period}`;
}

export function HourlyWeatherSelector({
  siteId,
  caseIdentifier,
  defaultDate,
  onWeatherSelected,
}: Props) {
  const [open, setOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState(
    defaultDate || new Date().toISOString().split("T")[0]
  );
  const [selectedHour, setSelectedHour] = useState<number | null>(null);
  const { toast } = useToast();

  const { data, isLoading, refetch } = useQuery<HourlyWeatherResponse>({
    queryKey: [`/api/evidence/weather/${siteId}/hourly`, selectedDate],
    queryFn: async () => {
      const token = localStorage.getItem("auth_token");
      const headers: HeadersInit = {};
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
      const response = await fetch(
        `/api/evidence/weather/${siteId}/hourly?date=${selectedDate}`,
        { credentials: "include", headers }
      );
      if (!response.ok) throw new Error("Failed to fetch weather");
      return response.json();
    },
    enabled: open && !!siteId,
  });

  const selectMutation = useMutation({
    mutationFn: async (hour: number) => {
      const response = await apiRequest("POST", `/api/evidence/weather/${siteId}/select-hour`, {
        date: selectedDate,
        hour,
        case_identifier: caseIdentifier,
      });
      return response.json();
    },
    onSuccess: (result) => {
      toast({
        title: "Weather Updated",
        description: `Selected ${formatHour(result.weather.hour)} weather for analysis`,
      });
      
      if (caseIdentifier) {
        queryClient.invalidateQueries({ queryKey: [`/api/cases/${caseIdentifier}/weather`] });
        queryClient.invalidateQueries({ queryKey: [`/api/cases/${caseIdentifier}/pipeline/results`] });
      }
      
      if (onWeatherSelected && result.weather) {
        onWeatherSelected(result.weather);
      }
      
      setOpen(false);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to select weather",
        variant: "destructive",
      });
    },
  });

  const handleSelectHour = (hour: number) => {
    setSelectedHour(hour);
    selectMutation.mutate(hour);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          data-testid="button-select-weather-hour"
        >
          <Clock className="h-3 w-3 mr-1" />
          Select Hour
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Cloud className="h-5 w-5" />
            Select Weather Hour
          </DialogTitle>
          <DialogDescription>
            Choose a specific hour to use for weather analysis
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <Label htmlFor="weather-date" className="text-xs text-muted-foreground">
                Date
              </Label>
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <Input
                  id="weather-date"
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="w-auto"
                  data-testid="input-weather-date"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => refetch()}
                  disabled={isLoading}
                  data-testid="button-refresh-weather"
                >
                  <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
                </Button>
              </div>
            </div>

            {data?.site_name && (
              <div className="text-right">
                <p className="text-xs text-muted-foreground">Site</p>
                <p className="text-sm font-medium">{data.site_name}</p>
                <p className="text-xs text-muted-foreground">{data.site_postcode}</p>
              </div>
            )}
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              <span className="ml-2 text-sm text-muted-foreground">Loading hourly weather...</span>
            </div>
          ) : data?.message ? (
            <div className="text-center py-8 text-muted-foreground">
              {data.message}
            </div>
          ) : data?.hourly ? (
            <ScrollArea className="h-[400px] pr-4">
              <div className="space-y-2">
                {data.hourly.map((hour) => (
                  <button
                    key={hour.hour}
                    onClick={() => handleSelectHour(hour.hour)}
                    disabled={selectMutation.isPending}
                    className={`w-full p-3 rounded-lg border text-left transition-all hover-elevate ${
                      selectedHour === hour.hour
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-primary/50"
                    }`}
                    data-testid={`button-hour-${hour.hour}`}
                  >
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <div className="flex flex-col items-center w-16">
                          <span className="text-sm font-medium">
                            {formatHour(hour.hour)}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {hour.is_day ? "Day" : "Night"}
                          </span>
                        </div>

                        <div className="flex items-center gap-2">
                          {getWeatherIcon(hour.condition, hour.is_day)}
                          <span className="text-sm">{hour.weather_description}</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-4 text-xs">
                        {hour.temperature_c !== null && (
                          <div className="flex items-center gap-1">
                            <Thermometer className="h-3 w-3 text-orange-500" />
                            <span>{hour.temperature_c.toFixed(1)}°C</span>
                          </div>
                        )}

                        {hour.wind_speed_mph !== null && (
                          <div className="flex items-center gap-1">
                            <Wind className="h-3 w-3 text-gray-500" />
                            <span>{hour.wind_speed_mph.toFixed(0)} mph</span>
                          </div>
                        )}

                        {hour.visibility_m !== null && (
                          <div className="flex items-center gap-1">
                            <Eye className="h-3 w-3 text-purple-500" />
                            <span>
                              {hour.visibility_m >= 1000
                                ? `${(hour.visibility_m / 1000).toFixed(1)}km`
                                : `${hour.visibility_m}m`}
                            </span>
                          </div>
                        )}

                        {hour.precipitation_mm !== null && hour.precipitation_mm > 0 && (
                          <div className="flex items-center gap-1 text-blue-500">
                            <CloudRain className="h-3 w-3" />
                            <span>{hour.precipitation_mm.toFixed(1)}mm</span>
                          </div>
                        )}

                        <Badge className={`text-xs ${getSeverityColor(hour.severity)}`}>
                          {hour.severity}
                        </Badge>

                        {selectMutation.isPending && selectedHour === hour.hour ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Check className="h-4 w-4 text-muted-foreground/30" />
                        )}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </ScrollArea>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              No weather data available
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
