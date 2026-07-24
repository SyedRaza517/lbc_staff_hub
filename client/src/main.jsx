import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import { AuthProvider } from "./auth";
import App from "./App";

// Catches any render/runtime error in the tree so a single crashing component
// shows a friendly, recoverable screen instead of a blank white page.
class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error("App crashed:", error, info); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif", background: "#eef1f6", color: "#1a2332" }}>
        <div style={{ maxWidth: 420, width: "100%", background: "#fff", borderRadius: 16, padding: 28, textAlign: "center", boxShadow: "0 2px 16px rgba(15,23,42,.1)" }}>
          <div style={{ width: 56, height: 56, margin: "0 auto 14px", borderRadius: "50%", background: "#fee2e2", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26 }}>⚠️</div>
          <h1 style={{ margin: "0 0 6px", fontSize: 19, fontWeight: 800 }}>Something went wrong</h1>
          <p style={{ margin: "0 0 20px", fontSize: 14, color: "#64748b", lineHeight: 1.5 }}>The app hit an unexpected error on this screen. Reloading usually fixes it.</p>
          <button onClick={() => window.location.reload()} style={{ background: "#1a3a8f", color: "#fff", border: 0, borderRadius: 12, padding: "12px 22px", fontSize: 14, fontWeight: 700, cursor: "pointer", width: "100%" }}>Reload the app</button>
        </div>
      </div>
    );
  }
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ErrorBoundary>
      <AuthProvider>
        <App />
      </AuthProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
