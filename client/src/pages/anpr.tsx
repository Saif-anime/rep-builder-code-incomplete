import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Car, Search, Filter, CheckCircle, AlertCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PlateDisplay } from "@/components/plate-display";
import { EmptyState } from "@/components/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";
import type { NumberPlate } from "@shared/schema";

export default function ANPRPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [validityFilter, setValidityFilter] = useState<string>("all");

  const { data: plates, isLoading } = useQuery<NumberPlate[]>({
    queryKey: ["/api/number-plates", { validity: validityFilter }],
  });

  const filteredPlates = plates?.filter((p) => {
    if (searchQuery) {
      return p.plateText.toLowerCase().includes(searchQuery.toLowerCase());
    }
    return true;
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">ANPR Results</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Automatic Number Plate Recognition captures and validation
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-green-500/10">
                <CheckCircle className="h-5 w-5 text-green-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">
                  {plates?.filter((p) => p.isValidUkFormat).length || 0}
                </p>
                <p className="text-xs text-muted-foreground">Valid UK Plates</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-orange-500/10">
                <AlertCircle className="h-5 w-5 text-orange-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">
                  {plates?.filter((p) => !p.isValidUkFormat).length || 0}
                </p>
                <p className="text-xs text-muted-foreground">Non-standard</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-blue-500/10">
                <Car className="h-5 w-5 text-blue-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{plates?.length || 0}</p>
                <p className="text-xs text-muted-foreground">Total Captures</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by plate number..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
            data-testid="input-search-anpr"
          />
        </div>
        <Select value={validityFilter} onValueChange={setValidityFilter}>
          <SelectTrigger className="w-[160px]" data-testid="select-validity-filter">
            <Filter className="h-4 w-4 mr-2" />
            <SelectValue placeholder="Validity" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Plates</SelectItem>
            <SelectItem value="valid">Valid UK</SelectItem>
            <SelectItem value="invalid">Non-standard</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <Card>
          <div className="p-4 space-y-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4">
                <Skeleton className="h-8 w-32" />
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-32" />
              </div>
            ))}
          </div>
        </Card>
      ) : filteredPlates && filteredPlates.length > 0 ? (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Plate Number</TableHead>
                <TableHead>Validity</TableHead>
                <TableHead>Confidence</TableHead>
                <TableHead>Evidence ID</TableHead>
                <TableHead>Captured</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredPlates.map((plate) => (
                <TableRow key={plate.id} data-testid={`anpr-row-${plate.id}`}>
                  <TableCell>
                    <div className="flex items-center gap-1 rounded-md border-2 border-yellow-400 bg-yellow-300 px-2 py-0.5 w-fit dark:border-yellow-500 dark:bg-yellow-400">
                      <span className="font-mono text-sm font-bold text-black">
                        {plate.plateText}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    {plate.isValidUkFormat ? (
                      <Badge variant="outline" className="gap-1 border-green-500/30 bg-green-500/10 text-green-600 dark:text-green-400">
                        <CheckCircle className="h-3 w-3" />
                        Valid UK
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="gap-1 border-orange-500/30 bg-orange-500/10 text-orange-600 dark:text-orange-400">
                        <AlertCircle className="h-3 w-3" />
                        Non-standard
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <span className="text-sm font-medium">
                      {Math.round(plate.confidence * 100)}%
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="font-mono text-xs">#{plate.evidenceId}</span>
                  </TableCell>
                  <TableCell>
                    <span className="font-mono text-xs text-muted-foreground">
                      {format(new Date(plate.createdAt), "dd/MM/yyyy HH:mm")}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      ) : (
        <EmptyState
          icon={Car}
          title="No ANPR Results"
          description="Number plate recognition results will appear here once evidence is processed."
        />
      )}
    </div>
  );
}
