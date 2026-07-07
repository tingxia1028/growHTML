import type { Express } from "express";

export type AppInfoRoutesOptions = {
  appVersion: string;
  isPackaged?: boolean;
};

export function registerAppInfoRoutes(app: Express, options: AppInfoRoutesOptions): void {
  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, app: "ai-study-vault" });
  });

  // Read-only shell identity for About/Settings surfaces. Keep this module free of
  // package.json imports so createApp owns environment/package wiring.
  app.get("/api/about", (_req, res) => {
    res.json({
      app: "ai-study-vault",
      version: options.appVersion,
      isPackaged: options.isPackaged === true
    });
  });
}
