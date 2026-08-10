import { StrictMode, useEffect, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

function WindowButton({
  label,
  onClick,
  children,
  danger = false,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  danger?: boolean;
}) {
  return (
    <button
      className={`window-button${danger ? " window-button-danger" : ""}`}
      type="button"
      aria-label={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function App() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (window.windowControls) {
      void window.windowControls.isMaximized().then(setMaximized);
    }
  }, []);

  const toggleMaximize = () => {
    if (!window.windowControls) return;
    window.windowControls.toggleMaximize();
    setMaximized((current) => !current);
  };

  return (
    <main className="app-shell">
      <header className="titlebar">
        <div className="brand" aria-label="AI Browser">
          <span className="brand-mark" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          <span className="brand-name">AI Browser</span>
        </div>

        <div className="window-controls">
          <WindowButton label="Minimize window" onClick={() => window.windowControls?.minimize()}>
            <span className="minimize-icon" aria-hidden="true" />
          </WindowButton>
          <WindowButton label={maximized ? "Restore window" : "Maximize window"} onClick={toggleMaximize}>
            <span className={maximized ? "restore-icon" : "maximize-icon"} aria-hidden="true" />
          </WindowButton>
          <WindowButton label="Close window" onClick={() => window.windowControls?.close()} danger>
            <span className="close-icon" aria-hidden="true" />
          </WindowButton>
        </div>
      </header>

      <section className="empty-stage" aria-label="AI Browser workspace" />
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
