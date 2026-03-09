"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError]       = useState<string | null>(null);
  const [loading, setLoading]   = useState(false);
  const usernameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    usernameRef.current?.focus();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Nesprávné přihlašovací údaje");
      } else {
        router.push("/");
      }
    } catch {
      setError("Chyba připojení k serveru");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      minHeight: "100vh",
      background: "#0a0a0f",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif",
    }}>
      <div style={{
        width: 380,
        background: "#111318",
        borderRadius: 16,
        border: "1px solid rgba(255,255,255,0.08)",
        padding: "36px 32px 32px",
        boxShadow: "0 32px 80px rgba(0,0,0,0.6)",
      }}>

        {/* Logo / nadpis */}
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{
            width: 48, height: 48, borderRadius: 12,
            background: "linear-gradient(135deg, #e53e3e 0%, #dd6b20 100%)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontWeight: 900, color: "#fff", fontSize: 22,
            margin: "0 auto 14px",
          }}>I</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#f1f5f9", letterSpacing: "-0.01em" }}>
            Integraf
          </div>
          <div style={{ fontSize: 11, color: "#64748b", marginTop: 3, letterSpacing: "0.12em", textTransform: "uppercase" }}>
            Výrobní plán
          </div>
        </div>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {/* Username */}
          <div>
            <label style={{ fontSize: 10, fontWeight: 600, color: "#9ba8c0", letterSpacing: "0.08em", textTransform: "uppercase", display: "block", marginBottom: 6 }}>
              Uživatelské jméno
            </label>
            <input
              ref={usernameRef}
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              style={{
                width: "100%", boxSizing: "border-box",
                height: 40, borderRadius: 10,
                background: "#1a1d25", border: "1px solid rgba(255,255,255,0.1)",
                color: "#f1f5f9", fontSize: 14, padding: "0 12px",
                outline: "none", transition: "border-color 120ms ease-out",
              }}
              onFocus={(e) => (e.currentTarget.style.borderColor = "#3b82f6")}
              onBlur={(e) => (e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)")}
            />
          </div>

          {/* Password */}
          <div>
            <label style={{ fontSize: 10, fontWeight: 600, color: "#9ba8c0", letterSpacing: "0.08em", textTransform: "uppercase", display: "block", marginBottom: 6 }}>
              Heslo
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              style={{
                width: "100%", boxSizing: "border-box",
                height: 40, borderRadius: 10,
                background: "#1a1d25", border: "1px solid rgba(255,255,255,0.1)",
                color: "#f1f5f9", fontSize: 14, padding: "0 12px",
                outline: "none", transition: "border-color 120ms ease-out",
              }}
              onFocus={(e) => (e.currentTarget.style.borderColor = "#3b82f6")}
              onBlur={(e) => (e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)")}
            />
          </div>

          {/* Error */}
          {error && (
            <div style={{
              fontSize: 11, color: "#fca5a5",
              background: "rgba(239,68,68,0.12)",
              border: "1px solid rgba(239,68,68,0.25)",
              borderRadius: 8, padding: "8px 12px",
            }}>
              {error}
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={loading || !username || !password}
            style={{
              marginTop: 8,
              width: "100%", height: 42, borderRadius: 10,
              background: loading || !username || !password ? "rgba(255,230,0,0.35)" : "#FFE600",
              border: "none", cursor: loading || !username || !password ? "not-allowed" : "pointer",
              color: "#0a0a0f", fontSize: 14, fontWeight: 700,
              transition: "all 120ms ease-out",
              letterSpacing: "0.01em",
            }}
          >
            {loading ? "Přihlašování…" : "Přihlásit se"}
          </button>
        </form>
      </div>
    </div>
  );
}
