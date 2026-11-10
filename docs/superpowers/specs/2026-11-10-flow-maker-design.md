# FlowDriven: flow maker design

- Status: draft for owner approval. Nothing gets built until the owner approves this document.
- Date: 2026-11-10
- Name: FlowDriven. **Owner decision (2026-11-10)**. **Chair's call (owner may override)**: in identifiers (the format string, git branch names, package names) it is written `flowdriven`. A trademark search and the domain registration are still to do before release (section 18.2).
- Sources: the owner's decisions (dated below) and private research notes (not in the repo) on vendor rules, similar products, popular use cases, payments, and rules for AI agents in public repositories. Where this document cites a vendor fact, it comes from those notes as of 2026-11-09/10. Recheck any of them before relying on it.

How to read the labels:
- **Owner decision (date)**: the owner decided this. Change it only with the owner.
- **Chair's call (owner may override)**: the planning chair or the writer chose this. Each one carries a one-line reason. The owner has not agreed to these yet.
- Numeric defaults (retry counts, time limits, cache times, budget thresholds, expiry and wait times, size limits, retention, account age) are all **Chair's call (owner may override)** unless marked otherwise: a builder needs concrete numbers, and each one is a setting the owner can change.

---

## 1. Summary

FlowDriven is a desktop app (Mac first) with an online marketplace. It helps people turn their own recurring work into a **flow**: an ordered list of steps that AI can do partly or fully, with a check on every step. The user's own AI agent harnesses (Claude Code, Codex, Antigravity, Copilot, OpenCode and others) do the hands-on work. FlowDriven does not build integrations. Any app the user's agent can reach (through MCP servers, CLIs, plugins, skills or a logged-in browser) can be part of a flow.

The user talks to one agent. That agent:
- clarifies the work and writes the flow, using an adapted Flow-Driven Development (FDD) method;
- checks that everything the flow needs is installed and logged in, and offers to install what is missing;
- runs the flow on the user's machine and hands the hands-on work to harnesses acting as workers;
- counts a step as done only when the step's check passes;
- asks the user only for decisions and risky actions.

Work that isn't a saved flow doesn't need one first. A one-off request in chat runs right away as an unsaved **one-time flow** on the same engine (approvals, memory, checks, risk rules), and afterwards the agent offers to save it as a reusable flow. **Owner decision (2026-11-10)**.

Flows use the connectors, plugins and skills the user already has in each harness. For every step, FlowDriven gives the harness a per-run configuration that enables only what the flow declares. FlowDriven's own gateway covers the tools FlowDriven provides and holds risky actions where it can sit in the path (section 11.7). In a later phase, people who drive their own harness session (for example Claude Code) can also use FlowDriven from inside that session, as an MCP server (section 8.7).

The marketplace is the business. In v1 it holds free flows only. People browse and install public flows without an account; installing a private flow needs an email sign-in (**Chair's call (owner may override)**: access control needs an identity, 8.6 and 14.4). Publishers need an account verified by phone and email. Every published version is scanned automatically, can't be changed after publishing, and can be revoked. Paid flows come later.

The client app is open source (AGPL-3.0 core, MIT SDK and flow format). The marketplace server is closed source.

---

## 2. Intent and why

The owner's reasoning:

> "Everyone has their own work that AI could handle partly or fully. Today's AI agents only provide the tools, not a flow tailored to the user. Claude, for example, gives you the app, connectors and plugins, but no flow for slicing Figma into code, drafting a post to WordPress, or generating a short AI video with Higgsfield and posting it to TikTok. Tools like n8n are not friendly to laypeople."

> "Build a place to make workflows that users can publish for free or paid, with AI agent runtime detection like multica.ai, so users run them with their own AI agents."

> "The concept is still one agent": one agent that clarifies ideas and goals, manages the work, and orchestrates AI agent harnesses efficiently.

> "The app runs on the client; the business is the marketplace. It is not an integrator like Zapier or Make.com but a flow maker, so any app can be used. The marketplace scans security at publish time."

What the research adds (private research notes, 2026-11-10):
- Nothing found does exactly this. Vendor stores sell general tools for their own agent only. Workflow tools run in their own cloud and bill per task. Community skill registries have had many security incidents.
- The clearest gap: one flow that runs on whatever agent the user already has, plus a per-flow readiness check with automatic or guided install. Nobody found checks "is Figma connected?" or "is TikTok logged in?" and then offers to fix it.
- The biggest risk is marketplace security. A skill inherits all of the agent's permissions.
- The market moves fast (Relay.app closed, OpenAI Agent Builder closes 2026-11-30, GitHub Copilot Extensions ended). An open format protects users from any single store closing.

Method: keep and improve FDD. Its core line is "Flow is the invariant contract. Spec, UI, and tech stack are variables." Build from scratch. Do not reuse the old FDD product's code or scope. **Owner decision (2026-11-08)**.

---

## 3. Users, success measure, anti-goals

### 3.1 Users
- **First user: the owner.** They want to build apps, research topics, manage projects, brainstorm, continue unfinished work, and make branding, marketing and viral content.
- **Two-sided from the start.** Users create flows, publish them (private or public), and browse and install other people's flows. **Owner decision (2026-11-10)**.
- **Audience:** laypeople worldwide as well as developers. Everything (code, UI, docs, flows, commit messages) is in English. **Owner decision (2026-11-09)**.

### 3.2 Success measure
Three months after release, the owner uses FlowDriven every day and their own flows run smoothly. **Owner decision (2026-11-10)**. No public adoption target has been set.

### 3.3 Anti-goals and counters
Each one is a failure even if the feature technically works. Anti-goals 1 to 4: **Owner decision (2026-11-09, reconfirmed 2026-11-10)**. Anti-goal 5: **Owner decision (2026-11-10)**.

| # | Anti-goal | How the design counters it | Section |
|---|---|---|---|
| 1 | Too much hassle: many questions about trivial things, long confusing reports | At most 3 clarifying questions per round, and only ones that change the flow; everything else becomes a stated default the user can correct. One-off work runs at once as a one-time flow: a short plan in chat, no manifest editing, no flow sign-off, then one offer to save it. Notifications only for decisions and problems. Run reports are 3 lines plus a link to details. | 10.1, 10.6, 10.7 |
| 2 | Fake "done": a task marked finished that is not actually right | Every step has a check. Done means the check passed. A worker can't grade its own work: every step needs at least one check that the worker doesn't control. One-time flows follow the same rule. | 9.3, 10.7, 13.2 |
| 3 | Forgetting context: re-explaining projects and past decisions | Per-flow and per-project memory, injected into every brain and worker call. The agent looks in memory before asking. | 10.5 |
| 4 | Wasting quota or money | Quota tracking per harness, routing to cheaper workers where quality allows, a brain that stays quiet, retries capped, a hard monthly API-key budget. | 10.3, 10.4, 11.6 |
| 5 | Harmful marketplace flows that damage or steal data | The requirement list is the permission boundary: each step gets a per-run scoped harness configuration that enables only declared connectors, plugins and skills, and the gateway enforces it fully where it sits in the path (enforcement on native connectors is only as strong as each harness's own controls). Workers are limited to the project folder, risky actions need approval, versions are immutable and signed, every version is re-scanned, and the app checks a revocation list. | 9.4, 11.7, 14, 15 |

---

## 4. Goals, non-goals, anti-goals

### 4.1 Goals (v1)
"v1" in this document means phases 1 and 2 of section 17 (local core with the five example flows, then the free marketplace). **Chair's call (owner may override)**: it matches the owner's "v1 marketplace: free flows only".

1. Turn a user's described work into a working flow through chat, with an editable step list.
2. Run one-off requests at once as one-time flows on the same engine, and offer to save them (section 10.7). **Owner decision (2026-11-10)**.
3. Detect installed harnesses and what each one has installed (skills, plugins, MCP servers), and use those in flows through a per-run scoped configuration (section 11.7). Let the user pick the brain.
4. Check each flow's requirements, show a checklist, and fix gaps automatically (after confirmation) or with a guide.
5. Run flows locally in the background, with checks per step, retries, an approval inbox and run history.
6. Ship all five first-wave example flows (section 16) in phase 1. **Owner decision (2026-11-10)**.
7. Publish and install free flows through the marketplace, with scanning, immutable versions and revocation (phase 2).
8. Expose the runner's operations as an MCP server, so people can use FlowDriven from inside their own harness session (section 8.7, phase 2).
9. Make FlowDriven and its flows easy for LLMs, RAG systems and search engines to find (section 14.9). The basics (one approved description everywhere, the docs site with llms.txt) ship in phase 1; the server-rendered catalog and listing pages ship in phase 2. **Chair's call (owner may override)**.

### 4.2 Non-goals (explicitly out of v1)
- Paid flows, license keys, checkout and payouts (later phase). **Owner decision (2026-11-10)**. Private sharing of paid flows comes with them; private sharing of free flows (all three levels) is in phase 2 (section 14.4).
- A hosted cloud runtime. Flows always run on the user's machine. **Owner decision (2026-11-10)**.
- Chat channels (Telegram, WhatsApp, Discord). The app is the only surface. **Owner decision (2026-11-10)**.
- Windows and Linux. They come after v1 is stable. **Owner decision (2026-11-10)**.
- A visual canvas editor. **Owner decision (2026-11-10)**.
- FlowDriven-built connectors to third-party apps. FlowDriven is a flow maker, not an integrator. **Owner decision (2026-11-10)**. Using the connectors, plugins and skills the user already has in a harness is in scope (section 11.7).
- A target release date or a human build team. The product is built entirely by AI coding agents directed by the owner (section 17.1). **Owner decision (2026-11-10)**.
- Harness adapters beyond Codex, Claude Code and Antigravity in phase 1. Others follow from phase 2. **Chair's call (owner may override)**: these three are the most common daily harnesses.
- MCP-server mode in phase 1. It ships in phase 2 (section 8.7). **Chair's call (owner may override)**.
- Manual human review of published flows. **Owner decision (2026-11-10)**.
- Verified publisher badge (later). **Owner decision (2026-11-10)**.
- Project management or goal boards as the centre of the product. These belonged to an earlier concept that the 2026-11-10 direction replaced.
- Event triggers such as "when an email arrives". v1 has manual and scheduled runs only. **Chair's call (owner may override)**: scheduled runs cover daily email triage, and event plumbing would need always-on connectors.

### 4.3 Anti-goals
See 3.3.

---

## 5. Owner decisions (dated)

Decisions from 2026-11-08 and 2026-11-09 belong to an earlier concept ("one assistant plus project management plus chat channels"). On 2026-11-10 the owner replaced that concept. Decisions from the earlier concept still hold only where the owner did not correct them when asked on 2026-11-10; those are marked "carried over".

| Date | Decision |
|---|---|
| 2026-11-08 | Build from scratch. Keep and improve the FDD method; do not reuse FDD code. The code will be open source. |
| 2026-11-09 | All code, UI, docs, flows and commit messages in English, because the target is global. |
| 2026-11-09 | Licence: AGPL-3.0 for the core, MIT for the SDK (flow and connector format). |
| 2026-11-09 | Anti-goals 1 to 4 (section 3.3). |
| 2026-11-09 (carried over) | Autonomy, "ask only about risky things": normal work runs on its own, including pushing to the user's own repos. Ask first before a merge, a delete, spending money, or sending anything to other people. |
| 2026-11-09 (carried over) | Notifications only when a decision is needed (or a problem blocks work). |
| 2026-11-09 (carried over) | Brain: detect installed harnesses like multica.ai; the user picks which one is the main brain. |
| 2026-11-09 (carried over) | "Like Multica" stance: every detected harness may be auto-run, each with an account-risk warning. This includes Antigravity via `agy -p` and Claude Code via `claude -p` on a subscription login. |
| 2026-11-09 (carried over) | When the brain's quota runs out, switch automatically to other subscription harnesses in the order the user set. Switch to a paid API key only within a monthly budget the user approved. |
| 2026-11-09 (carried over) | Workers are limited to the project folder. Do not use a Multica-style no-confirmation mode by default. |
| 2026-11-09 (carried over) | The FDD method is used to clarify the user's work into a flow. |
| 2026-11-10 | New direction: FlowDriven is a flow maker with a marketplace. Still one agent; harnesses are workers. |
| 2026-11-10 | Setup must be easy but comprehensive. Each flow declares its requirements (agent, apps, connectors, accounts, browser sessions). On install: a checklist, the easiest fix for each missing item, a risk label per route, and a re-check before every run. |
| 2026-11-10 | For each missing requirement the user chooses: install automatically, or install manually with a guide. |
| 2026-11-10 | Two-sided: users create, publish private or public, free or paid, and browse the marketplace. |
| 2026-11-10 | "Private" means three options: only me, people I invite, a team or organization. |
| 2026-11-10 | The app runs on the client; the business is the marketplace; flow maker, not integrator; the marketplace scans security at publish time. |
| 2026-11-10 | Open-source boundary: the app is open, the server is closed. |
| 2026-11-10 | No hosted cloud version; the only online part is the marketplace. Browsing and installing public flows need no login. Publishing needs an account verified with phone number and email. A verified badge comes later. Installing a private flow needs an email sign-in (**Chair's call (owner may override)**: access control needs an identity; 8.6, 14.4). |
| 2026-11-10 | Buyers of paid flows (later phase) give only an email at payment and receive a license key by email. |
| 2026-11-10 | Published flows get an automated scan only, no manual review, accepting that this is easier to slip past. Runtime protections are always on: a flow may use only what its requirement list declares; workers stay in the project folder; send, post, pay and delete need approval. |
| 2026-11-10 | Platform cut for paid flows: 0% at first, 15% later; payment-processing fees are separate. |
| 2026-11-10 | Chat channels are not needed in v1. |
| 2026-11-10 | Editor: chat plus an editable, ordered step list. No canvas. |
| 2026-11-10 | First-wave example flows: Figma to Flutter; email triage and replies; lead follow-up; one source into many social posts; documents and reports. |
| 2026-11-10 | Phase 1 ships all five example flows. This replaced the chair's earlier proposal to ship two first. |
| 2026-11-10 | A Figma Dev or Full seat is available for phase-1 testing, so the Figma flow can be tested on real work. |
| 2026-11-10 | One-off work: "Yes, as one-time flows". A chat request that is not a saved flow runs right away as an unsaved one-time flow on the same engine (approvals, memory, checks, risk rules). Afterwards the agent offers to save it as a reusable flow. |
| 2026-11-10 | Build capacity: the product is built entirely by AI coding agents (Claude, Codex, Antigravity) directed by the owner. There is no human team and no target date. |
| 2026-11-10 | The product, starting with its name, must be easy for LLMs and RAG systems to find. |
| 2026-11-10 | Mac first; Windows and Linux after v1 is stable. |
| 2026-11-10 | The owner delegated the technology choice to the chair. |
| 2026-11-10 | Success measure: "I use it every day". |
| 2026-11-10 | Anti-goal 5: harmful marketplace flows. |
| 2026-11-10 | A flow chooses which skills to load and which connectors or plugins to use. FlowDriven detects the skills, plugins and MCP connectors already installed in each harness (for example Claude Code and Codex). |
| 2026-11-10 | Skill and connector choice works both per flow (defaults) and per step (overrides). |
| 2026-11-10 | Paid flow protection (later phase): a license key checked before running, plus value-add (updates, support, the official version). The owner accepts that an open-source check can be bypassed. |
| 2026-11-10 | Paid flows, when they come, are paid through the marketplace, not through seller payment links. |
| 2026-11-10 | v1 marketplace: free flows only. Paid flows wait until the payment route is confirmed (section 14.8). This replaced "through the marketplace from day one" after the payment research. |
| 2026-11-10 | Name: find a new name, BreadTalk-style ("Flow" plus a familiar English word). Later the same day the owner added that the name must be easy for LLMs and RAG to find, and said they prefer a name that directly describes what the product does. Settled by the next row. |
| 2026-11-10 | The product name is FlowDriven. The owner proposed it and chose it after a check (GitHub, npm, PyPI, domain registries and a web search) found no product with that name in the AI-agent or workflow space. Trademarks are not checked yet. |
| 2026-11-10 | The repository is public and many people now contribute to GitHub projects through AI agents, so the project gets written rules for AI agents, to keep everything under control (17.2 to 17.6). |
| 2026-11-10 | Outside code comes in stages. During the build phase only people the owner invites may open pull requests, while issues and discussions stay open to everyone. After the first release, pull requests open to everyone under conditions (17.2, 17.3). Not chosen: open with conditions from the first day, invitation-only for good, and fully open. |
| 2026-11-10 | The owner approved this design and set the priority: design and build the app first, before anything else. |

---

## 6. Constraints

### 6.1 Vendor and harness rules
From private research notes (2026-11-09). This is a reading of vendor text, not legal advice. Labels: **official** = vendor text allows it or nothing forbids it; **gray** = text is unclear or contradicts itself; **unofficial** = vendor text forbids it or the route is not a published interface.

| Route | Label | Notes |
|---|---|---|
| Codex CLI with the user's own ChatGPT login (app-server or `codex exec`) on the user's machine | official | App-server auth is explicitly allowed for local or open-source apps; OpenAI recommends moving to Sign in with ChatGPT. `exec` is inferred, not stated. The ChatGPT 5-hour allowance is shared across all apps, so the brain and Codex workers compete for it. From December 2026 the allowance is also shared with ChatGPT chat. |
| Sign in with ChatGPT (open-source app, self-registered) | official | Needs no partner approval for open-source local apps. Does not support hosted MCP or connectors. |
| Any API key (Anthropic, OpenAI, Gemini paid tier) | official | Gemini free tier: prompts may be read by human reviewers. Use the paid tier for user data. |
| Claude Code started by the user, with FlowDriven as an MCP server it calls | official (inferred) | FlowDriven never touches the login. This is MCP-server mode (section 8.7, phase 2), the official route for Claude subscriptions. |
| FlowDriven starts `claude -p` on a subscription login | gray | Anthropic forbids third parties from routing requests through plan credentials, yet its help centre says `claude -p` still draws from plan limits. Anthropic also says `--bare` will become the default for `-p`, and bare mode does not read OAuth credentials. That would break this route on a future release with no date. |
| FlowDriven starts `agy -p` (Antigravity) on a consumer Google plan | unofficial (vendor-prohibited) | Google's FAQ says wrapping `agy` in third-party apps is not supported; its terms call it a breach that can lead to suspension. |
| Gemini CLI with a Google login | gray, leaning prohibited | Mostly moot: Google AI Pro access moved to Antigravity on 2026-06-18. |
| Copilot CLI, OpenCode, Grok, Cursor CLI | unknown | Not researched. Treat as gray until checked. |
| Hermes | gray | Its own docs describe reusing other harnesses' credentials through OAuth. Possibly stale; recheck. |
| Never collect, store or forward Claude.ai session tokens | hard rule | Anthropic text forbids it. The same rule applies to every harness: FlowDriven never reads harness credential files. |
| Product name must not include "Claude Code" | hard rule | Anthropic text. |

The owner accepted the gray and unofficial local routes under the "like Multica" stance, with warnings. **Owner decision (2026-11-09)**. The marketplace server never runs harnesses or uses anyone's subscription.

The `unofficial` label covers both vendor-prohibited routes and unpublished interfaces. Routes that vendor text explicitly forbids also carry the note "vendor-prohibited" and the account-suspension warning (section 11.5). **Chair's call (owner may override)**: one label keeps the picker simple, and the note keeps the difference visible.

### 6.2 Platform policies for example flows
- **Figma MCP**: the remote server has no seat requirement, but Starter plans and View/Collab seats get 20 calls per month, so a Dev or Full seat is needed in practice (Professional: 200 per day, 10 per minute; Figma may change limits at any time). The desktop server needs a Dev or Full seat and the user must enable it in Dev Mode. Only clients in Figma's MCP catalog may connect, so a proxy such as the FlowDriven gateway can't sit in front of the remote server; flows reach Figma through a catalogued harness's own connector (section 11.7). Whether Antigravity and OpenCode are in the catalog is unclear. Figma MCP gives design context, not production code. There is no Code Connect for Flutter.
- **WordPress**: REST API with Application Passwords (since 5.6) is official.
- **Higgsfield**: needs a paid subscription (MCP/CLI) or prepaid credit (API). Agent actions count as the account owner's actions. The Unlimited plan may be throttled for automated use.
- **TikTok**: public posting through the API is practically blocked for per-user apps (unaudited apps post private-only, 5 users per 24 hours, and the audit rejects tools for your own or your team's accounts). Draft upload is official: the user finishes the post in the TikTok app. Access scopes still need a review with no published timeline. Posting through a logged-in browser breaks TikTok's terms on automated scripts.
- **YouTube** (100 uploads per day; private-before-audit rule lifted 2026-11-02) and **Instagram** (100 API posts per 24 hours) have official posting. **X** is official but paid per post.
- **Gmail, spreadsheets and Meta lead ads**: not yet checked for harnesses other than Claude. Gmail and spreadsheet access for Codex and Antigravity must be checked before the phase-1 email and lead flows (section 18.3). One survey found data privacy was the top barrier for small businesses (49%), so flows that touch email or money must say what data they touch.

### 6.3 Security realities (private research notes, 2026-11-10)
- A skill inherits all of the agent's permissions.
- In one sample of 3,984 community skills, 13.4% had critical issues. Only 0.69% of skills were flagged by all three scanners at once: scanners disagree.
- Scanners can be evaded, for example by padding a file past a size limit (one case used 22 MB).
- A version can change after approval (`postmark-mcp` reportedly began copying emails in a later version).
- Loose entry rules have been abused. The official MCP registry says to assume minimal moderation.
- Agents are weapons: the npm "s1ngularity" attack ran AI CLIs with permission-skipping flags (`--dangerously-skip-permissions`, `--yolo`, `--trust-all-tools`) to steal files.

### 6.4 Platform and language
- Mac first. **Owner decision (2026-11-10)**. Design the core so Windows and Linux can follow: keep OS-specific code (keychain, launch agent, app detection) behind interfaces.
- English everywhere. **Owner decision (2026-11-09)**.

---

## 7. Concepts and vocabulary

| Term | Meaning |
|---|---|
| **The agent** | The one assistant the user talks to inside FlowDriven. It clarifies, plans, builds flows, checks readiness, runs flows, reports. It is not a separate product; it is FlowDriven's logic plus a brain. |
| **Brain** | The model the agent thinks with. Picked by the user from detected harnesses (run in structured output mode) or API-key providers. |
| **Harness** | An AI agent program installed on the user's machine (Claude Code, Codex, Antigravity, Copilot CLI, OpenCode, Hermes, Grok and others). |
| **Worker** | A harness when FlowDriven hands it a step to do. One harness can be brain and worker at once. |
| **Flow** | A versioned package: ordered steps, checks, requirements, inputs, outputs, and bundled skills. The flow is the contract. |
| **One-time flow** | An unsaved flow the agent drafts from a one-off chat request and runs right away on the same engine (approvals, memory, checks, risk rules). It can be saved as a reusable flow afterwards (section 10.7). |
| **Step** | One unit of work in a flow, done by a worker or by FlowDriven itself, with at least one check. |
| **Check** | An acceptance test for a step. A step is done only when its required checks pass. |
| **Requirement** | Something a flow needs: a harness, skill, plugin, MCP server, CLI tool, GUI app, account, browser session, file or folder. The requirement list is also the permission boundary. |
| **Skill** | A folder with a `SKILL.md` file (the Agent Skills open standard) that teaches a harness how to do something. |
| **Plugin** | A harness-specific bundle of skills, commands and MCP config (for example a Claude Code plugin listed in a `marketplace.json`). |
| **Connector / MCP server** | A program that gives an agent tools and data from another app through the Model Context Protocol. |
| **Readiness check** | FlowDriven's check of every requirement. Each requirement ends up in one of four states: ok, missing, needs login, failed. |
| **Run** | One execution of a flow (saved or one-time) with specific inputs, in a specific project. |
| **Approval** | A user decision the run waits for: a risky action, a flow sign-off, or a final result sign-off. |
| **Approval inbox** | The single place in the app where pending approvals wait. |
| **Project** | A folder on disk that a run works in, with its own memory. |
| **Listing** | A flow's public page in the marketplace, with all its versions. |
| **Private / public sharing** | Private: only me, invited people, or a team. Public: anyone can find and install it. |
| **Risk label** | official / gray / unofficial, shown on every harness and requirement route. |
| **Native connector** | An MCP server, plugin or skill the user already installed in a harness, used by a flow through that harness (section 11.7). |
| **Scoped harness config** | The per-run, per-step configuration FlowDriven generates for a worker: only the declared MCP servers, plugins, skills and tools, plus the gateway endpoint and approval hooks where the harness supports them (section 11.7). |
| **Gateway** | FlowDriven's local MCP server and proxy. It serves the tools FlowDriven provides, sits in front of MCP servers it can proxy, enforces the requirement list on those calls, and holds risky calls for approval (sections 8.2, 11.7). |
| **MCP-server mode** | FlowDriven running as an MCP server inside the user's own harness session, exposing build, run and approval operations (section 8.7, phase 2). |

---

## 8. Architecture

Everything in this section is a **Chair's call (owner may override)** unless marked otherwise.

### 8.1 Technology choices

| Area | Choice | Reason |
|---|---|---|
| Desktop app | Electron + React + TypeScript | Node can spawn and stream harness CLIs; the MCP, Claude Agent and Codex SDKs are TypeScript; one language across the app, the runner and the SDKs. |
| Background runner | Separate Node process, installed as a macOS launch agent | Flows keep running when the window is closed, and scheduled runs fire without the UI. |
| Local storage | SQLite, single writer (the runner) | Zero setup, transactional, easy backup. |
| Secrets | macOS Keychain | The research pattern: secrets live in the OS keychain, never in app files. |
| Marketplace | TypeScript on Cloudflare Workers + D1 + R2, closed source | A low-cost serverless stack with little to operate; cheap at low volume; R2 fits package storage. |
| Package signing | Ed25519 signatures by the marketplace; public key pinned in the app | Small, fast, well supported. |
| Payments (later phase) | Stripe Connect, as researched (section 14.8) | Only route found that fits a global marketplace with seller payouts. |

### 8.2 Components

```mermaid
flowchart LR
  subgraph Mac["User's Mac"]
    UI["Desktop app (Electron UI)<br/>chat, step list, inbox, marketplace"]
    subgraph Runner["Background runner (launch agent)"]
      AG["Agent core<br/>clarify, plan, route"]
      BR["Brain providers"]
      RD["Readiness engine"]
      EX["Run executor + checks"]
      GW["MCP gateway<br/>own tools, proxied servers,<br/>allow-list + approvals"]
      SCF["Scoped harness config<br/>per run and step"]
      HD["Harness detector + quota"]
      API2["Runner API<br/>(JSON-RPC; MCP-server mode, phase 2)"]
      DB[("SQLite")]
    end
    KC[("macOS Keychain")]
    H1["Harness CLIs as workers<br/>claude, codex, agy, opencode ..."]
    NAT["Native connectors, plugins, skills<br/>installed in each harness"]
    MCP["Proxied MCP servers, CLIs,<br/>GUI apps, browser profile"]
    US["User's own harness session<br/>(MCP-server mode, phase 2)"]
  end
  subgraph Cloud["Marketplace (closed)"]
    API["Workers API"]
    SC["Scanner"]
    D1[("D1")]
    R2[("R2 packages")]
  end
  UI <-->|"local socket, JSON-RPC"| API2
  US -->|"MCP"| API2
  AG --> BR
  BR --> H1
  EX --> SCF
  SCF --> H1
  H1 -->|"declared native tools<br/>(harness controls + hooks)"| NAT
  H1 -->|"MCP calls"| GW
  GW --> MCP
  RD --> MCP
  RD --> H1
  Runner --> KC
  Runner --> DB
  UI -->|"browse, install, publish"| API
  Runner -->|"revocation list, updates"| API
  API --> SC
  API --> D1
  API --> R2
```

Responsibilities:
- **Desktop app (UI)**: chat, step-list editor, readiness checklist, approval inbox, run history, settings (brain picker, fallback order, budget), marketplace browse and publish. Holds no state of its own; it reads and writes through the runner.
- **Agent core**: the FDD-based conversation logic, flow drafting and editing, routing steps to workers, memory reads and writes.
- **Brain providers**: one interface, several backends (section 10.3).
- **Readiness engine**: detectors, installers and guides per requirement type (section 12).
- **Run executor**: runs steps, runs checks, retries, waits for approvals, records history (section 13).
- **Scoped harness config**: for each worker step, a generated configuration that enables only the MCP servers, plugins, skills and tools the flow or step declares, plus the gateway endpoint and approval hooks where the harness supports them (section 11.7).
- **MCP gateway**: a local MCP server included in every worker's scoped config. It serves the tools FlowDriven itself provides (for example browser automation for managed profiles), proxies MCP servers that FlowDriven can sit in front of, exposes only the tools the step's requirements declare, holds risky tool calls for approval, and injects secrets at call time. It is also the route for harnesses that lack per-tool controls. Where a connector runs natively inside a harness instead (for example Figma's remote server, which accepts only catalogued clients), the boundary is enforced by the scoped config and the harness's own controls, which is weaker (section 11.7).
- **Runner API**: one typed set of operations used by the desktop app over the local socket, and exposed as an MCP server in phase 2 (section 8.7).
- **Harness detector and quota tracker**: section 11.
- **Marketplace**: accounts, listings, package storage, scanning, signing, revocation (section 14).

### 8.3 Process model

```mermaid
sequenceDiagram
  participant U as User
  participant App as Desktop app
  participant R as Runner
  participant B as Brain (harness or API)
  participant W as Worker harness
  participant G as MCP gateway
  U->>App: "Run 'Email triage' now"
  App->>R: runs.start(flow, inputs)
  R->>R: readiness re-check
  R->>W: spawn CLI in project folder, least-permission flags, scoped config (declared servers + gateway)
  W->>G: tool call (gmail.search)
  G-->>W: result (declared tool, allowed)
  W->>G: tool call (gmail.send)
  G->>R: risky: hold for approval
  R->>App: inbox item + macOS notification
  U->>App: Approve
  App->>R: approvals.resolve(approve)
  R->>G: release
  G-->>W: result
  W-->>R: step output + exit
  R->>R: run checks
  R->>B: judge check (if declared)
  B-->>R: verdict JSON
  R->>App: step passed, next step
```

Rules:
- The runner is the only process that writes SQLite and the only one that spawns harnesses.
- The UI talks to the runner over a Unix domain socket in the app's support folder, with JSON-RPC and an event stream. The socket is readable only by the user.
- Every harness runs as a child process of the runner, in the project folder (or a git worktree for code flows), with an explicit environment. No secrets go into its environment unless a declared requirement needs an environment variable, and then only for that process.
- The gateway runs inside the runner. Each worker gets a per-run gateway endpoint (stdio shim or loopback HTTP with a one-time token) inside its scoped harness config. The diagram shows a gateway-routed mail server; a native connector's risky call takes the hook route in section 11.7 instead.
- launchd restarts the runner if it crashes. Steps that were running are marked `interrupted` (section 13.5).
- The launch agent's PATH differs from the user's shell PATH. The runner resolves PATH once from a login shell and stores it (section 11.1).

### 8.4 Storage

Location: `~/Library/Application Support/FlowDriven/` (per user). Main SQLite tables:

| Table | Holds |
|---|---|
| `flows`, `flow_versions` | Local and installed flows; manifest JSON; content hash; source (local, marketplace slug and version, signature). One-time flows are stored here with `saved = false` and are kept with their runs (section 10.7). |
| `projects` | Folder path, linked flows, settings |
| `memory_items` | Scope (flow or project), kind (fact, decision, preference, lesson), text, source run, created and updated time |
| `harnesses` | Detected harnesses, versions, paths, risk label, consent status, inventory snapshot |
| `requirement_states` | Requirement id, state, detail, checked time, route used |
| `runs`, `step_runs`, `check_results` | Run lifecycle, per-step attempts, outputs, check verdicts and evidence |
| `approvals` | Pending and resolved approvals, with payload preview and decision |
| `usage_events` | Per harness or provider: tokens if reported, wall time, rate-limit hits, estimated cost |
| `budget_months` | Month, cap, spent, warnings sent |
| `audit_log` | Append-only record of every risky action, approval, install and permission change |

Run artifacts (logs, outputs, screenshots) are files under `runs/<run-id>/`. Retention: keep 90 days or the last 50 runs per flow, whichever is larger. **Chair's call (owner may override)**: enough history for resume and debugging without filling the disk.

### 8.5 Secrets
- All secrets (API keys, app passwords, OAuth refresh tokens that FlowDriven itself obtains) live in the macOS Keychain under service `FlowDriven`, one item per secret.
- Flows refer to secrets by reference (`secret:wordpress-app-password`), never by value. Packages that contain values that look like secrets are rejected at publish.
- The gateway injects a secret at call time. Secrets never go into brain prompts, worker prompts, logs or run artifacts. Logs pass through a redactor that masks known secret values and common key patterns.
- FlowDriven never reads, copies or forwards a harness's own login files (for example Codex's `auth.json` or Claude's credentials). Harnesses log in through their own flows.

### 8.6 Marketplace server API (v1)

Base: `https://api.flowdriven.ai/v1`. JSON over HTTPS. Anonymous unless marked. **Chair's call (owner may override)**: `flowdriven.ai` is the planned domain. A registry lookup (RDAP) on 2026-11-10 returned no record for it, so it is probably unregistered, but that is not confirmed. The project has not registered it (18.2), so the base URL lives in one config value.

| Method and path | Auth | Purpose |
|---|---|---|
| `GET /flows?q=&category=&harness=&page=` | none | Search public listings |
| `GET /flows/{slug}` | none (private: member) | Listing page: description, publisher, versions, requirement summary |
| `GET /flows/{slug}/versions/{semver}` | none (private: member) | Manifest, content hash, signature, scan report |
| `GET /flows/{slug}/versions/{semver}/package` | none (private: member) | Signed, short-lived R2 download URL |
| `GET /revocations?since=` | none | Signed list of revoked versions and banned publishers |
| `POST /reports` | none, rate limited | Report a flow version (reason, details, optional contact email) |
| `POST /auth/email/start`, `POST /auth/email/verify` | none | Email one-time code; returns session |
| `POST /auth/phone/start`, `POST /auth/phone/verify` | session | SMS one-time code; required before publishing |
| `POST /publisher/flows` | verified publisher | Create a listing (slug, title, visibility) |
| `POST /publisher/flows/{slug}/versions` | verified publisher | Upload a package; starts the scan |
| `GET /publisher/flows/{slug}/versions/{semver}/scan` | verified publisher | Scan status and report |
| `PATCH /publisher/flows/{slug}` | verified publisher | Visibility, description, deprecate |
| `POST /publisher/flows/{slug}/invites` | verified publisher | Invite by email (phase 2, free flows) |
| `POST /teams`, `POST /teams/{id}/members` | verified publisher | Teams and organizations (phase 2, free flows) |
| `POST /appeals` | publisher | Appeal a takedown |
| `/admin/*` | operator | Takedown, revoke version, ban publisher, review reports |

Installing a private flow requires the invitee or team member to sign in with email (no phone needed). **Chair's call (owner may override)**: access control needs an identity; this does not change the owner's rule that public browsing and installing need no login.

The web side of the marketplace (listing pages, the public catalog, docs) is server-rendered for search and LLM crawlers (section 14.9).

### 8.7 Runner API and MCP-server mode

**Chair's call (owner may override)**: one set of operations, two transports, so users who drive their own harness get FlowDriven without FlowDriven starting that harness.

The runner defines its operations once, in a typed contract (name, input schema, output schema, error codes). The desktop app calls them over the local socket (8.3). The same contract is exposed as an MCP server in phase 2, with no separate logic.

| Operation | Purpose | Exposed over MCP (phase 2) |
|---|---|---|
| `flows.build` | Draft a flow from a description; returns the draft and the playback summary | yes |
| `flows.list`, `flows.get` | Saved and installed flows | yes |
| `flows.run` | Run a saved flow, or a one-time flow from a description (10.7) | yes |
| `runs.status`, `runs.report` | Progress, check results, the three-line report | yes |
| `readiness.check` | The checklist for a flow | yes |
| `approvals.list` | Pending approvals with payload previews | yes |
| `approvals.resolve` | Approve, edit or reject | yes, with the rule below |
| settings, budget, consent, publishing | Change settings, raise the budget, give harness consent, publish | no: app only |

MCP-server mode (the "inverted" mode):
- The user adds FlowDriven as a local MCP server to their own harness (for example Claude Code) and drives their own session. That session thinks; FlowDriven provides flows, readiness, the run engine, memory and the approval inbox.
- This is the official route for Claude subscriptions (6.1): FlowDriven never starts the harness, never touches its login, and never routes requests through plan credentials.
- Worker steps go either back to the calling session as tasks it carries out itself (the fully official option), or to other harnesses the user has consented to, under the normal routing rules (11.6).
- Approvals: a model must never approve its own risky action. `approvals.resolve` over MCP can resolve flow sign-offs and result sign-offs. For risky actions (send, post, pay, delete, merge) it only opens the item in the FlowDriven app (or a macOS notification) for one-click confirmation by the user. The docs tell users never to auto-allow `approvals.resolve` in their harness.
- Brain/backends table: listed as a mode in 10.3.

---

## 9. Flow package format

The format and its SDK (parser, validator, hasher, packer) are open and MIT-licensed. **Owner decision (2026-11-09)** for the licence; the shape below is a **Chair's call (owner may override)**: it reuses the Agent Skills standard so flows work across harnesses.

### 9.1 Folder layout

```
figma-to-flutter/
  flow.yaml              # manifest (required)
  README.md              # human description (required)
  LICENSE                # (required for public flows)
  skills/
    flutter-from-figma/
      SKILL.md           # Agent Skills format
      reference/widgets.md
  templates/
    pr-body.md
  checks/
    screens.schema.json  # data used by checks, never executable
```

v1 marketplace packages contain text only: Markdown, YAML, JSON and plain templates. No scripts, binaries or archives. Size limits: 2 MB per file, 10 MB per package. **Chair's call (owner may override)**: text-only packages can be read in full by scanners, padding attacks hit the limits, and code a flow needs comes through declared, separately installed requirements instead of the package. Local flows that are never published may include scripts, shown with a "contains code" warning.

### 9.2 Manifest fields

| Field | Type | Notes |
|---|---|---|
| `format` | string | `"flowdriven-flow/1"` |
| `id` | string | Reverse-DNS style, unique per publisher (`dev.example.figma-to-flutter`) |
| `name`, `summary`, `description` | string | English |
| `version` | semver | Bumped on every change |
| `publisher` | string | Marketplace handle (filled at publish) |
| `license` | SPDX id | |
| `kind` | `build` or `light` | `build`: FDD-full, checks are mostly automated (code, data). `light`: success criteria agreed up front plus a final user approval (content, research, communication). The split is a **Chair's call (owner may override)** (10.1). |
| `inputs` | list | Typed inputs (9.5) |
| `outputs` | list | Named results (9.5) |
| `requirements` | list | Typed requirement list, the permission boundary (9.4) |
| `defaults` | object | Flow-level `skills`, `connectors`, `worker` preferences |
| `steps` | list | Ordered steps (9.3) |
| `approvals` | object | Extra approval points beyond the built-in risky list |
| `schedule` | optional | Suggested schedule; the user enables it |
| `memory` | optional | Keys the flow expects to learn (for example `brand_voice`) |

### 9.3 Steps and checks

Step fields:

| Field | Notes |
|---|---|
| `id` | Permanent. Never reused after deletion. Run history and memory refer to it. |
| `title` | Short, shown in the step list |
| `do` | `worker` (a harness does it), `agent` (the brain does it, no tools), or `builtin` (a FlowDriven action such as "ask the user", "copy file", "wait for approval") |
| `instructions` | Plain-English task; may reference inputs and earlier outputs with `${inputs.x}` and `${steps.id.outputs.y}` |
| `skills`, `connectors` | Override the flow defaults for this step: `+name` adds, `-name` removes, or a full list replaces |
| `uses` | Requirement ids this step may touch. Must be a subset of the flow's requirements. |
| `worker` | Optional preference: `effort: low\|medium\|high`, `prefer: [codex, claude-code]`, `needs: [vision, browser]` |
| `outputs` | Declared outputs (files, values) |
| `checks` | One or more checks |
| `retry` | Max attempts (default 2 retries after the first try) |
| `risky` | Extra risky tools for this step beyond the built-in list |

Check types:

| Type | Passes when | Independent of the worker? |
|---|---|---|
| `command` | A declared CLI exits 0 in the project folder (for example `flutter analyze`) | yes |
| `files` | Paths exist, match globs, size or count bounds | yes |
| `schema` | A JSON or YAML output validates against a schema | yes |
| `contains` / `not_contains` | Output text matches or avoids patterns (for example no unfilled placeholders) | yes |
| `judge` | A fresh brain session, not the worker's session, scores the output against a written rubric and returns pass or fail with reasons | yes, if a different session |
| `user` | The user approves the result in the inbox | yes |
| `probe` | A real tool call confirms an effect (for example a draft exists in the mailbox) | yes |

Rules (counter anti-goal 2):
- Every step has at least one required check.
- At least one required check per step must be independent of the worker. The worker's own "I'm done" never counts.
- `judge` checks must quote the evidence they relied on. A step whose only checks are `judge` checks shows "judged, not verified" in the run report.
- `light` flows end with a `user` check on the final output.

### 9.4 Requirements (the permission boundary)

Each requirement:

| Field | Notes |
|---|---|
| `id` | Local id used by steps (`figma`) |
| `type` | `harness`, `skill`, `plugin`, `mcp_server`, `cli_tool`, `gui_app`, `account`, `browser_session`, `path` |
| `ref` | Catalog id where one exists (`mcp:figma-remote`, `cli:flutter`), or an inline definition |
| `required` | true or false |
| `sensitive` | true if it touches private data, money or outbound messages |
| `tools` | For MCP servers: the exact tool names the flow may call. Anything else is left out of the scoped harness config and blocked by the gateway (11.7). |
| `connect` | For MCP servers, plugins and skills: `native` (the harness's own installed connector, enabled per run by the scoped config; the default when the harness has it) or `gateway` (served or proxied by the FlowDriven gateway). Optional; the router picks when it's absent. |
| `commands` | For CLI tools: allowed commands and argument patterns |
| `domains` | For browser sessions: sites the flow may open |
| `access` | For paths: `read` or `read_write`, inside the project folder. **Chair's call (owner may override)**: an extra folder is an explicit grant the user makes at install. It is shown in the install preview, written to the audit log and can be revoked. Once granted, it counts as part of that flow's allowed folders. The grant softens the owner's "workers are limited to the project folder" rule, so it stays narrow and visible. |
| `routes` | Alternatives, each with a risk label (`official`, `gray`, `unofficial`) and a note |
| `why` | One line shown in the install preview |

Enforcement (the requirement list is the boundary as far as each harness supports; section 11.7):
- MCP tools through the gateway: fully enforced by the gateway (allow-list per step).
- MCP tools, plugins and skills used natively in a harness: enforced by the scoped harness config (only declared servers, plugins and skills enabled; an allowed-tools list) and, where the harness has them, pre-tool hooks. This depends on each harness's own controls and is weaker than the gateway. The install preview says which applies.
- Files: enforced by the harness sandbox where the harness has one (section 11.4) plus the project-folder working directory. Honest limit: a harness without a filesystem sandbox can't be held to the folder by FlowDriven alone. Such harnesses show "no sandbox" and get a lower trust label (11.4, 15.3).
- CLI commands: enforced by harness allow-lists where available (for example a harness's allowed-tools setting); otherwise prompt-level only. Shown honestly in the preview.
- Browser domains: enforced by the managed browser profile's allow-list (section 12.6).

### 9.5 Inputs and outputs
Input types: `text`, `number`, `bool`, `enum`, `date`, `url`, `file`, `folder`, `secret_ref`, `list<text>`. Each input has `id`, `type`, `label`, `required`, `default`, and an optional `remember: true`, which stores the last value in flow memory and offers it next time.

Outputs: `id`, `type` (`file`, `folder`, `text`, `url`, `json`), `path` or `from_step`. The final outputs appear in the run report.

### 9.6 Versioning and content hash
- Semantic versions. Requirements or permissions added: at least a minor bump, and installed users must re-consent. Steps removed or inputs changed incompatibly: a major bump.
- Content hash: SHA-256 over a canonical listing of every file (sorted UTF-8 paths, LF line endings, each line `path\tsha256(file)`), written `sha256:<hex>`.
- The marketplace signs `{id, version, hash, publisher, scanned_at}`. The app checks the signature against the pinned key before install and before each run.
- Published versions are immutable. A fix is a new version.
- Installed flows are pinned to a hash. Updates are never silent: the user sees what changed in requirements, permissions and steps, then accepts.
- Local edits to an installed flow fork it into a local flow with its own version line.

### 9.7 Portability through Agent Skills
- Step instructions and bundled skills are plain Agent Skills folders (`SKILL.md` with `name` and `description` front matter). At run time FlowDriven copies the step's skills into the location the chosen harness reads for that run (a per-run project-scoped skills folder where the harness supports one) and removes them afterwards. For a harness without skills support, the skill text goes into the prompt.
- Skills the user already has installed in a harness can be listed as `skill` requirements instead of being bundled.
- Export: any flow can be exported as a plain skills folder plus a `marketplace.json` plugin manifest for use without FlowDriven. Export loses readiness checks, gates and approvals, and the export screen says so. **Chair's call (owner may override)**: an open, exportable format protects users if FlowDriven or any store disappears.

### 9.8 Example manifest

```yaml
format: flowdriven-flow/1
id: dev.example.figma-to-flutter
name: Figma to Flutter
summary: Turn selected Figma frames into Flutter screens in your repo, with analyze and widget tests passing.
version: 1.0.0
license: MIT
kind: build

inputs:
  - id: figma_url
    type: url
    label: Figma file or frame link
    required: true
  - id: repo
    type: folder
    label: Flutter project folder
    required: true
    remember: true
  - id: screens
    type: list<text>
    label: Frame names to build (empty = all top-level frames)

outputs:
  - id: branch
    type: text
    from_step: open-pr
  - id: screen_files
    type: folder
    path: lib/screens/

requirements:
  - id: coder
    type: harness
    ref: harness:any-coding
    required: true
    why: Writes the Dart code.
    routes:
      - { via: codex, risk: official }
      - { via: claude-code-api-key, risk: official }
      - { via: claude-code-subscription, risk: gray, note: "claude -p on a plan login" }
  - id: figma
    type: mcp_server
    ref: mcp:figma-remote
    required: true
    sensitive: false
    connect: native   # Figma remote MCP accepts only catalogued clients, so no gateway in front
    tools: [get_design_context, get_screenshot, get_variable_defs, get_metadata]   # tool names to verify
    why: Reads frames, tokens and screenshots.
    routes:
      - { via: remote, risk: official, note: "Through a catalogued harness's own connector. Dev or Full seat needed in practice (20 calls/month otherwise)" }
      - { via: desktop, risk: official, note: "Enable in Figma Dev Mode; Dev or Full seat" }
  - id: figma-seat
    type: account
    ref: account:figma-dev-seat
    required: true
    why: Without a Dev or Full seat the call limit makes the flow unusable.
  - id: flutter
    type: cli_tool
    ref: cli:flutter
    required: true
    commands: ["flutter analyze", "flutter test", "flutter pub get", "dart format *"]
  - id: git
    type: cli_tool
    ref: cli:git
    required: true
    commands: ["git status", "git add *", "git commit *", "git switch *", "git push origin flowdriven/*"]
  - id: project
    type: path
    ref: input:repo
    access: read_write

defaults:
  skills: [flutter-from-figma]
  connectors: [figma]
  worker: { effort: medium, prefer: [codex, claude-code] }

steps:
  - id: read-design
    title: Read the design
    do: worker
    worker: { effort: low }
    uses: [figma, project]
    instructions: >
      For each frame in ${inputs.screens} (or all top-level frames) in ${inputs.figma_url},
      collect layout, text, colors and assets. Write design/screens.json.
    outputs: [{ id: spec, type: file, path: design/screens.json }]
    checks:
      - { type: schema, file: design/screens.json, schema: checks/screens.schema.json }
      - { type: files, exists: [design/screens.json] }

  - id: plan-widgets
    title: Plan widgets and tokens
    do: agent
    instructions: >
      From design/screens.json and project memory (existing theme, widget library),
      list the widgets to create or reuse. Ask the user only if two choices change the result.
    outputs: [{ id: plan, type: file, path: design/plan.md }]
    checks:
      - { type: contains, file: design/plan.md, patterns: ["## Screens", "## Shared widgets"] }

  - id: build-screens
    title: Build the screens
    do: worker
    uses: [coder, flutter, git, project]
    skills: [+flutter-from-figma]
    instructions: Implement design/plan.md in a git worktree on branch flowdriven/figma-${run.id}.
    retry: 3
    checks:
      - { type: command, run: "flutter analyze", expect_exit: 0 }
      - { type: command, run: "flutter test", expect_exit: 0 }
      - { type: files, exists: ["lib/screens/*.dart"], min_count: 1 }

  - id: visual-review
    title: Compare with the design
    do: agent
    instructions: Compare golden screenshots from the tests with Figma screenshots.
    checks:
      - { type: judge, rubric: "Layout, spacing, text and colors match within reason. List every mismatch." }

  - id: open-pr
    title: Push the branch
    do: worker
    worker: { effort: low }
    uses: [git, project]
    instructions: Commit and push the branch. Do not merge.
    outputs: [{ id: branch, type: text }]
    checks:
      - { type: command, run: "git status --porcelain", expect_output: "" }
```

Pushing to the user's own repo is normal work. Merging is on the risky list and is never part of this flow. **Owner decision (2026-11-09)**.

---

## 10. The agent

### 10.1 Clarifying work into a flow (adapted FDD)
FDD ideas kept: the flow is the contract; objective gates instead of self-reported status; ordered human approvals bound to the current version, which go stale when the flow changes; permanent ids; refine the flow rather than regenerate it; the worker stops and asks when the flow lacks a behavior; an independent reviewer instead of self-grading. **Owner decision (2026-11-09)** to use FDD; the adaptation below is a **Chair's call (owner may override)**: it keeps the method's contract and gates while cutting the ceremony laypeople won't tolerate.

```mermaid
flowchart TD
  A["1. Intake: user describes the work in chat"] --> B["2. Clarify: up to 3 questions that change the flow;<br/>everything else becomes a stated default"]
  B --> C["3. Draft: steps, checks, requirements, inputs, outputs<br/>(kind = build or light)"]
  C --> D["4. Playback: one-screen summary + step list"]
  D -->|"user edits in chat or step list"| C
  D -->|"Approve flow (gate 1)"| E["5. Readiness check (gate 2)"]
  E -->|"missing items"| F["Fix: auto (confirm) or guided manual"]
  F --> E
  E -->|"all required ok"| G["6. First run, approvals on"]
  G --> H["7. Learn: save decisions and lessons to memory"]
  H --> I["Ready for daily use / publish"]
```

Rules:
- At intake the agent decides whether the request is recurring work (this path) or one-off work (the one-time path in 10.7). When unsure, it runs the work as a one-time flow and offers to save it afterwards, rather than asking.
- Before asking anything, the agent checks memory, the project folder and detected inventory.
- Questions come one round at a time, at most 3, each with suggested answers.
- The playback is short: the goal in one sentence, the step list, what the flow will touch (the requirements in plain words), and what it will ask approval for.
- Approving the flow binds the approval to that version's hash. Any edit makes it stale; the next run asks for a one-tap re-approval with a diff.
- `build` flows: checks are mostly automated (command, schema, files). `light` flows: the user agrees success criteria at the start and approves the final output. The build/light split follows a model the owner confirmed for the earlier concept (2026-11-09); applying it to flows is a **Chair's call (owner may override)**.

### 10.2 Building and editing
- Chat is the main way to create and change flows. **Owner decision (2026-11-10)**.
- The step list sits beside the chat. Each row shows title, worker, uses, checks and status. The user can rename, reorder, delete, duplicate or add a step, and edit instructions and checks in place. Chat edits and direct edits change the same manifest.
- The agent validates every change with the SDK validator (step `uses` subset of requirements, at least one independent check, ids unique, references resolve) and explains errors in one line.
- Each saved change creates a new local version. Undo goes back one version.

### 10.3 Brain providers, picker and fallback
`BrainProvider` interface:

```ts
interface BrainProvider {
  id: string;                      // "codex-cli", "claude-cli", "anthropic-api", ...
  risk: "official" | "gray" | "unofficial";
  available(): Promise<Availability>;          // installed, logged in, quota state
  complete(req: BrainRequest): Promise<BrainResult>; // JSON-schema-constrained output
  estimate(req: BrainRequest): CostEstimate;   // tokens and money, if metered
}
```

Backends (**Chair's call (owner may override)**: covers every route the owner allowed, starting with the clearest):

| Backend | How | Risk | Phase |
|---|---|---|---|
| Codex CLI | app-server or `codex exec` with JSON output, user's own login | official | 1 |
| Claude Code CLI | `claude -p` with JSON or stream-JSON output | gray on a plan login; official with an API key | 1 |
| API keys | Anthropic, OpenAI, Gemini (paid tier) | official | 1 |
| Sign in with ChatGPT | FlowDriven registers as an open-source app | official | 2 |
| Antigravity | `agy -p` | unofficial (vendor-prohibited) | 1, behind consent |
| Others (OpenCode, Copilot CLI, Grok, Hermes) | adapters as researched | unknown or gray | 2+ |
| MCP-server mode (a mode, not a backend) | The user's own harness session (for example Claude Code) calls FlowDriven as an MCP server and acts as the brain itself (8.7) | official (inferred) | 2 |

Phase-1 harness adapters, as brain and as worker: Codex, Claude Code and Antigravity, the most common daily harnesses. Others follow from phase 2. **Chair's call (owner may override)**.

The brain gets no tools. It receives context and returns JSON matching a schema (flow drafts, plans, judge verdicts, short reports). FlowDriven carries out the result. **Chair's call (owner may override)**: tool-free calls are cheap, predictable and portable across backends.

Picker: settings show every detected backend with its risk label, login state and quota state. The user picks the main brain and orders the fallbacks. **Owner decision (2026-11-09)**.

Fallback order when the brain hits a quota or rate limit:
1. The next subscription harness in the user's order.
2. Then API-key providers in the user's order, only while the monthly budget has room.
3. If nothing is left: pause the conversation or run, and tell the user (a decision is needed).
**Owner decision (2026-11-09)**. The same quota-aware switching applies to workers. **Chair's call (owner may override)**: the anti-goal on wasted quota applies equally to workers.

### 10.4 Monthly API-key budget
- The user sets one monthly cap (in USD) for all API-key spending, plus an optional per-run cap. The default is 0: API keys stay off until the user sets a cap. **Chair's call (owner may override)**: the owner wants paid keys used only within an approved budget, so no budget means no spend.
- Spending is estimated from the token usage each call reports, times a price table shipped with the app and editable by the user. The estimate is labelled as an estimate.
- Before a run that may use API keys, the runner shows a rough cost range if it's above 10% of the remaining budget.
- At 80% the app shows a quiet badge. At 100% API-key calls stop; the run pauses with an inbox item ("Raise budget for this month?").
- Raising the cap is an approval logged in the audit log.

### 10.5 Memory
Scopes:
- **Per flow**: input defaults, preferences (tone, format), decisions made during clarifying, lessons from failed checks ("tests need `--no-pub`").
- **Per project**: what the project is, stack, conventions, glossary, key decisions with dates, people and accounts involved (names only, never secrets).

Rules:
- The agent writes memory items when a decision is made, when the user corrects it, and after each run (at most 3 lessons per run).
- Every brain and worker call gets a compact memory digest (budgeted to about 1,500 tokens; the most relevant items first).
- The user can view, edit, pin and delete memory items in the app.
- Memory stays on the machine. It is never published with a flow. Publishing offers to turn chosen flow-level defaults into manifest defaults, and the user picks which.
**Chair's call (owner may override)** for all of 10.5: memory is the counter to anti-goal 3, and keeping it local protects private data.

### 10.6 Notification policy
**Owner decision (2026-11-09)**: notify only when a decision or a problem needs the user. Concretely (**Chair's call (owner may override)**):

Notify (macOS notification plus inbox item):
- an approval is waiting (risky action, flow re-approval, final result);
- a run is blocked: checks still fail after retries, a requirement is missing or a login expired before or during a run;
- the budget cap is reached, or no brain or worker has quota left;
- a revoked flow version is installed.

Never notify:
- step progress, successful runs, routine retries, harness switches within the user's order.

Successful runs leave a three-line report in run history: what was done, what was produced (links), anything that needs a look. Batch notifications: at most one per run per 10 minutes unless an approval is waiting.

### 10.7 One-time flows
**Owner decision (2026-11-10)**: "Yes, as one-time flows". A request in chat that is not a saved flow runs right away as an unsaved one-time flow on the same engine: approvals, memory, checks, risk rules and readiness all apply. Afterwards the agent offers to save it as a reusable flow.

How it stays cheap (**Chair's call (owner may override)**: a quick throwaway job must cost less effort than doing it by hand):
- No manifest editing and no step-list screen. The agent drafts steps, checks and requirements internally and shows a short plan in chat: the goal in one line, the steps, what it will touch, and what it will ask approval for.
- No flow sign-off (gate 1 in 10.1). The run starts after the plan unless the user stops or edits it in chat. Risky actions still need approval, always.
- Clarifying questions: the same limit of 3, usually zero. The agent uses memory and stated defaults first.
- Readiness covers only the requirements the steps use. Anything missing goes through the normal checklist inline in chat.
- Checks: every step still has at least one check the worker doesn't control (anti-goal 2). For simple work the agent picks default checks (expected files exist, no unfilled placeholders, a `user` check on the final result for content work).
- The brain cost is one planning call plus the normal per-run calls (11.6). Workers are routed as usual.

Boundary rule (**Chair's call (owner may override)**: with no flow sign-off, the plan in chat is the user's only look at what the run may touch, and injected content must not be able to widen it quietly):
- The plan shown in chat lists every requirement marked `sensitive`.
- The requirement list is frozen when the run starts. Anything the brain wants to add later needs an approval inbox item before it takes effect.

After the run:
- The run report ends with one line: "Save this as a flow?" It is a line in chat and in the report, not a notification.
- Saving turns the stored manifest into a local flow at version 1.0.0. The agent proposes which values become inputs (with this run's values as defaults) and which lessons go into flow memory. The normal step list then opens for editing.
- Not saving keeps the one-time flow only as part of the run (`saved = false`, same retention as run history, 8.4). Lessons go to project memory.
- The user can turn the save offer off in settings.
- One-time flows can't be published. They must be saved first, which brings in the normal validation.

---

## 11. Harness integration

### 11.1 Detection
- Resolve PATH from the user's login shell once at install (and on demand), because a launch agent does not inherit the shell PATH. Add common install folders (`/opt/homebrew/bin`, `/usr/local/bin`, `~/.local/bin`, npm, bun and nvm global folders) and any paths the user adds by hand.
- For each known harness: find the binary, run its version command, check its config directory exists, and run a login-status probe where the harness has one.
- Re-detect at app start, before each run (cheap: cached binary check), and when the user clicks "Re-scan".
- Show each harness as a card: version, path, login state, risk label, quota state, consent state.

Known harness table (binary names and probes to verify at build time; the research confirmed the harness list and policy, not every command):

| Harness | Binary | Config directory (candidate) | Label |
|---|---|---|---|
| Claude Code | `claude` | `~/.claude`, project `.claude/`, `.mcp.json` | gray on plan login, official with API key |
| Codex | `codex` | `~/.codex` (`config.toml`) | official |
| Antigravity | `agy` | to verify | unofficial (vendor-prohibited) |
| GitHub Copilot CLI | `copilot` (to verify) | to verify | unknown |
| OpenCode | `opencode` | `~/.config/opencode` (to verify) | unknown |
| Hermes | to verify | to verify | gray |
| Grok | to verify | to verify | unknown |
| Gemini CLI | `gemini` | `~/.gemini` | gray, leaning prohibited |

The adapter registry is data-driven, so adding a harness means adding one adapter file and one table row. Phase 1 ships full adapters (detection, inventory, brain, worker, scoped config) for Codex, Claude Code and Antigravity; the other rows get detection only until their adapters follow. **Chair's call (owner may override)** (10.3).

### 11.2 Inventory: skills, plugins and MCP servers
**Owner decision (2026-11-10)**: FlowDriven detects what each harness already has installed.

For each harness, an inventory probe returns `{skills[], plugins[], mcpServers[]}` with name, scope (user or project), source and, for MCP servers, connection state if the harness reports it. Preferred source order: (1) the harness's own list command in machine-readable form, if it has one; (2) reading its config files read-only. Candidate sources to verify at build time:
- Claude Code: an MCP list command; user and project skills folders (`~/.claude/skills`, `.claude/skills`); installed plugins under `~/.claude/plugins`; MCP config in user settings and `.mcp.json`. Claude Code distinguishes "needs authentication" from "failed to connect" for MCP servers (research), which maps onto the readiness states.
- Codex: `[mcp_servers.*]` tables in `~/.codex/config.toml`; an MCP list command; its skills folder.
- Others: where unknown, show "inventory not supported yet" rather than guess.

Rules: read-only; never read credential files; never parse secrets out of config values (mask anything that looks like a token). Inventory is cached and refreshed with detection.

### 11.3 Worker adapters
`WorkerAdapter` interface:

```ts
interface WorkerAdapter {
  harness: string;
  capabilities: {
    sandbox: "os" | "none"; skills: boolean; mcp: boolean; json: boolean; resume: boolean;
    scopedMcp: boolean;      // can run with only a per-run MCP config, ignoring the user's others
    toolAllowList: boolean;  // accepts an explicit allowed-tools list
    preToolHook: boolean;    // can call out to FlowDriven before a tool runs
  };
  buildScopedConfig(task: WorkerTask): ScopedConfig; // declared MCP servers, plugins, skills, allowed tools, hooks, gateway
  buildCommand(task: WorkerTask, config: ScopedConfig): SpawnSpec; // binary, args, cwd, env, config paths
  parseEvents(stream: Readable): AsyncIterable<WorkerEvent>; // progress, tool calls, usage, final
  classifyExit(code: number, tail: string): ExitClass; // ok, failed, quota, auth, interrupted
}
```

Each `WorkerTask` carries: step instructions, inputs, memory digest, the declared skills, plugins and MCP servers (flow defaults plus step overrides), the gateway endpoint, the project folder or worktree, a time limit (default 30 minutes per attempt) and the permission profile.

Adapters are tested against fake harness CLIs (scripted binaries that replay recorded event streams, exit codes and error text), so every adapter can be tested without a real subscription (17.1).

### 11.4 Permission modes
**Owner decision (2026-11-09)**: workers are limited to the project folder, and no permission-bypass mode runs by default.

- Each adapter uses the least-permission flags its harness supports: a workspace-write sandbox limited to the project folder where the harness offers one; an explicit allowed-tools list where the harness offers one; the per-run scoped config from 11.7, which enables only the declared MCP servers, plugins and skills plus the gateway and turns the user's other servers off, where the harness supports that.
- FlowDriven never passes a permission-bypass or full-access flag to a harness. A deny list is hard-coded: `--dangerously-skip-permissions`, `--yolo`, `--trust-all-tools`, and any harness equivalent of "full access". The runner refuses to spawn with them. No setting, per flow or global, enables them. If a flow cannot run inside the limits, the readiness check reports it as blocked and says why. **Chair's call (owner may override)**: the owner first said 'not by default'. The owner later made the folder limit and the requirement boundary always on (15.2), so v1 offers no opt-in at all.
- Code flows run in a git worktree under the project, on a branch named `flowdriven/...`, so the user's working tree is untouched.
- The exact flags per harness are left to the builder.
- **Chair's call (owner may override)**: a harness that cannot be limited to the project folder shows "no sandbox" on its card. On such a harness the folder limit rests only on the working directory, the scoped config and hooks, which is weaker (15.3). Flows marked `sensitive` do not route to it unless the user allows it. This reconciles two owner decisions: run every detected harness (11.5), and limit workers to the project folder.

Because a worker runs headless, it can't ask the user mid-step through its own UI. Risky actions are therefore held for the FlowDriven approval inbox: by the gateway on gateway-routed tools, and by pre-tool hooks or allowed-tools lists on native connectors (section 11.7, section 13.3).

### 11.5 Risky harnesses: the "like Multica" stance
**Owner decision (2026-11-09)**: every detected harness may be auto-run, each with an account-risk warning.

- Labels: official, gray, unofficial. Unofficial routes that vendor text explicitly forbids also show "vendor terms prohibit this; your account could be suspended".
- First auto-run of a gray or unofficial harness shows a consent screen in plain words, with the vendor's own sentence where the research has one. Consent is stored per harness, can be revoked, and is shown on the harness card. **Chair's call (owner may override)**, proposed 2026-11-09: the warning is useless if the user never sees it at the moment it matters.
- In the brain picker and the router, official routes sort first. The router never moves work to a gray or unofficial harness the user has not consented to.
- The marketplace and any FlowDriven server never run harnesses.

### 11.6 Quota tracking and routing
- Record per call: harness, model if known, tokens if the harness reports them, wall time, exit class.
- Detect quota and rate-limit failures from exit codes and known error text per adapter. Mark the harness "exhausted until <time>" if the reset time is parseable; otherwise back off (15 min, 30, 60).
- Show per-harness usage for today and this week. Note on the Codex card that ChatGPT plan usage is shared across apps (research), so the brain and workers draw from the same allowance.
- Routing per step: filter harnesses by consent, availability, required capabilities (`needs`) and whether the step's requirements are reachable from that harness (a native connector installed in it, a gateway route, or a client limit such as Figma MCP accepting only catalogued clients); drop harnesses that can't hold a step's risky tools for approval (11.7); then prefer the user's preference, then the cheapest harness for `effort: low`, then the strongest for `effort: high`. The brain itself is used sparingly: one call per clarify round, one per plan, one per judge check, one short report per run.
**Chair's call (owner may override)**: concrete rules a builder can implement; the user can pin a harness per step to override.

### 11.7 Connectors: native first, gateway where needed
**Chair's call (owner may override)**: the owner explicitly asked FlowDriven to detect and use what is installed in each harness (Claude Code, Codex and others; 11.2, owner decision 2026-11-10). So native harness connectors, plugins and skills are allowed in flows. The requirement list stays the permission boundary as far as each harness lets FlowDriven enforce it.

**Per-run scoped harness configuration.** For every worker step, the adapter generates a configuration for that run only:
- MCP servers: only those the flow or step declares, for example a per-run MCP config file passed to the harness, with the user's other servers turned off.
- Tools: an allowed-tools list built from the requirements' `tools` and `commands`. Risky tools are handled as described below.
- Plugins and skills: only the declared ones, enabled for the run or copied into a per-run location (9.7).
- The gateway endpoint, always.
- Approval hooks, where the harness has pre-tool hooks.

The config is written to the run folder, passed by flag or environment, and removed when the step ends. The user's own harness settings are never edited. Exact mechanisms per harness (MCP config override, "ignore other servers" option, allowed-tools syntax, plugin and skill enabling, hook support): to verify at build time, for each of Codex, Claude Code and Antigravity first.

**Which route a connector takes.**

| Route | Used for |
|---|---|
| Native: the harness's own installed MCP server, plugin or connector, enabled by the scoped config | The default for connectors the user already has in a harness. Required where a service accepts only catalogued clients: Figma's remote MCP server lets only clients in Figma's catalog connect, so a proxy can't sit in front of it, which is why the native route is the default for Figma. |
| FlowDriven gateway | Tools FlowDriven itself provides (for example browser automation for managed profiles, 12.6). MCP servers from FlowDriven's catalog that it can proxy. Holding risky actions where FlowDriven can sit in the path. Harnesses that lack per-tool controls (no scoped MCP config, no allowed-tools list). |

**Approvals on native connectors.** In order of preference:
1. Where the harness offers pre-tool hooks (for example Claude Code `PreToolUse` hooks), the scoped config installs a hook that sends each risky tool call to the FlowDriven approval inbox and waits for the answer. The hook fails closed: if FlowDriven doesn't answer, the call is blocked.
2. Where the harness has an allowed-tools list but no hooks, risky tools are left off the list. The flow does the risky part as a separate step through the gateway or a `builtin` step that asks first.
3. Where the harness has neither, a native connector with risky tools isn't used on that harness. The router picks another harness or a gateway route (11.6).

**Honest limit.** On native connectors, enforcement depends on each harness's own controls: its config override, its allowed-tools list and its hooks. A harness bug or a missing control can let a call through. That is weaker than the gateway, which sees every call it carries. The install preview and the harness card show which route each connector uses and how it is enforced ("enforced by FlowDriven" or "enforced by the harness's settings"). Flows marked `sensitive` prefer gateway routes, or native routes on harnesses with hooks.

---

## 12. Readiness engine

The readiness engine works like a doctor: it checks every requirement before install and before each run. **Owner decision (2026-11-10)** for the behaviour; the structure is a **Chair's call (owner may override)**.

### 12.1 Types, detectors and probes

| Type | Detector (is it there?) | Probe (does it work?) | Auto-install possible |
|---|---|---|---|
| `harness` | PATH and binary version | login-status command or a tiny no-op call | guided only (vendor installers) |
| `skill` | harness inventory, or bundled in the flow | file present and parsable | yes: copy from a verified package |
| `plugin` | harness inventory | harness reports it enabled | yes, through the harness's own install command, if it has one |
| `mcp_server` | harness inventory (native), or gateway config | connect and list tools; one real read-only tool call | yes for catalog entries (through the harness's own MCP add command, or added to the gateway config); OAuth needs the user |
| `cli_tool` | PATH, version command, minimum version | the requirement's declared health command (`flutter doctor`) | yes for catalog entries (Homebrew or the vendor's package manager) |
| `gui_app` | app bundle lookup (12.6) | optional declared probe (local endpoint, app running) | guided only |
| `account` | keychain item or an MCP tool that reports identity (Figma `whoami` shows plan and seat) | identity or plan probe | guided (user signs in) |
| `browser_session` | managed profile exists | session probe (12.6) | guided (user logs in once) |
| `path` | exists, readable or writable | write test in a temp file | creates the folder if the user agrees |

### 12.2 States
- `ok`: detected and the probe passed.
- `missing`: not detected.
- `needs_login`: detected, but the probe reports no or expired authentication.
- `failed`: detected, but the probe failed for another reason (error shown in one line plus details).

A flow is ready when every required requirement is `ok`. Optional ones that aren't `ok` show as a warning, and steps that use them are skipped with a note.

Probes can lie: a status list can say "connected" while real calls fail (research). Where possible the probe makes one real, read-only tool call.

### 12.3 The checklist and fixes

```mermaid
flowchart TD
  I["Install flow / before run"] --> C["Check each requirement"]
  C --> L["Checklist: one row per item,<br/>state, risk label, manual command"]
  L -->|"all required ok"| R["Ready"]
  L -->|"row not ok"| Q{"User picks"}
  Q -->|"Install automatically"| A["Show exact command or action;<br/>user confirms"]
  Q -->|"Install manually"| M["Step-by-step guide,<br/>copyable commands, 'Check again'"]
  A --> V["Run installer, then probe"]
  M --> V
  V --> C
```

- Each row shows the item, why the flow needs it, its state, the route and risk label, the exact manual command, and two buttons: "Install for me" and "Show me how". **Owner decision (2026-11-10)**.
- Nothing is installed without confirmation. The confirmation shows the exact command.
- Install commands come only from FlowDriven's built-in requirement catalog (shipped with the app, updated through signed catalog releases), never from the flow package. A flow refers to a catalog id; a requirement without a catalog entry gets a manual guide written by the publisher and shown as "publisher's instructions, not verified". No `curl | bash` from URLs a flow supplies. **Chair's call (owner may override)**: this stops a malicious flow from turning "auto-install" into "run my code".

### 12.4 Re-checking before each run and expired logins
- Before each run: re-run every login probe and every probe for requirements the run's steps use. Cache cheap detectors (binary present) for 10 minutes.
- Expired login: refresh the token if the route supports refresh, retry once, then set `needs_login` and ask the user to sign in again (research pattern). A scheduled run that hits this waits up to 12 hours for the user and notifies once.
- The same handling applies mid-run when a tool call returns an auth error: the step pauses, not fails.

### 12.5 Keychain storage
- API keys, app passwords and tokens FlowDriven obtains are stored as Keychain items (service `FlowDriven`, account = requirement ref).
- The checklist asks for a secret in a masked field and stores it straight to the Keychain. The UI never shows it again, only "stored, last used <date>".
- Harness logins stay in each harness. FlowDriven never stores or reads them.

### 12.6 GUI apps and logged-in browser sessions (proposed approach)
The research found no prior art for detecting either. This is a proposal. **Chair's call (owner may override)**.

GUI apps:
- Detect by bundle identifier through Spotlight metadata lookup, falling back to scanning `/Applications` and `~/Applications`. Read the version from the bundle's `Info.plist`.
- Running state through the process list, only when a step needs the app open.
- "Connected" for GUI apps is app-specific. The requirement declares a probe: a local endpoint to reach (for example a desktop MCP server the app exposes), a file the app writes, or a CLI the app ships. Without a declared probe, the state stops at "installed".

Browser sessions:
- Default route: a **managed browser profile** that FlowDriven creates, one per account per site (for example "TikTok: brand account"). The user logs in once in a window FlowDriven opens. Workers reach it only through a browser-automation MCP server behind the gateway, limited to the requirement's `domains`.
- Session probe: the requirement declares a URL and a logged-in marker (an element or text only visible when logged in). The probe loads the page headless in the managed profile and checks for the marker. Marker missing means `needs_login`.
- Using the user's everyday browser profile is possible only as a separate route labelled "unofficial: shares your personal browser" with an explicit consent, because it exposes every site the user is logged into.
- Browser routes that automate actions a site's terms forbid (for example posting to TikTok) carry the `unofficial` label and the site's own sentence.

Open for the builder: which browser automation server to bundle, how to keep managed profiles isolated, and how often sessions expire per site.

---

## 13. Runs and approvals

### 13.1 Run lifecycle

```mermaid
stateDiagram-v2
  [*] --> queued
  queued --> checking: start
  checking --> blocked: requirement not ok
  blocked --> checking: user fixed it
  checking --> running: ready
  running --> waiting_approval: risky action or user check
  waiting_approval --> running: approved
  waiting_approval --> failed: rejected
  running --> retrying: check failed
  retrying --> running: attempts left
  retrying --> blocked: attempts used up
  running --> interrupted: runner stopped
  interrupted --> running: resume
  running --> done: last step checks passed
  failed --> [*]
  done --> [*]
```

### 13.2 Step execution and acceptance checks
For each step:
1. Resolve skills and connectors (flow defaults plus step overrides), the worker (routing rules), inputs and earlier outputs.
2. For worker steps: write the per-run scoped harness config (declared MCP servers, plugins and skills, allowed tools, approval hooks, gateway endpoint; 11.7) and skills folder, spawn the adapter, stream events into the step log.
3. Collect declared outputs. A missing output is a failed check.
4. Run checks in order: independent automated checks first, then `judge`, then `user`.
5. The step is `passed` only when all required checks pass. "Done" means the check passed, never that the worker said so.

### 13.3 Retries, approvals and the risky-action list
Retries: on a failed check, the worker gets the check output ("flutter analyze: 3 errors: ...") and tries again, up to `retry` (default 2). After that the brain gets one re-plan attempt for the step (it may split it or change instructions, within the same requirements). If that fails too, the run is `blocked` and the user is notified. Every attempt is counted against quota and budget.

Risky actions (always need approval, cannot be switched off). **Owner decision (2026-11-09 and 2026-11-10)**:
- **send**: email, messages, comments or invites to anyone other than the user;
- **post/publish**: social posts, blog posts, public uploads (drafts the user finishes later are not risky);
- **pay/spend**: purchases, paid API calls beyond the approved budget, paid generation credits;
- **delete**: deleting or overwriting files outside the run's own scratch area, deleting remote data (emails, posts, records);
- **merge**: merging branches or pull requests.

The list combines two owner decisions: merge (with the other "ask first" items) comes from the 2026-11-09 autonomy decision, and send, post, pay and delete from the 2026-11-10 runtime protections. Both stand, so merge stays on the list.

How they're caught:
- MCP tools: the catalog classifies tools (for example `gmail.send` = send); a flow can add more with `risky`, never remove. On gateway routes the gateway holds any risky call. On native connectors a pre-tool hook sends it to the inbox, or the tool is left off the allowed-tools list and done in a separate step (11.7).
- CLI commands: risky patterns (`git merge`, `gh pr merge`, `rm` outside scratch, `git push --force`) are denied by the harness allow-list where possible and flagged by the runner; a flow that needs one does it as a `builtin` step that asks first.
- Browser: submit actions on the requirement's declared "action" selectors are held.
Honest limit: on harnesses without a sandbox or allow-list, FlowDriven can't intercept everything. Those harnesses are labelled and kept away from sensitive flows by default.

Approval inbox: one list, newest first. Each item shows the flow, step, what will happen in one sentence, the full payload (email text, post preview, diff, amount), and Approve, Edit (for text payloads) or Reject. "Approve all similar for this run" is offered for repeated sends in one run (for example 12 draft replies) and is logged. **Chair's call (owner may override)**: the batch lists every item, covers only that run, and is still an explicit approval by the user, so the owner's rule that sends need approval holds. Approvals expire after 24 hours; the step then fails with a clear reason.

### 13.4 Run history
Each run shows inputs, the worker per step, attempts, check results with evidence, approvals, outputs, usage and estimated cost, and the three-line report. Filters by flow, project and state. Export a run as a Markdown report.

### 13.5 Resume
- Step outputs are saved when each step passes. Code flows commit in the worktree after each passing step.
- A `blocked`, `failed` or `interrupted` run can be resumed from the first unpassed step after the user fixes the cause. Earlier steps are not repeated unless the user asks.
- After a runner crash, interrupted steps are not retried automatically unless the step is marked `idempotent: true`. **Chair's call (owner may override)**: a half-done send or post must never repeat silently.

### 13.6 Triggers
Manual runs and schedules (daily, weekdays, every N hours) in v1. A scheduled run only fires while the Mac is awake; missed runs run once at wake if the flow allows "catch up". **Chair's call (owner may override)**.

### 13.7 One-time runs
A one-time flow (10.7) runs through the same lifecycle (13.1), checks, retries, approvals, risky-action list, budget and resume as a saved flow. **Owner decision (2026-11-10)** that it uses the same engine. Differences (**Chair's call (owner may override)**):
- The run starts from a chat request; there is no flow sign-off, so the `queued` state follows the short plan in chat.
- Run history tags it "one-time" and shows a "Save as flow" button on the run.
- One-time flows can't be scheduled. Saving them first makes a schedule possible.
- The plan shown in chat lists every requirement marked `sensitive`. The requirement list is frozen when the run starts. Anything the brain wants to add later needs an approval inbox item before it takes effect (10.7).

---

## 14. Marketplace

### 14.1 Scope in v1
Free flows only. **Owner decision (2026-11-10)**. The marketplace ships in phase 2, after the local core and the five example flows (section 17).

### 14.2 Anonymous browse and install
Browsing and installing public flows needs no login, both in the app and on the web. **Owner decision (2026-11-10)**. The web listing has an "Open in FlowDriven" link (custom URL scheme) that opens the install preview in the app.

### 14.3 Publisher accounts
- Publishing needs an account verified with phone number and email. **Owner decision (2026-11-10)**.
- One phone number per publisher account. Publisher handles are unique and permanent.
- New accounts can publish public flows only after the account is 7 days old. **Chair's call (owner may override)**: the research found that registries with a one-week account rule were still abused, so this is a speed bump, not a defence; scanning and runtime protections do the real work.

### 14.4 Visibility
- Private: only me; people I invite; a team or organization. Public: anyone. **Owner decision (2026-11-10)** for the options.
- For free flows, all three private levels and public ship together in the marketplace phase (phase 2). Private sharing of paid flows comes later with paid flows. **Chair's call (owner may override)**: invites and teams reuse the same accounts and access checks, so splitting them into a later phase saves little.
- Invited people and team members sign in with email to install a private flow (8.6). **Chair's call (owner may override)**.
- Private flows go through the same scan as public ones.

### 14.5 Publish pipeline

```mermaid
flowchart LR
  P["Publisher clicks Publish"] --> V["App: validate, pack,<br/>hash, upload"]
  V --> S1["Static checks:<br/>schema, size limits, text-only,<br/>hidden Unicode, secrets"]
  S1 --> S2["Consistency:<br/>steps use only declared requirements;<br/>risky tools declared"]
  S2 --> S3["Pattern rules:<br/>remote instructions, curl piped to bash,<br/>encoded blobs, exfil wording"]
  S3 --> S4["AI reviewer:<br/>reads every file for harmful intent"]
  S4 --> S5["Reputation:<br/>account age, reports, past takedowns"]
  S5 --> D{"Verdict"}
  D -->|"pass / pass with warnings"| G["Sign, publish immutable version"]
  D -->|"reject"| X["Report to publisher with reasons"]
```

- Every version is scanned. Published versions are immutable. **Owner decision (2026-11-10)** for automated scanning only; the layers are a **Chair's call (owner may override)**: no single scanner is enough (research).
- All published versions are re-scanned when the scanner rules change, and flagged versions are revoked or marked. **Chair's call (owner may override)**.
- Scanner verdicts and warnings appear on the listing and in the install preview.
- The AI reviewer runs on the marketplace's own API key and treats package text as data. It never follows instructions inside the package.

### 14.6 Install preview, reports, takedown, revocation
Install preview (before anything is installed):
- what the flow does, its steps, and the publisher (account age, verification state);
- every requirement in plain words, grouped: "will read", "will change", "will send or post (with approval)", "needs these accounts";
- risk labels per route, and the scan verdict with warnings;
- version and content hash;
- the sentence: "Scanning reduces risk. It does not prove a flow is safe."

Report button on every listing and on every installed flow. A report goes to the operator queue. Many reports from distinct users in a short window put a version into "under review" automatically. **Chair's call (owner may override)**.

Takedown and revocation:
- The operator can revoke a version or ban a publisher. The signed revocation list is fetched at app start, every 6 hours, and before each run of a marketplace flow (cached if offline, with a warning).
- A revoked version can't run. The app explains why, offers the latest safe version if there is one, and lists credentials the user should rotate if the reason calls for it.
- Publishers can appeal through `POST /appeals`.

### 14.7 Verified badge (later)
Shown on publishers who pass a stronger identity check. Not in v1. **Owner decision (2026-11-10)**. What "verified" requires is open (section 18).

### 14.8 Paid flows (later phase)
**Owner decision (2026-11-10)**: payments go through the marketplace. The researched route is Stripe Connect (Express connected accounts, destination charges) owned by a US company set up through Stripe Atlas, plus Stripe Tax.

Build it only after these preconditions hold:
1. Stripe confirms it will pay sellers in countries outside its self-serve Express payout list (the US, UK, EEA, Canada and Switzerland), for example through Global Payouts. Indonesia is one example of a seller country not on that list. The research found this unconfirmed, and two sources contradict each other.
2. Stripe accepts an AI-flow marketplace (marketplaces are a restricted category that needs review).
3. The US entity is set up.
4. Tax advice confirms the picture. The platform is likely the seller of record for tax (EU VAT under the platform rules, UK VAT, US marketplace-facilitator rules, and other countries' digital-services tax rules).

Known facts: merchants of record (Polar, Paddle, Creem, Dodo and others) forbid marketplace models in their terms, so they don't fit. Sellers need provider-hosted KYC (identity, bank details) before payouts; phone and email verification is not enough. None of this is legal or tax advice.

When paid flows exist (**Owner decision (2026-11-10)**):
- platform cut 0% at first, 15% later; processing fees separate;
- buyers pay with only an email and get a license key by email;
- the app checks the license key before running a paid flow (the owner accepts this can be bypassed in open-source code);
- paid flows also sell value-add: updates, support, the official version.

### 14.9 Discoverability (LLM and search)
**Owner decision (2026-11-10)**: the product must be easy for LLMs and RAG systems to find. The measures below are a **Chair's call (owner may override)**: they make the same facts appear in the same words wherever a crawler or retriever looks.

Phasing (**Chair's call (owner may override)**: the words a crawler sees on the repository, README, SDK package and docs cost little to fix early, while catalog and listing pages need the marketplace): phase 1 ships the approved one-line description (identical on the repository, the README and the SDK package) and the docs site with `llms.txt` and `llms-full.txt`. Phase 2 ships the server-rendered catalog and listing pages (section 17).

- **Name**: FlowDriven. **Owner decision (2026-11-10)**. Evidence from the chair's check on 2026-11-10 (GitHub, npm, PyPI, domain registries and a web search): no product with that name was found in the AI-agent or workflow space, so an LLM is unlikely to confuse it with another product. Trademarks were not checked (18.2). **Chair's call (owner may override)**: the name is written as one word everywhere, and because it carries no category keyword such as "agent" or "workflow", it always appears with the approved one-line description (below), which carries those keywords.
- **llms.txt** (phase 1): the docs site serves `/llms.txt` (a short Markdown index of what FlowDriven is and links to the key docs) and `/llms-full.txt` (the full docs as one Markdown file).
- **One description everywhere** (phase 1): one approved one-line description, used word for word on the GitHub repo description, the README, the SDK package description and the docs home page. From phase 2 it is used on the marketplace site and listing pages too. Draft wording (**Chair's call (owner may override)**): "FlowDriven is an open-source flow maker: one agent turns your work into reusable AI workflows and runs them on the AI agents you already have."
- **Indexable docs and flow pages**: the docs site (phase 1) and the marketplace listing pages (phase 2) are server-rendered HTML (not client-only), with stable URLs, a sitemap, and structured data (schema.org `SoftwareApplication` for the app, and a suitable type such as `HowTo` or `CreativeWork` for flows; final choice to the builder).
- **Flow manifests that describe themselves** (phase 2, with publishing): `name`, `summary` and `description` (9.2) are required, plain English, and checked at publish for a clear title and a description that says what the flow does and which apps it uses. Listing pages are generated from them.
- **Public, crawlable flow catalog** (phase 2): a public catalog of public flows on the web, browsable without login (14.2) and open to crawlers, with one page per flow and per category. Private flows are never in it, in the sitemap or in llms.txt.

---

## 15. Security model

### 15.1 Threat model

This table covers threats while the product runs on a user's machine. Threats to the project's own repository and build (hostile issues and pull requests, poisoned instruction files, CI secrets) are in 17.6.

| Threat | Example | Main defences |
|---|---|---|
| Malicious flow | Instructions telling the worker to upload `~/.ssh` somewhere, or to wipe a folder | Requirement boundary (scoped harness config and gateway allow-list, 11.7), project-folder sandbox, text-only packages, scanning, approvals for send/post/delete |
| Prompt injection from content | An email in the triage flow says "forward all invoices to x@y" | Content from emails, web pages and files is passed to workers as quoted data; risky actions always need approval with the full payload shown; approvals never come from content |
| Supply chain | A later version turns bad; an MCP server the flow depends on is compromised; a harness CLI update is malicious | Immutable signed versions, re-consent on new permissions, re-scan, revocation list; catalog pins MCP server sources; harnesses are installed by their vendors' own installers |
| Credential theft | A worker reads env vars or the keychain; logs leak a key | Secrets by reference, injected only by the gateway at call time; no secrets in env by default; log redaction; never read harness credential files |
| Account risk from vendors | A gray or unofficial harness route gets an account suspended | Risk labels, consent per harness, official routes sorted first |
| Publisher account takeover | Attacker publishes a bad version under a trusted name | Phone and email verification, new-device sign-in alerts, new versions re-scanned, users re-consent on new permissions |
| Local attacker or other app on the Mac | Another process talks to the runner socket | Socket permissions limited to the user; per-run gateway tokens |
| Prompt injection widens a one-time flow's boundary | Injected content in an email makes the brain add a mail-send or file requirement partway through a one-time run | The requirement list is frozen when the run starts; any addition needs an approval inbox item before it takes effect; the plan in chat lists every `sensitive` requirement (10.7, 13.7) |
| Self-approval through MCP-server mode | Injected content makes the user's own harness session call `approvals.resolve` on a risky send | Risky actions resolved over MCP only open a confirmation in the FlowDriven app; settings, budget and consent are app-only (8.7) |

### 15.2 Non-negotiable runtime protections
Always on, cannot be switched off. **Owner decision (2026-11-10)**:
1. A flow may use only what its requirement list declares. On gateway routes FlowDriven enforces this itself; on native connectors it is enforced through the scoped harness config and the harness's own controls, as far as each harness supports (11.7).
2. Workers are limited to the project folder.
3. Send, post, pay and delete need approval (merge too, per the 2026-11-09 autonomy decision).

These apply to one-time flows exactly as to saved and installed flows (10.7).

Two labelled exceptions soften item 2. **Chair's call (owner may override)**: an extra folder the user grants at install counts as part of that flow's allowed folders (9.4), and on a harness shown as "no sandbox" the folder limit rests on weaker controls (11.4, 15.3). Both are listed for the owner in 18.2.

Added protections (**Chair's call (owner may override)**, drawn from the research's minimum list):
4. No permission-bypass or full-access flags at all, and no setting, per flow or global, that enables them (11.4).
5. No instructions fetched from the internet at run time. Steps can't load prompts or skills from URLs; only the installed, hashed package and the user's memory.
6. Secrets by reference only (8.5).
7. A managed, separate browser profile by default (12.6).
8. Signature and revocation checks before each run of a marketplace flow.
9. An append-only audit log of risky actions, approvals, installs and permission changes.
10. A model can't approve its own risky action: in MCP-server mode, risky approvals need the user's click in the FlowDriven app (8.7).
11. Approval hooks on native connectors fail closed (11.7).

### 15.3 Honest limits of scanning
These limits go into the docs and into the install preview's short text:
- Scanners disagree and can be evaded. A harmful instruction written in plain language may not trigger any rule.
- The AI reviewer can be fooled, including by injection aimed at it.
- A flow that is allowed to send email can still send a bad email. Approval is the last line, and it only works if the user reads the payload.
- Harnesses without an OS sandbox can do more than FlowDriven can see. On a harness shown as "no sandbox", the project-folder limit rests only on the working directory, the scoped config and hooks. That is weaker than an OS sandbox, so `sensitive` flows don't route there unless the user allows it (11.4).
- On native connectors, the requirement boundary is only as strong as the harness's own config override, allowed-tools list and hooks. The gateway is stronger, but it can't sit in front of every service (Figma's remote server accepts only catalogued clients).
- Prompt injection has no complete fix today. The design limits the damage instead of claiming to prevent it.

---

## 16. First-wave example flows

**Owner decision (2026-11-10)** for the five flows, and that all five ship in phase 1. Their contents below are a **Chair's call (owner may override)**. Order of difficulty from the research (it sets the build order inside phase 1, section 17): documents and reports is the easiest to build and test (no outside accounts); email has the widest demand; social posts best show "any app" and per-platform login checks; Figma to Flutter is the strongest technical showcase, but for developers only.

### 16.1 Figma to Flutter (`build`)
- Requirements: coding harness; Figma MCP (remote or desktop), used through the harness's own native connector (11.7), with tools `get_design_context`, `get_screenshot`, `get_variable_defs`, `get_metadata` (tool names to verify); a Figma Dev or Full seat; `flutter` and `git` CLIs; the project folder.
- Phase-1 testing assumes a Figma Dev or Full seat is available. **Owner decision (2026-11-10)**.
- Steps and checks: see the manifest in 9.8 (read design → schema check; plan widgets → structure check; build screens → `flutter analyze` and `flutter test` exit 0; visual review → judge with listed mismatches; push branch → clean tree).
- Feasibility: official. Without a Dev or Full seat the call limit (20 per month) makes it unusable, so the readiness check probes the seat through Figma's identity tool. Only catalog clients can use Figma MCP, so the gateway can't proxy it and the native route is the default; whether Antigravity and OpenCode are catalogued is unclear, so the router prefers Codex or Claude Code. The output is design context turned into code by the worker, not finished code from Figma.

### 16.2 Documents and reports from local files (`light`)
- Requirements: any harness; input folder (read); output folder (read_write); the input folder and the output folder are each the run's project folder or an explicit extra-folder grant under 9.4; optional CLI tools for formats (for example a PDF or DOCX converter from the catalog).
- Steps: (1) inventory the files → `files` check (count, types); (2) extract key facts to `facts.json` → `schema` check, each fact cites its source file; (3) draft the report in Markdown from an outline the user approved at clarify → `contains` checks for every outline section and no placeholders; (4) cross-check every number in the draft against `facts.json` → `judge` check that must quote the source of each number; (5) export to the chosen format → `files` check; (6) final `user` check.
- Feasibility: official; local files only, no outside account.

### 16.3 Email triage and draft replies (`light`, sensitive)
- Requirements: harness; a mail MCP server with read and draft tools (`search`, `get_thread`, `create_draft`, `label`), `send` declared as risky; account login.
- Steps: (1) fetch unread mail since the last run → `probe`; (2) classify each thread (reply needed, FYI, spam-like, waiting) → `schema` check, every thread classified; (3) draft replies in the user's voice from memory → `contains` (no placeholders) and `judge` (answers the question, polite, no promises the user didn't make); (4) create drafts, not sends → `probe` that the drafts exist; (5) optional: send approved drafts → each send held in the inbox with full text.
- Feasibility: partly checked. Gmail connectors exist for Claude; access for other harnesses (Codex, Antigravity, OpenCode) is not yet checked, and the mail provider's rules for automated access are not yet researched. Treat every email body as untrusted data (prompt injection). The default is drafts only; sending is an opt-in step.
- Phase-1 readiness work: a Gmail route for each phase-1 harness (a native connector where the harness has one, otherwise a catalogued mail MCP server through the gateway), catalog entries with `send` classed as risky, and a mailbox probe. If a harness has no Gmail route, the router keeps this flow on harnesses that do.

### 16.4 Lead follow-up (`light`, sensitive)
- Requirements: harness; a sheet or CRM MCP server (read and write on one named sheet or list); a mail MCP server with draft tools, `send` risky.
- Phase-1 readiness work: a spreadsheet route per phase-1 harness (native connector or gateway), limited to the one named sheet, with a read probe; it reuses the Gmail work from 16.3.
- Steps: (1) read new leads from the sheet → `schema` (each lead has name, contact, source); (2) score and segment each lead with reasons → `schema` plus `judge` on a sample; (3) draft a follow-up per lead → `contains` and `judge`; (4) create drafts and update a "status" column → `probe`; (5) optional send with approval.
- Feasibility: partly checked. Sheets and Gmail connectors exist; the Meta lead ads route is not checked, so v1 reads leads from a sheet the user already fills. **Chair's call (owner may override)**: a sheet is the one lead source that's checked and that every user can fill. The value is in the agent's judgment (scoring, writing), which is why `judge` checks plus the user's approval matter here.

### 16.5 One source into many social posts (`light`, sensitive)
- Requirements: harness; the source (file, URL or video); per platform, one of: YouTube upload (official), Instagram publishing (official), WordPress REST with an Application Password (official), TikTok draft upload (official), TikTok through a managed browser session (unofficial).
- Steps: (1) extract key points and hooks from the source → `schema`; (2) write a post per selected platform in the brand voice from memory → `contains` (length limits per platform) and `judge`; (3) produce media if requested (for example a short video through a generation tool the user has, such as Higgsfield, which needs a paid plan or credit) → `files`; (4) upload as draft or schedule per platform → `probe`; (5) publish → held for approval per platform (post/publish is risky); (6) later run: collect metrics for public posts (TikTok metrics cover public videos only) and save lessons to memory.
- TikTok: the default route is draft upload; the user finishes the post in the TikTok app. The browser route is offered as `unofficial` with TikTok's own terms sentence about automated scripts and the account-risk warning. **Chair's call (owner may override)**: the owner listed TikTok route details as open; this follows the owner's stance of allowing unofficial routes with warnings. The TikTok app review for the draft scope has no published timeline, so FlowDriven needs to apply early (section 18).
- Phase-1 readiness work: the draft or schedule routes per platform (YouTube, Instagram, WordPress, TikTok draft upload), each with a catalog entry, a login or token probe and post/publish classed as risky. Until the TikTok draft scope is approved, the phase-1 TikTok output is a ready-to-post file plus caption that the user uploads, and the browser route stays an opt-in `unofficial` alternative.

---

## 17. Phasing

**Owner decision (2026-11-10)**: phase 1 ships all five example flows, replacing the chair's earlier proposal to ship two first. The rest of the phase plan (contents, order inside phase 1, exit tests) is a **Chair's call (owner may override)**. Each phase ends with the stated exit test. There are no dates (17.1).

| Phase | Scope | Exit test |
|---|---|---|
| 1. Local core and all five flows | Repository groundwork (17.2 to 17.6): the local half first (rule files and local checks), the GitHub half (settings, CI checks and the release path) before the first push. Desktop app and runner; chat plus step-list builder; one-time flows with "save as flow"; SDK (format, validator, hasher); harness detection and inventory; adapters for Codex, Claude Code and Antigravity (brain and worker, scoped harness config, approval hooks where available); brain picker with fallback; budget; readiness engine with catalog; gateway; runner with checks, retries, approval inbox, history and resume; memory; notifications; the fake-harness test kit (17.1); a signed and notarized Mac build through the protected release path (17.5). Discoverability basics (14.9): the approved one-line description, identical on the repository, the README and the SDK package, and the docs site with llms.txt and llms-full.txt. Readiness work the flows need: Figma (native route), Gmail, spreadsheets, and social draft routes (YouTube, Instagram, WordPress, TikTok draft). Flows: Documents and reports; Figma to Flutter; Email triage and replies; Lead follow-up; One source into many social posts. | Every one of the five flows completes three runs end to end with every step check passing (sends and posts approved in the inbox, or drafts where a platform allows only drafts). Runs use the owner's real work where it exists and realistic test data or sandbox accounts where it does not; the test notes which runs used test data. At least ten one-time flows run from chat, and at least one is saved and reused; no fake "done" found in review of those runs; every adapter passes the fake-harness suite; stage (0)'s own done test has passed (17.5); and a signed and notarized pre-release build of the app has been produced through the protected release path, with the stage (e) checks passed (17.5). |
| 2. Marketplace (free) | Accounts with email and phone verification; publish public and all three private levels (only me, invited, team) for free flows; scan pipeline; signing; immutable versions; browse and install anonymously; install preview; report button; revocation list; public crawlable catalog and server-rendered listing pages (14.9); Sign in with ChatGPT brain backend; MCP-server mode (8.7); further harness adapters (OpenCode, Copilot CLI and others as researched). | A flow published from one Mac installs and runs on a second Mac with a fresh setup, with readiness fixing what's missing; an invited user installs a private flow after email sign-in; one flow is built and run from inside a Claude Code session in MCP-server mode, with a risky approval confirmed in the app. |
| Later | Paid flows (only once the 14.8 preconditions are met): checkout, license keys, payouts, private sharing of paid flows; verified badge; Windows and Linux; chat channels. Each item ships when the owner calls it. | Per item, for example: first external publisher paid out (or paid flows deferred again by the owner); every phase-1 flow passes on Windows and Linux. |

Build order inside phase 1, so each stage can be verified on its own before the next: (0) repository groundwork, meaning the rule files, GitHub settings and CI checks of 17.2 to 17.6, with its local half done before any product code is written and its GitHub half before the first push; (a) core engine with Documents and reports, which needs no outside account; (b) Figma to Flutter; (c) Gmail and spreadsheet readiness, then Email triage and Lead follow-up; (d) social draft routes, then One source into many social posts; (e) release, meaning the protected release path of 17.5 and a signed, notarized pre-release build made from a tag. One-time flows arrive with stage (a), because they use only the core engine. **Chair's call (owner may override)**: the order follows the research's difficulty ranking (section 16) and adds one outside dependency per stage. Stage (0) comes first because the build agents need their rules and guard rails before they write product code.

**Owner decision (2026-11-10)**: the app comes first. **Chair's call (owner may override)**: so stage (0) is split in two, and only its cheap half stands in front of the app. The local half (the instruction files, the local checks and the dependency allowlist) is done at once, because the build agents need it from their first task. The GitHub half (settings, rulesets, accounts and the release path of 17.5 and 17.6) is applied before the repository is first pushed to GitHub, and it waits on the owner's tasks in 18.2 items 6 and 7. Until that push the code lives in the local repository only, on work branches: the build agents never commit to the default branch, each task passes the local checks and a different agent's review, and nothing counts as merged. The owner's gate for all of it is the first push (17.5). Stages (a) to (d) go ahead meanwhile, and the session rules of 17.4 and 17.6 (the boundary lists, the rule of two, the pre-push check) apply from the first session. Stage (a) opens with the app's screens built on sample data, so the owner can see and correct the design before the engine behind it is finished.

### 17.1 Build approach: AI coding agents, no fixed date
**Owner decision (2026-11-10)**: FlowDriven is built entirely by AI coding agents (Claude, Codex, Antigravity) directed by the owner. There is no human team and no target date.

What this means for the build (**Chair's call (owner may override)**: AI agents work best on small, well-specified tasks with automatic feedback, and the owner has no team to catch mistakes by hand):
- **Small, independently verifiable tasks.** Each implementation plan is cut into tasks that one agent session can finish, each with its own tests and a clear "done" check, the same rule the product applies to flow steps.
- **Strong automated tests and fixtures.** Unit tests for the SDK, validator and hasher; contract tests for the runner API; recorded fixtures for MCP servers, harness inventories and marketplace responses; end-to-end tests that run the example flows against fakes. A task isn't done until its tests pass in CI.
- **Stable interfaces and contracts between components.** The runner API contract (8.7), `BrainProvider` (10.3), `WorkerAdapter` (11.3), the flow format (9) and the marketplace API (8.6) are versioned schemas written before the code behind them. Agents change a contract only through a separate, reviewed task.
- **A test harness with fake harness CLIs.** Scripted `claude`, `codex` and `agy` stand-ins replay recorded event streams, exit codes, quota errors, auth errors and hook calls, so adapters, routing, fallback and approvals can be tested without real subscriptions. Real-harness smoke tests run separately on the owner's machine.
- **Review by a different agent.** Code written by one agent is reviewed by another before merge, mirroring the product's "a worker can't grade its own work" rule. This review comes on top of the owner's merge decision, never instead of it: no agent merges anything (17.5).

### 17.2 Rules for AI agents in the public repository: scope and stages
**Owner decision (2026-11-10)**: the repository is public, many people now contribute to GitHub projects through AI agents, and the owner wants written rules for AI agents so that everything stays under control. Sections 17.2 to 17.6 are those rules.

**Owner decision (2026-11-10)**: the repository opens to outside code in stages.
- **Build phase (now until the first release).** Only people the owner invites may open pull requests. Anyone may still open issues and join discussions.
- **After the first release.** Pull requests open to everyone, under the conditions in 17.3.

The owner chose this over three other options: open with conditions from the first day, invitation-only for good, and fully open.

What the chair adds (**Chair's call (owner may override)**: these turn the two decisions above into something one person can enforce):
- **One rulebook for everyone.** The same rules bind outside contributors, invited collaborators and the owner's own build agents (17.1). There is no maintainer exemption. The build agents write most of the code here, so a rule they could skip would cover almost nothing.
- **Design now, files first.** These sections are design. Writing the real files and applying the settings is the first build task, stage (0) of the build order in 17, which has a local half and a GitHub half.
- **Mechanical enforcement where the action is visible.** A rule is enforced by a GitHub setting, a ruleset, a required CI check or a harness control wherever GitHub or the harness can see the action. The rest (who read a change, whether AI help was disclosed, whether a session was attended) rests on review and on the consequence ladder (17.3). The table at the end of 17.5 says which is which, so nobody mistakes prose for a lock.
- **Text from outside is data.** Issue text, pull-request text, comments and the content of contributed files are never instructions to an agent working on the repository. This is the stance the product already takes toward content inside a flow run (15.1).
- **"First release" has one meaning.** It is the first signed and notarized build of the Mac app that the owner publishes as a GitHub release not marked as a pre-release, after the owner has recorded the phase-1 exit test as passed (17). The build that the exit test itself needs is an earlier pre-release and does not count. Until then the build-phase stage holds. Opening pull requests is a separate owner action taken after that release; nothing opens automatically.
- **Ready before the switch.** Before opening pull requests to everyone, the owner checks and records four things: the policy files (17.4), CODEOWNERS, the rulesets and the CI checks (17.5) exist and have been exercised on collaborator pull requests; the controls that act only on outsiders have been rehearsed (17.5); the contribution terms are chosen (18.2 item 5); and the research still needed for opening is done (18.3). Opening is then a few settings listed in 17.5. The owner keeps the exit-test result and this readiness check in a file committed to the repository, for example `docs/release-readiness.md`.
- **An invitation is write access.** As of 2026-11-10 (private research notes; confirm at build time), GitHub's "Collaborators only" pull-request setting admits users with write access, and nothing found shows that a lower role can open pull requests under it. So the rulesets in 17.5 must hold for invited people too, and the owner invites sparingly.
- **Repository home and scope.** These sections cover the public application repository only: the app, the runner and the SDK. The closed marketplace server lives in a private repository, and its access rules belong to the phase-2 design. The public repository is assumed to be owned by a GitHub organization (18.2 item 7) on the Free plan. Which controls that plan really offers is an open research point (18.3); where a control was found to need a paid plan, 17.5 says so.

### 17.3 Rules for contributions
These rules apply in both stages. During the build phase they bind invited collaborators and the build agents; after the first release they bind everyone. **Chair's call (owner may override)**: most of these rules follow what several large open-source projects already publish (private research notes, 2026-11-10), chosen to fit a project that is itself built with AI. Rule 5 was seen in one project and rule 8 comes from a vendor's guidance; the chair adopted both.

1. **A named human answers for every contribution.** Every pull request has one person who has read all of it, can explain it, and answers review in their own words. "The agent wrote it" is not an answer.
2. **No autonomous agents.** Nothing reaches the repository from an agent that no named human started and answers for: no pull request, issue, comment or review reply posted on a schedule or a trigger with nobody watching. An outside contributor reads the text before it goes up. The build agents post only inside sessions the owner started, and the owner reads the result before merge (17.6). A dependency-update bot that the owner configured is not an AI agent under these rules; its pull requests pass the same gate and the same review.
3. **AI help is always disclosed.** Every commit made with AI help carries an `Assisted-by:` trailer naming the tool (a harness's own `Co-authored-by:` trailer counts), and the pull-request description says what the AI did. Disclosure brings no penalty, since the project is AI-built; it exists so reviewers know what they are reading.
4. **Agents never sign for a human.** An agent never adds `Signed-off-by` or any other statement a person makes about their right to contribute. The contribution terms themselves (a sign-off or a contributor agreement) are the owner's choice (18.2).
5. **Issue first for anything non-trivial.** A change larger than a typo or a small fix starts as an issue the owner has accepted. A pull request with no accepted issue may be closed unread. This keeps one person's review time for work the project wants. For the build agents, a task in an owner-approved implementation plan (17.1) counts as the accepted issue. Plans live in `docs/plans/` and count as approved once the owner has merged them into the default branch. When the owner accepts an outside issue, the owner rewrites it as a plan task in their own words, and the agents work from the plan, never from the issue text.
6. **AI-drafted prose is allowed when read and disclosed.** Issue and comment text drafted with AI is fine if the human has read it, cut it down and says so. The chair did not copy the outright ban on AI prose that some projects use, because this project's own documents are AI-drafted.
7. **Security reports go one way.** A suspected vulnerability goes only through private vulnerability reporting (17.5). The reporter reproduces it, writes the report, and says so if an AI tool found it. An agent never files one.
8. **One review bar.** Agent-written and human-written changes pass the same checks and the same review. Being AI-made neither lowers nor raises the bar.

**When a rule is broken.** One written ladder, the same for everyone: (1) the pull request or issue is closed with a standard reply that links the rule; (2) on a repeat it is labelled and the thread is locked; (3) on a further repeat, or on clear abuse, the account is blocked from the repository and, where GitHub's own rules are broken, reported. There is no public list of offenders. **Chair's call (owner may override)**: a calm ladder costs the owner less time than arguing, and it avoids the public shaming some projects use.

**Extra limits once pull requests are open to everyone.** **Chair's call (owner may override)**: the research found no published measurements of how well these limits work, so they start conservative and the owner tunes them.
- A cap on open pull requests per person without write access, starting at 2. GitHub offers such a cap as of 2026-11-10 (private research notes; confirm at build time, including whether drafts count and whether the Free plan has it). If the plan turns out not to offer the cap, the fallback is to close over-cap pull requests by hand under this rule and to lean on interaction limits; in a flood the owner can return to "Collaborators only".
- Interaction limits kept ready: when a flood starts, the owner can restrict activity to prior contributors or collaborators for a fixed period.
- A vouch list (a new contributor is vouched for before their pull requests are accepted) only if volume later demands it. The tooling seen for this is experimental.

### 17.4 Instruction files: one source for every agent
Each coding agent reads a different file. If the rules live in several files they drift apart, and some agent follows the stale copy. **Chair's call (owner may override)** for all of 17.4: one root file holds every shared rule, because all three build harnesses were found to read it or can be pointed at it (private research notes, 2026-11-10; confirm at build time). The lists and file choices below follow from that and from the incidents behind 17.6.

**Layout.**
- **Root `AGENTS.md` is the single source.** It holds every shared rule, stays under about 150 lines, and links to longer detail in `docs/`. Codex and Antigravity were found to read it directly.
- **Root `CLAUDE.md` is one line, `@AGENTS.md`, plus notes that apply only to Claude Code.** Claude Code was found to read `AGENTS.md` on its own only when no `CLAUDE.md` exists, so a `CLAUDE.md` without the import would hide the shared rules.
- **No `GEMINI.md`, Copilot instruction file or other single-tool file for shared rules.** One is added only when a tool the project uses is shown not to read `AGENTS.md`. For Antigravity a `GEMINI.md` next to `AGENTS.md` would be worse than none: which of the two wins was not defined.
- **Nested `AGENTS.md` files only add detail for their folder.** They never carry a hard rule alone: Antigravity was found not to load files in subfolders and to cut off a file larger than 24,000 bytes. Every hard rule therefore sits in the root file, near the top.

**What the root file contains.** Six areas: exact commands (build, test, lint, typecheck), testing, project structure, code style, git workflow, and boundaries. The boundaries come in three tiers: "Always do", "Ask first" and "Never do". Vague guidance is the usual reason such files fail, so each line names a command, a path or a concrete action.

**The two boundary lists.** These fill the "Ask first" and "Never do" tiers of the root file, in both stages. "A human" here means the person running the agent's session, who answers for the result (17.3 rule 1). Approval on GitHub is a different thing and stays with the owner (17.5).

*Ask first.* An agent stops and gets that person's explicit yes before it does any of these, and the pull request says that it asked:
- edit CI workflows, CI check tooling, or release, signing, packaging or update configuration;
- add or upgrade a dependency (this comes on top of the dependency gate in 17.5);
- weaken, skip or delete a test or a security lint rule;
- edit an instruction file, an agent or MCP configuration, an agent skill used for the build, or CODEOWNERS;
- read or change a secrets or credential file;
- change the runner, approvals, sandbox limits, or the flow hashing and signature-verification code.

*Never, with no override.* An agent never does any of these, whoever says yes:
- push to the default branch, mark its own pull request ready, approve a pull request, or merge;
- create a tag; create, edit or delete a release or its files; hold or use a signing, notarization or release secret;
- run with a permission-bypass or full-access flag of any harness, the line the product draws for flows (6.3, 11.4 and 15.2 item 4);
- combine all three of: outside text; a credential or private data; and a no-ask mode, meaning one that edits files, runs commands, changes state on an outside service (through MCP tools, for example) or sends data out without asking first. This is the rule of two (17.6) applied to a session: one that reads outside text either holds no credential and no private data, or asks before every such action;
- sign off on, or agree to, contribution terms for a person (17.3 rule 4).

Three terms in that rule need a meaning. Outside text is anything written by someone other than the owner or the owner's own sessions: issues, pull-request descriptions and comments from others, web pages, output of outside services, code on a branch not pushed by the owner or the machine account, and anything a session wrote after reading outside text, until the owner has read it. The owner's own review comments and plan tasks are not outside text, and dependencies read in ordinary build work do not count. A credential is any token that works against GitHub or another service, other than the harness's own model sign-in. Private data is any file from outside the public tree that is present in the checkout. Which modes of each harness count as no-ask modes is listed once the research in 18.3 is done. The "Always do" tier carries the routine rules, among them: work on a branch, open every pull request as a draft, and run the gates before reporting a task done.

**Instruction files are treated as executable.** A poisoned rules file steers every agent that reads it, and hidden Unicode characters have been shown to carry instructions a human reviewer cannot see. So instruction files, agent and MCP configurations and agent skills sit under CODEOWNERS, and the hidden-character scan of 17.5, which covers every text file, covers them too. A harness loads these files when it starts, before any review, which is why 17.6 says where a reviewing agent may run. This treatment is the chair's inference from published demonstrations and incidents, not a rule found in any vendor's documentation.

**Advice is not enforcement.** An instruction file is context that an agent may fail to follow. Where a harness offers a hard control, the repository ships that too: for Claude Code, pre-tool hooks and permission deny rules covering the "Never" list. Equivalent controls for Codex and Antigravity are not yet confirmed (18.3). GitHub enforces only what shows up in a pull request (17.5). On the preferred route with the preferred isolation tier, the narrow token and the isolation of 17.6 take away the actions GitHub can see: a push to the default branch, a tag, an unapproved merge, access to secrets. On the fallback route or at the minimum tier none of these is taken away for certain. Nowhere do they take away marking a pull request ready, merging after approval, creating or deleting a release, bypass flags or the rule of two. So a harness with no hard control of its own for the "Never" list runs unattended only inside a sandbox that gives it no network path to GitHub, with the push and the pull request done in a separate, watched step. Otherwise it is used only in sessions the owner is watching.

**Files for people.** `CONTRIBUTING.md` (the rules of 17.3 in plain words, with the current stage stated at the top), `SECURITY.md` (how to report privately), a pull-request template with the disclosure checklist, issue forms, and `CODE_OF_CONDUCT.md`. They link to `AGENTS.md` for the agent rules and do not repeat them.

### 17.5 GitHub enforcement
Setting names and availability below are as of 2026-11-10 (private research notes). GitHub renames and moves settings often, so the builder confirms each one at build time and records what was applied. The first three rows of the first table carry out the owner's decision in 17.2. Everything else is a **Chair's call (owner may override)**: it is the smallest set that enforces mechanically what GitHub can see. The table at the end of this section shows what still rests on review.

**Who can open what.**

| Control | Build phase | After the first release |
|---|---|---|
| Pull requests (Settings > General > Features > Pull requests) | "Collaborators only" | Open to everyone |
| Issues | Open to everyone | Open to everyone; restricting creation to collaborators stays available as an emergency brake |
| Discussions | Open to everyone | Open to everyone |
| Cap on open pull requests for users without write access | Not needed | On, starting at 2 (17.3) |
| Interaction limits (Settings > Moderation options > Interaction limits) | Ready | Ready |
| Private vulnerability reporting | On | On |

**Default-branch ruleset.** One ruleset on the default branch, in force for everyone with write access:
- require a pull request before merging, so nobody pushes to the default branch directly;
- require the status checks listed below, each pinned to GitHub Actions as its source, so that a status posted through the API by a write-access account does not satisfy it (general knowledge; confirm at build time);
- require review from code owners, dismiss stale approvals when new commits arrive, and require approval from someone other than the last pusher;
- block force pushes and restrict deletions;
- require signed commits, if the build agents can sign without holding a human's key (left to the builder).

The bypass list of this ruleset is empty, the owner included. Changing a ruleset is the owner's admin act and leaves an audit-log entry. Two-factor sign-in is required for everyone in the organization, outside collaborators included. (All three: general knowledge; confirm at build time.)

Rulesets were found to be available on public repositories on the Free plan. Push rulesets, which block by file path at push time, were found only on a paid plan and only for private and internal repositories, so the design does not use them; the code-owner rule does that job at merge time. One ruleset option needs a look at build time: "Require an additional approval for unattributed Copilot pull requests" was on by default and in public preview, and it may block merges in a repository with one reviewer.

**CODEOWNERS.** The owner is the default code owner for every path (`*`), so on the preferred route every merge needs the owner's approval, and an approval from a collaborator or from the build agents' account cannot stand in for it. If other code owners are ever added for ordinary paths, the security core stays with the owner alone:
- `.github/workflows/**`, `.github/actions/**`, the dependency-update bot's configuration and `CODEOWNERS` itself;
- instruction files, agent and MCP configurations and agent skills (17.4);
- the CI check tooling: scanner scripts, lint configuration and allowlists;
- release, packaging, notarization and update configuration;
- the flow hashing and signature-verification code, and the pinned marketplace key;
- the runner, approvals and sandbox source;
- the dependency manifest, the lockfile and the package-manager configuration;
- the tests for all of the above.

The file by itself only requests a review. The ruleset option above is what makes the approval required.

**Required CI checks.** All are deterministic and none calls an AI model (17.6):
- the test suites of 17.1, which join one aggregate required job as each comes into existence, so the ruleset is edited once;
- a hidden-character scan of every text file in the diff: zero-width characters, bidirectional controls, variation selectors and Unicode tag characters. Test fixtures that need such characters are generated at test time, or sit on a short allowlist inside the security core;
- a workflow lint that catches script injection and unpinned actions;
- a dependency gate. An allowlist file in the security core holds each direct dependency's name and permitted version range. The gate compares the dependency manifest and lockfile with the base branch and fails when a direct dependency is new, or resolves outside its range, unless the allowlist in the base branch already permits it. It also fails when a lockfile entry resolves from outside the official registry, or changes its integrity hash while its version stays the same. So a new package, or a jump outside the range, takes two steps: an owner-approved pull request that changes only the allowlist, then the pull request that uses it. A bump inside the range passes the gate and gets the owner's ordinary review. The first allowlist pull request lists the starting dependencies. How transitive packages are handled is left to the builder;
- a single-purpose check: a pull request that touches a guard file contains only guard files. Guard files are the first four groups of the security core above, together with their own tests. Product source and dependency files may travel with other code, because the code-owner rule and the dependency gate cover them;
- secret scanning with push protection (general knowledge; confirm at build time). A ruleset rule that holds a merge while a secret alert is open was in public preview.

A pull request that edits a workflow or the check tooling is checked by its own edited copy, so for that pull request the checks prove nothing by themselves (general knowledge; the research did not cover a control for this on the Free plan). The owner confirms its file list by hand and reads it line by line. Where the builder can, the guard checks run from tooling taken at the base commit, which narrows the gap to edits of the workflow files themselves.

**GitHub Actions.**
- Workflows on pull requests from forks wait for approval: "Require approval for all external contributors". The first-time-only options are not used, because one accepted typo fix would lift them.
- The default `GITHUB_TOKEN` permission is the restricted one (read access to contents and packages), set at the organization level because organization repositories inherit it. "Allow GitHub Actions to create and approve pull requests" stays off.
- Workflows triggered by branch pushes and pull requests declare read-only permissions and request no identity token. Only the sign-and-publish job of the release path, behind the release environment, gets more.
- No workflow uses `pull_request_target` or `workflow_run` to check out or run code from a pull request. Such runs carry the repository's privileges, and `pull_request_target` runs were found to ignore the fork-approval setting.
- Every third-party action and reusable workflow is pinned to a full commit SHA, and container images by digest. They are updated through reviewed dependency-update pull requests.
- No self-hosted runners on the public repository.
- Signing, notarization and release secrets exist only on the protected release path described next.

**The protected release path.** A write-access account can run workflows on its own branches, so a secret stored for the whole repository or organization is readable by anyone with write access, the build agents' account included. The release keys are therefore kept apart (general knowledge of GitHub; confirm at build time, including Free-plan availability):
- All signing, notarization and update-signing keys, and the credential that publishes the SDK package, live only in one GitHub environment, `release`, with the owner as its required reviewer and deployments limited to version tags (`v*`). None is stored as a repository or organization secret. The "prevent self-review" option stays off, because the owner both pushes the tag and approves the deployment. The owner tags only a commit that is already on the default branch, from GitHub's web pages or with a short-lived admin token outside any agent session, and approves right after pushing the tag. Whether making a tag in the web pages also creates a release is confirmed at build time, because the job stops when a release already exists.
- A tag ruleset restricts creating, updating and deleting every tag. A ruleset lets only its bypass actors through such a restriction, so this one has a single bypass actor: the repository-admin role, which the owner alone holds. The machine account is never an admin, so nobody but the owner can create a version tag.
- Published releases are made immutable where GitHub offers that, so a published file cannot be swapped afterwards; the sign-and-publish job creates and publishes the release in one run, and stops if a release for that tag already exists or if the tag's commit is not on the default branch. Without immutable releases anyone with write access to contents could replace a published file; the gap is then written down, and the download page states each file's SHA-256. Even with them, a write-access account can create a release on a tag that has none, or delete one, which is why the owner approves at once and why this stays on the review side of the table below.
- The pipeline is split in two. A build job with no secrets and read-only permissions installs exactly what the lockfile says and produces the artifact and its hash. A sign-and-publish job checks the hash and runs only the platform's signing and notarization tools and scripts from the security core; it installs no dependencies and uses no third-party action. A hijacked package or action then never runs next to the keys. The split protects the keys, not the content of the build: a poisoned dependency could still shape the artifact the owner signs, and that risk is carried by the dependency gate and by review.
- A third job in the same environment publishes the SDK package, under the same approval. It publishes only a package file that the build job made and whose hash it checks, installs nothing, stops under the same conditions as the sign-and-publish job, and runs only for a tag without a pre-release suffix. How approvals apply to several jobs in one environment is confirmed at build time. The SDK is versioned together with the app, so one version tag covers both; the builder may split them later.

**What GitHub was not found to offer.** No setting was found that labels or limits pull requests by whether an AI wrote them. The only origin-based control seen is the extra approval for Copilot pull requests that are not attributed to a person. So disclosure (17.3) rests on the template, the commit trailer and review. Push rulesets are not available on a free public repository (above).

**The one-reviewer problem.** On GitHub an author cannot approve their own pull request (general knowledge, not covered by the research; confirm at build time). With one human and a required approval, the owner's own pull requests could never merge. The goal is fixed: every merge to the default branch is the owner's own decision, made after CI passes and after a different agent has reviewed the change (17.1). The mechanism is left to the builder to confirm on GitHub:
- **Preferred: a machine account for the build agents.** The agents push branches and open pull requests from a separate account the owner controls. It has write access to this one repository and nothing more: no admin rights, no ruleset bypass, no other repository. Whether it is better added as an outside collaborator or as an organization member depends on which token types GitHub allows each, and is settled at build time (18.3). If it is a member, the organization's base permission is set to none, so that membership gives it nothing else. Its only credential is a narrow token kept apart from the owner's own login (17.6). Everything reaches the repository through this account's pull requests, the owner's own hand edits and fix-ups included, so the owner's account is always the reviewer and never the author or the last pusher. For the same reason the owner does not use the "Update branch" button on such a pull request. The owner reviews and merges from their own account, and every rule above applies to the agents in full. GitHub's terms were found to allow a machine account that a human is responsible for; an account registered by a bot is not allowed.
- **Fallback: no required approval.** Used only if the owner decides a machine account is impractical and writes that decision down with the applied settings. The agents then work under a narrow token of the owner's own account (17.6). The ruleset keeps the pull-request and status-check requirements but drops the approval and code-owner requirements, and merging is a manual owner action. What this gives up: GitHub cannot tell the owner from the owner's agents, so "agents never merge" rests on the harness controls of 17.4 alone; the tag restriction may not bind a token of the owner's admin account, so the release environment's approval becomes the only gate on a release, and before approving the owner checks the commits since the last tag; and anyone with write access could merge their own green pull request, so on this route the owner invites nobody with write access.

On the preferred route, and for as long as the isolation of 17.6 holds, no agent holds a credential that can approve its own work, merge work the owner has not approved, bypass a ruleset, create a tag or change repository settings. Pressing the merge button after approval remains the owner's act by rule (17.4); the approval is what GitHub enforces.

**Order of stage (0).** Stage (0) has two halves (17). The local half needs no GitHub and comes first: the instruction files, the check tooling with the dependency allowlist, and the local pre-push check. The GitHub half comes before the first push. Rules cannot guard the pull requests that create them, so it runs in this order:
1. The owner creates the repository and pushes the local history as its starting point, after the licence files have been added and the hidden-character scan and a secret scan have run over all of it. This push is the owner's gate for everything built locally. The owner then applies the tag ruleset and a light branch ruleset: pull request required, no force pushes, no deletions and, on the preferred route, one approval from someone other than the last pusher.
2. Bootstrap pull requests add what the local half could not: the workflows, CODEOWNERS and the release configuration. Workflow files arrive through the second token of 17.6, for that window only. No check guards these pull requests yet, so the owner reads each one line by line and merges it personally.
3. The owner adds the required checks and the code-owner requirement to the ruleset, and applies the remaining settings of 17.5 and 17.6.
4. The done test below is run. Its test pull requests are closed unmerged.

**Stage (0) is done when** each of these has been shown on the real repository, using the build agents' credential unless the item says otherwise. On the fallback route the items marked "preferred route" are replaced by a check that the harness controls block merge and tag commands.
- A direct push to the default branch is rejected.
- A pull request cannot merge with a failing required check, and a success status posted through the API, with a credential that can post statuses, does not satisfy one.
- A pull request cannot merge without the owner's approval, and a commit pushed after approval dismisses it (preferred route).
- A fixture with a hidden character fails the scan, a fixture with an unlisted dependency fails the gate, and a fixture workflow file kept outside `.github/workflows` fails the lint for its unpinned action.
- A pull request that mixes a guard file with another change fails the single-purpose check.
- The credential cannot change a setting, a ruleset or a secret, and cannot push a change to a workflow file. Whether it can create or delete a release is written down.
- The credential cannot create a tag; the owner can (preferred route).
- A workflow run on a branch, including a branch whose name starts with `v`, cannot read a dummy secret placed in the release environment. The test workflow is pushed with the second token or by the owner.
- The immutable-releases setting is on, or its absence is written down.
- A commit containing a sample secret in a format the scanner recognises is refused at push.
- Inside a build-agent session, and in any shell where the owner runs AI sessions, the GitHub command-line tool, SSH and the git credential helper offer no credential that reaches this organization other than the narrow token. An exception is written down.
- At the preferred isolation tier, the agents' user cannot read a file in the owner's home folder.
- The machine account can see no repository but this one (preferred route).
- Copilot's cloud agent and automatic Copilot review are off, or the gap is written down.

Stage (e) adds two checks on its pre-release: the agents' credential cannot replace a published file where immutable releases are available, and the sign-and-publish job refuses a throwaway test tag whose commit is not on the default branch.

Controls that act only on people without write access (the pull-request cap, fork approval, interaction limits) cannot be exercised in the main repository during the build phase. Before the switch the owner rehearses them personally, signed in as the machine account, in a scratch repository of the same organization where that account has no access and so should count as an outsider (confirmed at build time, 18.3). The owner checks them again in the first week after the switch. No throwaway second personal account is created for this: GitHub's terms are understood to allow a person one free account besides a machine account (general knowledge; confirm at build time). On the fallback route the rehearsal needs the help of a person the owner trusts.

**What enforces what.** Where the last column is filled, the rule is prose plus review, and the consequence ladder (17.3) is its only teeth.

| Rule | Harness control (17.4) | GitHub control | Rests on review |
|---|---|---|---|
| No push to the default branch | Deny rule | Ruleset: pull request required | |
| No merge without the owner's approval | Deny rule on merge commands | Ruleset: code-owner review (preferred route) | On the fallback route |
| No approving or marking ready by an agent | Deny rule | The agents' account cannot give the owner's approval; marking ready cannot be blocked | Marking ready |
| Guard-file changes: the first four groups of the security core, and their tests | Ask rule on those paths | Code-owner review; single-purpose check | A change to the check itself |
| Dependency changes | Ask rule on manifest files | Dependency gate; allowlist under code-owner review | Transitive packages, until the builder settles them |
| Weakened or deleted tests | None | Code-owner review | Whether a test was weakened is a judgment |
| Bypass flags; the rule of two for sessions | Harness settings and hooks, where offered; the separate environment for the agents (17.6) | None: GitHub cannot see how a session ran | Yes |
| Secrets and credential files | Deny rule; separate environment for the agents (17.6) | Push protection; release environment | |
| Tags and releases | Deny rule | Tag ruleset; release environment; immutable releases where available | Creating a release on a tag that has none, or deleting one; edits to a published release where immutable releases are unavailable |
| Named human, disclosure, no autonomous agents, issue first, prose, security reports (17.3) | None | Templates and the pull-request cap only nudge | Yes |

### 17.6 Security of the repository itself
Section 15 covers threats while a flow runs on a user's Mac. This section covers a different target: the project's own repository and build, where the workers are coding agents and the hostile content arrives as issues, pull requests and files. **Chair's call (owner may override)**: the controls follow incidents and demonstrations published in 2025 and 2026 (private research notes, 2026-11-10).

| Threat | Example | Main defences |
|---|---|---|
| Injection through issues and pull requests | An issue hides text telling a coding agent to print secrets or add a backdoor | Outside text is data (17.2); no AI agent in CI (below); the "Never" rules on bypass flags and on the rule of two for sessions (17.4); agents work from the owner's plan, not from issue text (17.3 rule 5) |
| Poisoned instruction file | A pull request adds invisible characters to `AGENTS.md` that every agent then obeys | CODEOWNERS on instruction files and agent configuration; the hidden-character scan on every text file (17.4, 17.5); a reviewing agent does not load the branch's rules (below) |
| Flood of low-quality AI pull requests | Dozens of plausible but wrong pull requests exhaust the one reviewer | Staged opening (17.2); issue first, the pull-request cap, interaction limits and the ladder (17.3) |
| Invented or hijacked dependency | An agent adds a package name a model made up and an attacker has since registered | No dependency change without a human; the dependency gate with its allowlist (17.5) |
| Secret leak through CI | A workflow on a fork's pull request, or on a write-access account's branch, reads a signing key | Restricted token, fork approval, no privileged triggers on untrusted code, keys only in the release environment (17.5) |
| Self-merge | An agent approves or merges its own change | On the preferred route, for as long as the isolation below holds, the owner's approval is required on every path and the agents' account cannot give it; the fallback route gives this up (17.5) |
| Signing keys exposed to dependency code | A hijacked package or action runs in the job that holds the signing keys | Build without secrets, then sign in a separate job that installs nothing; tags restricted to the owner (17.5). The split protects the keys, not the content of the build, which rests on the dependency gate and review |
| Leak by pushing a branch | An agent pushes a secret or private notes to a branch, which is public at once | Push protection; private notes kept out of the repository folder or blocked by a pre-push check (below) |
| Stolen owner credential | A steered agent uses the owner's own GitHub login found on the build machine | The build agents run apart from the owner's login and hold one narrow token; at the minimum tier this protection is only partial (below) |

**No AI agent in CI in v1.** The repository's CI runs deterministic checks only. No workflow hands issue or pull-request text to an AI model, and no AI review or triage bot is installed on the repository. Several of the published incidents came from exactly that setup: an AI workflow that read untrusted text while holding a token. The cross-agent review of 17.1 runs in the owner's own sessions, not as a bot. GitHub's built-in AI features stay off as well, where GitHub lets them be switched off: the ruleset rule that requests a Copilot code review automatically is not used, and nobody starts Copilot's cloud agent on an outside issue (confirm at build time). If the owner later wants an AI step in CI, it follows the rule of two: one job never combines all three of (a) untrusted input, (b) secrets or private reach, and (c) the power to change state or send data out. Whatever the AI proposes is applied by a separate job that a human approves.

**Rules for the owner's build agents.** These are 17.3 and 17.4 applied to the agents that write this project:
- They work on a branch and open every pull request as a draft; the owner marks it ready after reading it. They never push to the default branch, never mark their own pull request ready, never approve and never merge (17.4).
- They hold no signing, notarization or release secret, create no tag, and do not touch a release or its files. The owner cuts releases through the protected release path (17.5).
- They never run with a permission-bypass or full-access flag, and no session combines outside text, a credential or private data, and a no-ask mode (17.4). Issue text is treated as hostile. An agent is given it raw, so content hidden in HTML comments is seen and handled as data like the rest.
- They add or upgrade a dependency only after the owner's yes and through the dependency gate of 17.5. Before proposing a package they check that it exists and is the intended one.
- A reviewing agent does not load the rules of the branch it reviews. It reads a pull request as a diff from a checkout of the default branch, or inside a throwaway sandbox with no credentials and no network beyond the harness's own model provider. No harness is started inside a checkout of a branch that changes instruction files, hooks or agent configuration until the owner has read that change.
- Their work passes the same CI and the same code-owner review as anyone's.

**Where the build agents run.** **Chair's call (owner may override)**: the limits in 17.5 hold only if a steered agent cannot pick up a stronger credential lying nearby, so the design keeps the agents apart from the owner's login, at the cost of some setup. Every session that can push to the repository counts as a build-agent session, planning and review sessions included.
- **One narrow credential.** The agents hold a single fine-grained token limited to this repository, with write access to contents and pull requests and no access to administration, workflows, secrets or environments (token scopes are general knowledge; confirm at build time). If GitHub does not offer such a token for the machine account's kind of access, a GitHub App installed on this one repository with the same permissions takes its place. On the preferred route the credential belongs to the machine account; on the fallback route, to the owner's account. It has an expiry date and is rotated; a GitHub App's key, which does not expire, is rotated on a schedule. The machine account's password and second factor stay with the owner, outside the agents' environment. When a task must change workflow files, which is an "Ask first" item (17.4), the owner issues a second token that allows it, for that task only: it is used in a session that reads no outside text, expires within a day and is revoked after use. While it exists, a workflow pushed to a branch runs before any review, which is why the window is kept that short.
- **Kept apart from the owner's login.** Preferred: the build agents run under a separate macOS user account, a container or a virtual machine (the builder picks), which holds that token and nothing of the owner's. That user is not an administrator of the machine and cannot read the owner's home folder. Minimum, if the owner finds that too heavy: on the build machine the owner's own GitHub account is signed in only in the browser, never in command-line tools, so the narrow token is the only GitHub credential that command-line tools offer. The minimum does not stop a steered agent: a program running as the same user may reach the owner's browser session and through it act as the owner, approvals and tags included (general knowledge; reach varies). Under it the limits of 17.5 do not hold against a steered agent, so it is acceptable only while the owner watches every session. At either tier, no AI session of any project runs under a command-line login that can reach this organization.
- **Admin work is the owner's.** Settings, rulesets, secrets and environments are changed by the owner in GitHub's web pages, or by a script the builder prepares and the owner runs with a short-lived admin token that the owner creates and revokes. No agent session holds an admin credential.
- **A push is a publication.** Anything pushed to any branch of a public repository is public at once, before review. Push protection is on (17.5). Private research notes and agent working files are kept outside the repository folder where practical. Where they sit inside it they are git-ignored, and a local pre-push check refuses to push them.

**Dependencies.** One study of 2024-era models found that at least 5.2% of the package names suggested by commercial models and 21.7% of those suggested by open-source models did not exist. When a prompt that had produced an invented name was run ten more times, 43% of those names came back every time and 39% never did, so an attacker can register the repeatable ones in advance. Newer models may differ; the rule does not depend on the number. Package-manager protections (clean lockfile installs, a minimum release age, install scripts off) are worth using but were not confirmed for this stack (18.3).

**Signing and release keys.** The keys that sign the app, notarize it and sign its updates are this repository's most valuable secrets. They are never in the repository, never in a pull-request or branch job, and never anywhere a build agent can read: they exist only in the release environment of 17.5. The key that signs marketplace flows belongs to the closed server and never enters this repository; the app holds only the public half (9.6).

---

## 18. Risks, open items and what is left to the builder

### 18.1 Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Vendors tighten rules on CLI wrapping (for example `--bare` becoming the default for `claude -p`) | The brain or a worker route stops working | Several backends; official routes first; API-key fallback within budget |
| Users' vendor accounts suspended on unofficial routes | User harm, reputation | Labels, consent, official routes first |
| Malicious flow slips past automated scanning | Data loss or theft | Runtime protections, revocation, honest warnings |
| Prompt injection through emails, web pages, files | Unwanted actions | Approvals with full payloads; content as data; drafts by default |
| Figma, TikTok or other platforms change limits or terms | Example flows break | Readiness probes surface it; flows declare routes with alternatives |
| Thin evidence that buyers will pay for flows | The marketplace business may not pay | v1 is free; measure installs and runs first |
| Name collision | Discoverability, trademark | As of 2026-11-10 no product named FlowDriven was found in the AI-agent or workflow space. `flowdriven.com`, `flowdriven.dev` and the GitHub account `flowdriven` belong to others. A similarly named company, FlowDrive (business process automation), exists. Trademark search before release (18.2) |
| Codex brain and Codex workers share one plan allowance | Brain eats worker quota | Tool-free, sparing brain calls; usage shown per harness |
| Native connectors bypass the boundary through a harness bug or missing control | A flow calls an undeclared or risky tool | Scoped config per run; hooks fail closed; risky tools left off allow-lists; sensitive flows prefer gateway or hooked routes; enforcement shown honestly (11.7) |
| Phase 1 is large: five flows, three adapters, Gmail, spreadsheets and social routes | Phase 1 drags on with no date to force cuts | Staged build order (stage 0, then a to e) inside phase 1, each stage verified alone; flows share one engine; outside dependencies added one at a time (17) |
| AI-built code drifts or breaks silently | Regressions, inconsistent components | Small verifiable tasks, contracts first, fake-harness test kit, CI gates, cross-agent review (17.1) |
| A harness changes its CLI, config or hook format | Adapters or scoped configs stop working | Adapter capability flags; fake-harness fixtures re-recorded per harness release; readiness shows the harness as `failed` instead of guessing |
| Self-approval in MCP-server mode | A model approves its own risky action | Risky approvals need a click in the app (8.7) |
| Hostile text in an issue or pull request steers a coding agent | Leaked secrets or a planted backdoor | Outside text is data; no AI agent in CI; the rule of two for agent sessions (17.2, 17.4, 17.6) |
| A flood of low-quality AI pull requests once pull requests open | The one reviewer is swamped and real work waits | Staged opening, issue first, pull-request cap, interaction limits, the consequence ladder (17.2, 17.3) |
| A poisoned instruction file or agent configuration | Every agent that reads it is steered | CODEOWNERS, the hidden-character scan, hard rules in settings rather than prose (17.4, 17.5) |
| An agent adds an invented or hijacked dependency | Malicious code ships in the app | No dependency change without a human; the dependency gate with its allowlist (17.5, 17.6) |
| The owner is the only human reviewer | Review becomes the bottleneck, or approval turns into a rubber stamp | Small tasks, required CI and cross-agent review before the owner looks; opening waits for the first release; the pull-request cap (17.1, 17.2, 17.3) |
| GitHub's settings or plan limits differ from the research | A planned control is missing or works differently | Every control is confirmed at build time; fallbacks are named in 17.3 and 17.5; open points are listed in 18.3 |

### 18.2 Open items for the owner
1. Before release: a trademark search for "FlowDriven"; register the domain (planned: `flowdriven.ai`); approve the wording of the one-line description (14.9).
2. Paid flows: confirm with Stripe sales that sellers in countries outside the self-serve Express list (Indonesia is one example) can be paid, and that an AI-flow marketplace is acceptable; set up the US entity; get tax advice.
3. What a "verified" publisher must prove for the badge.
4. Confirm or override the chair's calls, especially:
   - native connectors with per-run scoped configs (11.7);
   - how one-time flows skip the flow sign-off (10.7);
   - the frozen requirement list for one-time flows: the plan lists every `sensitive` requirement, and anything added later needs an approval inbox item (10.7, 13.7);
   - MCP-server mode in phase 2 with app-only risky approvals (8.7);
   - all three private levels for free flows in phase 2 (14.4);
   - email sign-in for invitees of private flows, and for installing any private flow (8.6, 14.4);
   - the phase-1 adapter choice: Codex, Claude Code and Antigravity (10.3, 11.1). Antigravity is included although its vendor prohibits wrapping on consumer plans, under the owner's "run every detected harness, with warnings" decision (6.1, 11.5);
   - the discoverability measures and their split: description and docs site with llms.txt in phase 1, catalog and listing pages in phase 2 (14.9, 17);
   - the lighter phase-1 exit test: three runs per flow with every step check passing, real work where it exists and test data or sandbox accounts where it does not, no fixed duration (17);
   - no permission-bypass opt-in at all, per flow or global (11.4, 15.2);
   - the extra-folder grant (9.4) and the "no sandbox" rule for harnesses that cannot be limited to the project folder (11.4, 15.3), which are the two exceptions to the project-folder limit;
   - editor additions: risky approvals requested over MCP only open a confirmation in the app (8.7); approval hooks on native connectors fail closed (11.7); one-time flows cannot be scheduled or published until saved (10.7, 13.7); until a TikTok draft-upload scope is approved, the phase-1 TikTok output is a file plus caption the user uploads (16.5); the phase-1 build order, stages (0) to (e) (17);
   - the planned domain `flowdriven.ai` (8.6), the lowercase `flowdriven` spelling in identifiers, and the draft one-line description that always accompanies the name (14.9);
   - the rules for AI agents in the repository (17.2 to 17.6), especially: what "first release" means, and that opening pull requests is a separate owner action after it (17.2); mandatory AI disclosure, AI-drafted prose allowed when read and disclosed, plan tasks standing in for issues for the build agents, and the consequence ladder with no public list (17.3); the starting pull-request cap of 2 (17.3); one root `AGENTS.md` as the single rule source, with its "Ask first" and "Never" lists, including the rule of two for agent sessions (17.4); the owner as code owner of every path, the two-step dependency allowlist, the protected release path, and a separate machine account for the build agents with the no-approval fallback (17.5); where the build agents run and the narrow token they hold, which costs the owner some setup (17.6); and no AI agent in CI in v1 (17.6);
   - the build/light split, leads from a sheet, and the numeric defaults.

   Every other chair's call is labelled inline.
5. Before pull requests open to everyone: choose the contribution terms, either a sign-off on each commit (often called a DCO) or a contributor agreement (a CLA). The app is AGPL-3.0 and the marketplace server is closed, so which rights the project needs from contributors is a legal question this design does not answer. Under a sign-off scheme the sign-off is added by the named human, never by an agent (17.3 rule 4), so for the build agents' work the owner would add it personally (how is confirmed at build time). A contributor agreement avoids that conflict.
6. Before the GitHub half of stage (0), which means before the first push: decide who, if anyone, is invited during the build phase, knowing that an invitation is write access (17.2).
7. Before the GitHub half of stage (0): create the GitHub organization (the account `flowdriven` is taken, so a variant such as `flowdriven-ai` is needed) and, on the preferred route, the machine account for the build agents (17.5); choose between that route and the fallback; choose how the build agents are kept apart from the owner's login (17.6); and apply the admin settings of 17.5 and 17.6 personally, keeping a record of what was applied. In the order given in 17.5, steps 1 and 3 are the owner's, and the owner attends steps 2 and 4. These accounts and admin actions are the owner's: no agent registers an account or holds an admin credential.
8. Before stage (e) of phase 1: create the Apple developer account needed to sign and notarize the Mac app and the package-registry account for the SDK, and place their keys in the release environment personally (17.5). Apple enrolment can take days, so it is best started early.

Resolved on 2026-11-10 and no longer open: one-off work (one-time flows), build capacity (AI coding agents, no date), phase-1 scope (all five flows), the Figma seat for phase-1 testing, and how open the repository is to outside code (staged, 17.2). The owner approved the design as a whole on 2026-11-10, so the chair's calls in item 4 stand unless the owner overrides one.

### 18.3 Research still needed
- Gmail (and other mail providers) access for harnesses other than Claude, and automated-access rules. Needed before phase-1 stage (c).
- Spreadsheet access (for example Google Sheets) for Codex and Antigravity. Needed before phase-1 stage (c).
- Per-harness scoped-config and approval mechanisms for Codex, Claude Code and Antigravity: per-run MCP config, ignoring the user's other servers, allowed-tools lists, plugin and skill enabling, pre-tool hooks (11.7). Needed before phase-1 stage (a).
- Draft or schedule APIs for YouTube, Instagram and WordPress as used from phase-1 harnesses. Needed before phase-1 stage (d).
- Meta lead ads access.
- TikTok draft-upload app review details for FlowDriven as the client app.
- Copilot CLI, OpenCode, Grok and Cursor CLI policy labels.
- Whether Antigravity, OpenCode and Copilot CLI are in Figma's MCP client catalog.
- Higgsfield output resale terms (relevant once paid flows exist).
- The GitHub settings named in 17.5 for an organization-owned public repository: exact names, menu paths and Free-plan availability, in particular the pull-request cap, interaction limits and issue restriction; whether a role below write can open pull requests under "Collaborators only"; how required approvals behave with one human reviewer; environment protection, tag rulesets, immutable releases and push protection on the Free plan; fine-grained token scopes and which kinds of account can use them; whether the machine account counts as an external contributor in a repository it cannot access; whether Copilot's cloud agent and automatic review can be switched off; and whether the dependency-update bot can open pull requests under "Collaborators only". Needed before the GitHub half of phase-1 stage (0).
- Hard controls for the "Never" list in Codex and Antigravity, to match Claude Code's hooks and deny rules, and which modes of each harness count as no-ask modes (17.4). Needed at the start of phase 1; until it is done, the closing sentences of "Advice is not enforcement" in 17.4 apply.
- Package-manager protections for the chosen stack: clean lockfile installs, a minimum release age, install scripts off (17.6).
- Contribution policies the research did not read (Kubernetes and CNCF, Rust, Servo and others) and the OWASP guidance on agentic applications. Needed before pull requests open to everyone.

### 18.4 Left to the builder
- Exact CLI flags per harness for sandbox, allowed tools, MCP config and JSON output, verified against each harness's current docs.
- Exact inventory sources (commands and config paths) per harness.
- Quota and auth error patterns per adapter.
- The gateway transport (stdio shim versus loopback HTTP) and how each harness is pointed at it.
- The scoped-config generator per harness (file formats, flags, hook scripts) and its fail-closed behaviour.
- The fake harness CLIs and recorded fixtures (17.1), and how fixtures are refreshed when a harness releases.
- The runner API contract format (for example JSON Schema) and its MCP-server exposure (8.7).
- How the agent tells one-off from recurring requests at intake, and the default checks it picks for one-time flows (10.7).
- llms.txt and llms-full.txt generation, structured data types and sitemap for the website and catalog (14.9).
- The browser automation server to bundle for managed profiles, and profile isolation.
- The requirement catalog format, its first entries for the five example flows, and the signed catalog update channel.
- The price table for budget estimates and how it's updated.
- SMS verification provider for publisher phone checks.
- The AI reviewer prompt, model and rule set for the scanner; scan result format.
- The custom URL scheme and deep-link format for "Open in FlowDriven".
- UI layout and visual design (chat plus step list, inbox, checklist, harness cards).
- Database migrations, backup and export.
- Code signing and notarization for the Mac app, and auto-update for the app itself.
- The text of `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, the pull-request template and the issue forms (17.4).
- The CI checks of 17.5 (hidden-character scan, workflow lint, dependency gate, single-purpose check) and the tools used for them.
- The per-harness hard controls for the build agents (hooks, deny rules) and the machine-account setup (17.4, 17.5).
- The standard replies and labels for the consequence ladder (17.3).
- The isolation for build-agent sessions (separate user, container or virtual machine), the local pre-push check, and the release pipeline split into a build job and a signing job (17.5, 17.6).

---

## 19. Glossary

| Term | Meaning |
|---|---|
| Agent Skills | An open standard for skill folders built around a `SKILL.md` file, adopted by several AI vendors. |
| AGENTS.md | A plain Markdown file of instructions for coding agents, read by several harnesses. In this repository the root `AGENTS.md` is the single source of agent rules (17.4). |
| AGPL-3.0 | Open-source licence that requires sharing source code, including for network use. Used for FlowDriven's core. |
| Approval inbox | The single list of decisions waiting for the user. |
| Audit log | Append-only record of risky actions, approvals, installs and permission changes. |
| Brain | The model the agent thinks with. |
| Build agent | An AI coding agent the owner directs to write FlowDriven itself (17.1). Not a worker, which runs a user's flow. |
| Build flow | A flow whose checks are mostly automated (code, data). |
| Catalog | FlowDriven's signed list of known requirements, with detectors, installers and risky-tool classes. |
| Check | An acceptance test for a step. |
| CODEOWNERS | A GitHub file that names who must review changes to given paths. A ruleset option makes that review required (17.5). |
| Content hash | SHA-256 fingerprint of a flow version's files. |
| FDD | Flow-Driven Development: the flow is the invariant contract; spec, UI and stack are variables. |
| Gateway | FlowDriven's local MCP server and proxy: serves FlowDriven's own tools, enforces the requirement list on the calls it carries, and holds risky calls. |
| Gray | Risk label: vendor text is unclear or contradicts itself. |
| Guard file | A file that guards the others: any file in the first four groups of the security core (workflows and actions, the update bot's configuration, CODEOWNERS, instruction files, agent and MCP configurations, agent skills, check tooling and allowlists, release configuration) or a test of one. A pull request that changes one contains only guard files (17.5). |
| Harness | An installed AI agent program such as Claude Code or Codex. |
| KYC | Identity checks on sellers before payouts. |
| Launch agent | A macOS mechanism that runs a background program for the logged-in user. |
| Light flow | A flow whose success criteria are agreed up front and that ends with the user's approval. |
| llms.txt | A Markdown file at a website's root that tells LLMs what the site is and where the key docs are; `llms-full.txt` holds the full docs. |
| Machine account | A separate GitHub account used by automation, with a human who is responsible for it. Proposed for the build agents (17.5). |
| MCP | Model Context Protocol: the standard way an agent uses tools and data from other programs. |
| MCP-server mode | FlowDriven running as an MCP server inside the user's own harness session (phase 2). |
| Native connector | A connector, plugin or skill already installed in a harness and used through it. |
| One-time flow | An unsaved flow run right away from a one-off chat request, which can be saved afterwards. |
| Merchant of record | A company that legally sells on your behalf and handles tax. The ones researched forbid marketplaces. |
| MIT | Permissive open-source licence. Used for the SDK and flow format. |
| Official | Risk label: allowed by vendor text, or nothing forbids it. |
| Probe | A short real check that something works (for example one read-only tool call). |
| Readiness check | Checking every requirement of a flow; states ok, missing, needs login, failed. |
| Requirement | Something a flow needs; the list is also the permission boundary. |
| Revocation list | Signed list of flow versions and publishers the app must block. |
| Risky action | Send, post, pay or spend, delete, merge. Always needs approval. |
| Ruleset | A named set of GitHub rules for branches, such as "require a pull request" and "require status checks" (17.5). |
| Runner | FlowDriven's background process that runs flows. |
| Scoped harness config | The per-run configuration that enables only a step's declared connectors, plugins, skills and tools in a harness. |
| Security core | The repository paths that stay under the owner's own review even if other code owners are ever added: the guard files, signature checking, the runner and approvals source, dependency files, and their tests (17.5). |
| Step | One unit of work in a flow. |
| Unofficial | Risk label: vendor text forbids it, or it uses an unpublished interface. |
| Worker | A harness doing a step. |
| Worktree | A separate git working folder on its own branch, so a code flow doesn't touch the user's checkout. |
