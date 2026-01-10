import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

export interface TableColumn<T> {
  key: string;
  header: string;
  render: (item: T) => React.ReactNode;
  mobileVisible?: boolean;
  priority?: number;
}

interface ResponsiveTableProps<T> {
  data: T[];
  columns: TableColumn<T>[];
  keyExtractor: (item: T) => string | number;
  onRowClick?: (item: T) => void;
  emptyMessage?: string;
  mobileCardTitle?: (item: T) => React.ReactNode;
  mobileCardSubtitle?: (item: T) => React.ReactNode;
  mobileCardBadge?: (item: T) => React.ReactNode;
  className?: string;
}

export function ResponsiveTable<T>({
  data,
  columns,
  keyExtractor,
  onRowClick,
  emptyMessage = "No data available",
  mobileCardTitle,
  mobileCardSubtitle,
  mobileCardBadge,
  className,
}: ResponsiveTableProps<T>) {
  const isMobile = useIsMobile();
  const [expandedRows, setExpandedRows] = useState<Set<string | number>>(new Set());

  const toggleRow = (key: string | number) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  if (data.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        {emptyMessage}
      </div>
    );
  }

  const mobileVisibleColumns = columns.filter(c => c.mobileVisible !== false);
  const hiddenOnMobileColumns = columns.filter(c => c.mobileVisible === false);

  if (isMobile) {
    return (
      <div className={cn("space-y-3", className)}>
        {data.map((item) => {
          const key = keyExtractor(item);
          const isExpanded = expandedRows.has(key);
          const hasHiddenContent = hiddenOnMobileColumns.length > 0;

          return (
            <Card 
              key={key} 
              className={cn(
                "overflow-hidden",
                onRowClick && "cursor-pointer hover-elevate"
              )}
              data-testid={`table-card-${key}`}
            >
              <Collapsible open={isExpanded} onOpenChange={() => hasHiddenContent && toggleRow(key)}>
                <div 
                  className="p-4"
                  onClick={() => !hasHiddenContent && onRowClick?.(item)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0 space-y-1">
                      {mobileCardTitle && (
                        <div className="font-medium truncate">
                          {mobileCardTitle(item)}
                        </div>
                      )}
                      {mobileCardSubtitle && (
                        <div className="text-sm text-muted-foreground truncate">
                          {mobileCardSubtitle(item)}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {mobileCardBadge && mobileCardBadge(item)}
                      {hasHiddenContent && (
                        <CollapsibleTrigger asChild>
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-8 w-8"
                            aria-label={isExpanded ? "Collapse details" : "Expand details"}
                          >
                            {isExpanded ? (
                              <ChevronDown className="h-4 w-4" />
                            ) : (
                              <ChevronRight className="h-4 w-4" />
                            )}
                          </Button>
                        </CollapsibleTrigger>
                      )}
                    </div>
                  </div>
                  
                  <div className="mt-3 grid gap-2">
                    {mobileVisibleColumns.slice(0, 3).map((col) => (
                      <div key={col.key} className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">{col.header}</span>
                        <span className="font-medium text-right">{col.render(item)}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {hasHiddenContent && (
                  <CollapsibleContent>
                    <div className="px-4 pb-4 pt-0 border-t space-y-2">
                      {hiddenOnMobileColumns.map((col) => (
                        <div key={col.key} className="flex items-start justify-between text-sm py-2">
                          <span className="text-muted-foreground shrink-0">{col.header}</span>
                          <span className="font-medium text-right ml-4">{col.render(item)}</span>
                        </div>
                      ))}
                      {onRowClick && (
                        <Button 
                          variant="outline" 
                          size="sm" 
                          className="w-full mt-2"
                          onClick={() => onRowClick(item)}
                        >
                          View Details
                        </Button>
                      )}
                    </div>
                  </CollapsibleContent>
                )}
              </Collapsible>
            </Card>
          );
        })}
      </div>
    );
  }

  return (
    <div className={cn("rounded-md border overflow-hidden", className)}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              {columns.map((col) => (
                <th 
                  key={col.key} 
                  className="h-12 px-4 text-left align-middle font-medium text-muted-foreground whitespace-nowrap"
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((item) => {
              const key = keyExtractor(item);
              return (
                <tr 
                  key={key}
                  className={cn(
                    "border-b transition-colors",
                    onRowClick && "cursor-pointer hover:bg-muted/50"
                  )}
                  onClick={() => onRowClick?.(item)}
                  data-testid={`table-row-${key}`}
                >
                  {columns.map((col) => (
                    <td key={col.key} className="p-4 align-middle">
                      {col.render(item)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
