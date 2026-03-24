"use client";

import { useRef, useEffect, useState, Suspense } from "react";
import { useRouter } from "next/navigation";

function LoginForm() {
  const usernameRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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
        router.push(data.role === "TISKAR" ? "/tiskar" : "/");
      }
    } catch (err) {
      console.error("Login request failed", err);
      setError("Chyba připojení k serveru");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Username */}
      <div>
        <label htmlFor="username" style={{ fontSize: 10, fontWeight: 600, color: "var(--text-muted)", letterSpacing: "0.08em", textTransform: "uppercase", display: "block", marginBottom: 6 }}>
          Uživatelské jméno
        </label>
        <input
          ref={usernameRef}
          id="username"
          name="username"
          type="text"
          autoComplete="username"
          required
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          disabled={loading}
          style={{
            width: "100%", boxSizing: "border-box",
            height: 40, borderRadius: 10,
            background: "var(--surface-2)", border: "1px solid var(--border)",
            color: "var(--text)", fontSize: 14, padding: "0 12px",
            outline: "none", transition: "border-color 120ms ease-out",
          }}
          onFocus={(e) => (e.currentTarget.style.borderColor = "var(--ring)")}
          onBlur={(e) => (e.currentTarget.style.borderColor = "var(--border)")}
        />
      </div>

      {/* Password */}
      <div>
        <label htmlFor="password" style={{ fontSize: 10, fontWeight: 600, color: "var(--text-muted)", letterSpacing: "0.08em", textTransform: "uppercase", display: "block", marginBottom: 6 }}>
          Heslo
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={loading}
          style={{
            width: "100%", boxSizing: "border-box",
            height: 40, borderRadius: 10,
            background: "var(--surface-2)", border: "1px solid var(--border)",
            color: "var(--text)", fontSize: 14, padding: "0 12px",
            outline: "none", transition: "border-color 120ms ease-out",
          }}
          onFocus={(e) => (e.currentTarget.style.borderColor = "var(--ring)")}
          onBlur={(e) => (e.currentTarget.style.borderColor = "var(--border)")}
        />
      </div>

      {/* Error */}
      {error && (
        <div style={{
          fontSize: 11, color: "var(--danger)",
          background: "color-mix(in oklab, var(--danger) 12%, transparent)",
          border: "1px solid color-mix(in oklab, var(--danger) 28%, transparent)",
          borderRadius: 8, padding: "8px 12px",
        }}>
          {error}
        </div>
      )}

      {/* Submit */}
      <button
        type="submit"
        disabled={loading}
        style={{
          marginTop: 8,
          width: "100%", height: 42, borderRadius: 10,
          background: "#FFE600",
          border: "none", cursor: loading ? "wait" : "pointer",
          color: "var(--bg)", fontSize: 14, fontWeight: 700,
          transition: "all 120ms ease-out",
          letterSpacing: "0.01em",
          opacity: loading ? 0.7 : 1,
        }}
      >
        {loading ? "Přihlašuji…" : "Přihlásit se"}
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div style={{
      minHeight: "100vh",
      background: "var(--bg)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif",
    }}>
      <div style={{
        width: 380,
        background: "var(--surface)",
        borderRadius: 16,
        border: "1px solid var(--border)",
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
          <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.01em" }}>
            Integraf
          </div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 3, letterSpacing: "0.12em", textTransform: "uppercase" }}>
            Výrobní plán
          </div>
        </div>

        <Suspense fallback={<div style={{ height: 200 }} />}>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  );
}
