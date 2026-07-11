interface WelcomeScreenProps {
  onOpenFile: () => void;
  error: string | null;
}

const isMac =
  typeof document !== "undefined" &&
  document.documentElement.dataset.platform === "darwin";

export function WelcomeScreen({ onOpenFile, error }: WelcomeScreenProps) {
  return (
    <div className="welcome-screen">
      {/* App glyph: three staggered waterfall bars on a raised card */}
      <div className="welcome-glyph" aria-hidden="true">
        <span className="welcome-glyph-bar" />
        <span className="welcome-glyph-bar" />
        <span className="welcome-glyph-bar" />
      </div>
      <h1 className="welcome-title">Netscope</h1>
      <p className="welcome-subtitle">
        Open a <span className="welcome-kbd">.har</span> capture to inspect
        its requests, or drop one here.
      </p>
      <div className="welcome-actions">
        <button className="welcome-open-btn" onClick={onOpenFile}>
          Open HAR File
        </button>
        <p className="welcome-hint">
          or press{" "}
          <span className="welcome-kbd welcome-kbd-bordered">
            {isMac ? "⌘O" : "Ctrl+O"}
          </span>
        </p>
      </div>
      {error && (
        <div className="welcome-error">
          <span className="welcome-error-chip">!</span>
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
