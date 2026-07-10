"use client";

import { useTheme, type Theme } from "../../lib/theme";
import { SegmentedControl } from "./SegmentedControl";

/**
 * System / Light / Dark switch. Reads and writes the shared theme (app/lib/theme).
 */
export function ThemeToggle({ size = "md" }: { size?: "sm" | "md" }) {
  const { theme, setTheme } = useTheme();
  return (
    <SegmentedControl<Theme>
      size={size}
      value={theme}
      onChange={setTheme}
      options={[
        { value: "system", label: "System" },
        { value: "light", label: "Light" },
        { value: "dark", label: "Dark" },
      ]}
    />
  );
}
