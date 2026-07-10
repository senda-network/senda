"use client";

import { useEffect, useState } from "react";

/**
 * Theme control for the whole site (control app + marketing). Three choices:
 * "system" follows the OS via the prefers-color-scheme media query (no
 * `data-theme` attribute), while "light"/"dark" force a theme by setting
 * `data-theme` on <html>. The persisted value is read before first paint by
 * the inline script in app/layout.tsx to avoid a flash.
 */
export type Theme = "system" | "light" | "dark";

const STORAGE_KEY = "senda:theme";

export function getStoredTheme(): Theme {
  if (typeof window === "undefined") return "system";
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "light" || v === "dark") return v;
  } catch {}
  return "system";
}

/** The theme actually being shown right now, resolving "system". */
export function getResolvedTheme(): "light" | "dark" {
  if (typeof window === "undefined") return "light";
  const stored = getStoredTheme();
  if (stored !== "system") return stored;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function applyTheme(theme: Theme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (theme === "system") {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", theme);
  }
}

export function setTheme(theme: Theme) {
  try {
    if (theme === "system") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, theme);
  } catch {}
  applyTheme(theme);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("senda:theme-change", { detail: theme }));
  }
}

/**
 * Reactive theme state for UI (toggles, command palette). Returns the chosen
 * preference plus the resolved light/dark actually rendered, and re-renders on
 * changes from elsewhere or from the OS when in "system" mode.
 */
export function useTheme() {
  const [theme, setThemeState] = useState<Theme>("system");
  const [resolved, setResolved] = useState<"light" | "dark">("light");

  useEffect(() => {
    setThemeState(getStoredTheme());
    setResolved(getResolvedTheme());

    const onChange = () => {
      setThemeState(getStoredTheme());
      setResolved(getResolvedTheme());
    };
    window.addEventListener("senda:theme-change", onChange);
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener?.("change", onChange);
    return () => {
      window.removeEventListener("senda:theme-change", onChange);
      mq.removeEventListener?.("change", onChange);
    };
  }, []);

  return {
    theme,
    resolved,
    setTheme: (t: Theme) => {
      setTheme(t);
      setThemeState(t);
      setResolved(getResolvedTheme());
    },
  };
}
