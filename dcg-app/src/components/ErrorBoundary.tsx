import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback: (error: Error, reset: () => void) => ReactNode;
  onReset?: () => void;
}

interface State {
  error: Error | null;
}

/** React only catches render/lifecycle errors in a class-component boundary —
 * there is no hooks equivalent. Two are used in this app: one wrapping the
 * whole shell (last-resort, offers a reload) and one wrapping just
 * TutorModal, so a bug in the AI-tutor flow can't take down the planner
 * underneath it — everything up to the last completed phase is already saved
 * to the database, so closing the session loses nothing already persisted. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("ErrorBoundary caught an error:", error, info.componentStack);
  }

  reset = () => {
    this.props.onReset?.();
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) return this.props.fallback(this.state.error, this.reset);
    return this.props.children;
  }
}
