import { isReady, type ReadinessItem, type ReadinessReport } from "@flowdriven/contracts";
import { FIXTURE_NOW, type FlowRecord } from "../state";

export function readiness(flows: FlowRecord[]): Record<string, ReadinessReport> {
  return Object.fromEntries(
    flows.map(({ manifest }) => {
      const names: Record<string, string> = {
        coder: "Coding harness",
        figma: "Figma MCP server",
        writer: "Worker harness",
        worker: "Worker harness",
        source: "Source file",
        youtube: "YouTube upload",
        instagram: "Instagram publishing",
        wordpress: "WordPress site",
        "tiktok-draft": "TikTok draft upload",
        "tiktok-browser": "TikTok browser session",
        ffmpeg: "FFmpeg",
      };
      const items: ReadinessItem[] = manifest.requirements.map((req) => ({
        requirementId: req.id,
        name: names[req.id] ?? req.ref,
        type: req.type,
        why: req.why,
        required: req.required,
        sensitive: req.sensitive,
        state: "ok",
        route: { via: "native", risk: "official" },
        autoInstall: "guided",
        guide: { steps: [`Set up ${req.ref}.`, "Choose Check again."], commands: [], verified: true },
        checkedAt: FIXTURE_NOW,
      }));
      if (manifest.id.endsWith("figma-to-flutter")) {
        const item = items.find((i) => i.requirementId === "figma");
        if (item) {
          item.state = "needs_login";
          item.route = { via: "remote", risk: "official" };
          item.enforcement = "enforced by the harness's settings";
          item.detail = "Figma sign-in expired on 9 Nov.";
          item.guide.steps = [
            "Open the Figma connection in your harness settings.",
            "Sign in to the Figma account with access to the file.",
            "Choose Check again.",
          ];
        }
      }
      if (manifest.id.endsWith("social-posts"))
        for (const item of items) {
          switch (item.requirementId) {
            case "instagram":
              item.state = "needs_login";
              item.enforcement = "enforced by FlowDriven";
              item.guide.steps = [
                "Open the Instagram connection settings.",
                "Sign in to the publishing account and authorize access.",
                "Choose Check again.",
              ];
              break;
            case "wordpress":
              item.state = "missing";
              item.guide.steps = [
                "Open your WordPress profile and create an application password.",
                "Add the site address and application password to the WordPress connection.",
                "Choose Check again.",
              ];
              break;
            case "tiktok-draft":
              item.state = "failed";
              item.detail = "Probe failed: the draft-upload scope is not approved for FlowDriven yet.";
              item.guide.steps = [
                "Request the draft-upload scope for your TikTok app in the developer portal.",
                "Reconnect the account after the scope is approved.",
                "Choose Check again.",
              ];
              break;
            case "tiktok-browser":
              item.state = "missing";
              item.route = {
                via: "browser",
                risk: "unofficial",
                note: "TikTok's terms forbid automated posting scripts.",
              };
              item.guide.steps = [
                "Open TikTok in the browser and sign in to the publishing account.",
                "Connect the browser session, then choose Check again.",
              ];
              item.guide.verified = false;
              break;
            case "ffmpeg":
              item.state = "missing";
              item.autoInstall = "yes";
              item.installCommand = "brew install ffmpeg";
              item.guide = {
                steps: ["Open Terminal.", "Run the command below.", "Choose Check again."],
                commands: ["brew install ffmpeg"],
                verified: true,
              };
              break;
          }
        }
      return [
        manifest.id,
        {
          flowId: manifest.id,
          flowName: manifest.name,
          checkedAt: FIXTURE_NOW,
          ready: isReady(items),
          items,
        },
      ];
    }),
  );
}
