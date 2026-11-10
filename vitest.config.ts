import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "node",
          environment: "node",
          env: { TZ: "UTC" },
          include: ["packages/*/src/**/*.test.ts", "apps/desktop/electron/**/*.test.ts"],
        },
      },
      {
        plugins: [react()],
        resolve: { dedupe: ["react", "react-dom"] },
        test: {
          name: "ui",
          environment: "happy-dom",
          env: { TZ: "UTC" },
          include: ["apps/desktop/src/**/*.test.{ts,tsx}"],
          setupFiles: ["apps/desktop/src/test/setup.ts"],
        },
      },
    ],
  },
});
