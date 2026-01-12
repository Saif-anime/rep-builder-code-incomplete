import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/lib/theme-provider";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { ResponsiveHeader } from "@/components/responsive-header";
import { Loader2 } from "lucide-react";

import LoginPage from "@/pages/login";
import DashboardPage from "@/pages/dashboard";
import EvidencePage from "@/pages/evidence";
import UsersPage from "@/pages/users";
import AdminSitesPage from "@/pages/admin-sites";
import SiteSignagePage from "@/pages/site-signage";
import SiteIntelligencePage from "@/pages/site-intelligence";
import FlaggedSessionsPage from "@/pages/flagged-sessions";
import RecommendationsPage from "@/pages/recommendations";
import SettingsPage from "@/pages/settings";
import NotFound from "@/pages/not-found";
import AnprScansPage from "@/pages/anpr-scans";

function ProtectedRoutes() {
  const [location] = useLocation();

  return (
    <Switch location={location}>
      <Route path="/" component={DashboardPage} />
      <Route path="/evidence" component={EvidencePage} />
      <Route path="/admin/users" component={UsersPage} />
      <Route path="/admin/sites" component={AdminSitesPage} />
      <Route path="/sites/:siteId/signage" component={SiteSignagePage} />
      <Route path="/sites/:siteId/intelligence" component={SiteIntelligencePage} />
      <Route path="/flagged-sessions" component={FlaggedSessionsPage} />
      <Route path="/recommendations" component={RecommendationsPage} />
      <Route path="/settings" component={SettingsPage} />
      <Route path="/anpr-scans" component={AnprScansPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function AppLayout() {
  const { isAuthenticated, isLoading } = useAuth();
  const [location] = useLocation();

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  return (
    <SidebarProvider style={style as React.CSSProperties}>
      <div className="flex h-screen w-full">
        <AppSidebar />
        <SidebarInset className="flex flex-col flex-1 overflow-hidden">
          <ResponsiveHeader />
          <main className="flex-1 overflow-auto p-3 sm:p-4 md:p-6">
            <ProtectedRoutes />
          </main>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider defaultTheme="light" storageKey="euro-parking-theme">
        <TooltipProvider>
          <AuthProvider>
            <AppLayout />
            <Toaster />
          </AuthProvider>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
