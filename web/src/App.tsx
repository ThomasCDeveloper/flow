import { useCallback, useEffect, useState } from "react";
import { api, type ProjectInfo } from "./api";
import { Home } from "./Home";
import { ProjectView, isFocusShortcut } from "./ProjectView";

interface Tab {
  id: string;
  title: string;
}

const TABS_KEY = "flow.tabs";
const ACTIVE_KEY = "flow.active";

function loadTabs(): Tab[] {
  try {
    const tabs = JSON.parse(localStorage.getItem(TABS_KEY) ?? "[]");
    return Array.isArray(tabs) ? tabs : [];
  } catch {
    return [];
  }
}

export function App() {
  const [tabs, setTabs] = useState<Tab[]>(loadTabs);
  const [active, setActive] = useState<string>(() => localStorage.getItem(ACTIVE_KEY) ?? "home");

  useEffect(() => localStorage.setItem(TABS_KEY, JSON.stringify(tabs)), [tabs]);
  useEffect(() => localStorage.setItem(ACTIVE_KEY, active), [active]);

  const [focus, setFocus] = useState(false);
  const toggleFocus = useCallback(() => setFocus((f) => !f), []);
  useEffect(() => {
    if (active === "home") setFocus(false);
  }, [active]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (active === "home") return;
      if (isFocusShortcut(e)) {
        e.preventDefault();
        toggleFocus();
      } else if (e.key === "Escape" && focus && !e.defaultPrevented) {
        setFocus(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, focus, toggleFocus]);

  // Drop restored tabs whose projects can no longer be found.
  useEffect(() => {
    loadTabs().forEach((t) =>
      api.project(t.id).catch(() => setTabs((ts) => ts.filter((x) => x.id !== t.id))),
    );
  }, []);

  useEffect(() => {
    if (active !== "home" && !tabs.some((t) => t.id === active)) setActive("home");
  }, [tabs, active]);

  const openTab = useCallback((project: ProjectInfo) => {
    setTabs((ts) =>
      ts.some((t) => t.id === project.id) ? ts : [...ts, { id: project.id, title: project.meta.title }],
    );
    setActive(project.id);
  }, []);

  const closeTab = (id: string) => {
    setTabs((ts) => ts.filter((t) => t.id !== id));
    if (active === id) setActive("home");
  };

  const renameTab = useCallback((id: string, title: string) => {
    setTabs((ts) => ts.map((t) => (t.id === id ? { ...t, title } : t)));
  }, []);

  return (
    <div className="app">
      <nav className="tabs" hidden={focus}>
        <button className={`tab brand ${active === "home" ? "active" : ""}`} onClick={() => setActive("home")}>
          flow
        </button>
        {tabs.map((t) => (
          <div key={t.id} className={`tab ${active === t.id ? "active" : ""}`} onClick={() => setActive(t.id)}>
            <span className="tab-title">{t.title}</span>
            <button
              className="tab-close"
              title="Close"
              onClick={(e) => {
                e.stopPropagation();
                closeTab(t.id);
              }}
            >
              ×
            </button>
          </div>
        ))}
      </nav>
      <main className="content">
        {active === "home" && <Home onOpen={openTab} />}
        {tabs.map((t) => (
          <div key={t.id} className="tab-panel" hidden={active !== t.id}>
            <ProjectView
              projectId={t.id}
              onTitle={renameTab}
              focus={focus && active === t.id}
              onToggleFocus={toggleFocus}
            />
          </div>
        ))}
      </main>
    </div>
  );
}
