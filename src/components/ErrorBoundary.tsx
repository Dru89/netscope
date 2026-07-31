import { Component, type ErrorInfo, type ReactNode } from "react";
import * as platform from "../platform";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

// A render crash used to unmount the tree and leave the window blank — no
// message, no way back, and (because the window is already visible by then)
// no clue that anything failed. HAR files are untrusted input from other
// people's tools, so treat "this capture broke the viewer" as a state the app
// has to be able to show. parseHar normalizes the gaps we know about; this is
// the net for the ones we don't.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Netscope render error:", error, info.componentStack);
    // The window may still be hidden if the crash happened during the first
    // mount, before App could signal ready. Without this it would only appear
    // via the backend's timeout, several hundred ms later.
    platform.signalReady();
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="welcome-screen">
        <h1 className="welcome-title">Something went wrong</h1>
        <p className="welcome-subtitle">
          Netscope couldn&rsquo;t display this capture. Opening a different file
          in a new window should still work.
        </p>
        <div className="welcome-error">
          <span className="welcome-error-chip">!</span>
          <span>{error.message || String(error)}</span>
        </div>
      </div>
    );
  }
}
