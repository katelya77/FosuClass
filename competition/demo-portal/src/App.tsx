import { useState, type ReactElement } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Clapperboard, ExternalLink } from "lucide-react";

import { BrandMark } from "./components/BrandMark";
import { GuidedDemo } from "./components/GuidedDemo";
import { MobileNav } from "./components/MobileNav";
import { Sidebar } from "./components/Sidebar";
import { DEFAULT_ADP_CHAT_URL } from "./lib/adp";
import { useHashRoute, useNavigate, type Route } from "./lib/router";
import { AboutPage } from "./pages/AboutPage";
import { AdpDiagnosticsPage } from "./pages/AdpDiagnosticsPage";
import { CapabilityPage } from "./pages/CapabilityPage";
import { CasesPage } from "./pages/CasesPage";
import { ExperiencePage } from "./pages/ExperiencePage";
import { HomePage } from "./pages/HomePage";

interface PageOutletProps {
  route: Route;
  onNavigate: (route: Route) => void;
  onQuickDemo: () => void;
}

function PageOutlet({ route, onNavigate, onQuickDemo }: PageOutletProps): ReactElement {
  switch (route.name) {
    case "experience":
      return (
        <ExperiencePage
          key={`experience-${route.caseKey ?? "default"}`}
          caseKey={route.caseKey}
          onNavigate={onNavigate}
        />
      );
    case "adp-diagnostics":
      return <AdpDiagnosticsPage onNavigate={onNavigate} />;
    case "capability":
      return <CapabilityPage onNavigate={onNavigate} />;
    case "cases":
      return <CasesPage onNavigate={onNavigate} />;
    case "about":
      return <AboutPage onNavigate={onNavigate} />;
    default:
      return <HomePage onNavigate={onNavigate} onQuickDemo={onQuickDemo} />;
  }
}

export function App(): ReactElement {
  const route = useHashRoute();
  const onNavigate = useNavigate();
  const [demoOpen, setDemoOpen] = useState(false);

  const openDemo = () => setDemoOpen(true);
  const closeDemo = () => setDemoOpen(false);

  return (
    <div className="relative min-h-screen">
      <div className="app-backdrop" aria-hidden />
      <span className="app-blob animate-drift-slow left-[-7rem] top-[-5rem] h-[26rem] w-[26rem] bg-rose/60" />
      <span className="app-blob animate-drift right-[-5rem] top-[16rem] h-[22rem] w-[22rem] bg-lavender/60" />
      <span className="app-blob animate-float bottom-[-6rem] left-[40%] h-[24rem] w-[24rem] bg-peach/60" />

      <div className="fixed bottom-4 left-4 top-4 z-40 hidden w-[248px] lg:block">
        <Sidebar current={route} onNavigate={onNavigate} />
      </div>

      <main className="relative lg:pl-[280px]">
        <header className="sticky top-0 z-30 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-white/20 bg-white/18 px-4 py-3 backdrop-blur-xl sm:px-6 lg:justify-end">
          <div className="lg:hidden">
            <BrandMark size="sm" />
          </div>
          <div className="flex items-center gap-2">
            <a
              href={DEFAULT_ADP_CHAT_URL}
              target="_blank"
              rel="noreferrer noopener"
              className="glass-button px-3.5 py-2 text-xs sm:text-sm"
            >
              <ExternalLink size={14} />
              打开完整小序
            </a>
            <button onClick={openDemo} className="brand-button px-3.5 py-2 text-xs sm:text-sm">
              <Clapperboard size={14} />
              比赛演示模式
            </button>
          </div>
        </header>

        <AnimatePresence mode="wait">
          <motion.div
            key={`${route.name}:${route.name === "experience" ? (route.caseKey ?? "default") : ""}`}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
          >
            <PageOutlet route={route} onNavigate={onNavigate} onQuickDemo={openDemo} />
          </motion.div>
        </AnimatePresence>
      </main>

      <MobileNav current={route} onNavigate={onNavigate} />
      <GuidedDemo open={demoOpen} onClose={closeDemo} onReplay={() => undefined} />
    </div>
  );
}
