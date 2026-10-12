import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { DemoProvider } from "./components/GuidedDemo";
import { Layout } from "./components/Layout";
import { AppProvider } from "./hooks/useApp";
import Agents from "./pages/Agents";
import Alerts from "./pages/Alerts";
import AuditTrail from "./pages/AuditTrail";
import CapabilityMap from "./pages/CapabilityMap";
import CICD from "./pages/CICD";
import Dashboard from "./pages/Dashboard";
import HowItWorks from "./pages/HowItWorks";
import Inspector from "./pages/Inspector";
import Integrations from "./pages/Integrations";
import LiveMonitor from "./pages/LiveMonitor";
import Metrics from "./pages/Metrics";
import PolicyStudio from "./pages/PolicyStudio";
import RedTeamLab from "./pages/RedTeamLab";
import SettingsPage from "./pages/SettingsPage";
import TestDemo from "./pages/TestDemo";
import WhatItDoes from "./pages/WhatItDoes";

export default function App() {
  return (
    <BrowserRouter>
      <AppProvider>
        <DemoProvider>
          <Routes>
            <Route element={<Layout />}>
              <Route path="/" element={<Dashboard />} />
              <Route path="/agents" element={<Agents />} />
              <Route path="/monitor" element={<LiveMonitor />} />
              <Route path="/alerts" element={<Alerts />} />
              <Route path="/inspector" element={<Inspector />} />
              <Route path="/inspector/:eventId" element={<Inspector />} />
              <Route path="/capabilities" element={<CapabilityMap />} />
              <Route path="/policies" element={<PolicyStudio />} />
              <Route path="/redteam" element={<RedTeamLab />} />
              <Route path="/metrics" element={<Metrics />} />
              <Route path="/audit" element={<AuditTrail />} />
              <Route path="/integrations" element={<Integrations />} />
              <Route path="/cicd" element={<CICD />} />
              <Route path="/what-it-does" element={<WhatItDoes />} />
              <Route path="/test-demo" element={<TestDemo />} />
              <Route path="/how-it-works" element={<HowItWorks />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </DemoProvider>
      </AppProvider>
    </BrowserRouter>
  );
}
