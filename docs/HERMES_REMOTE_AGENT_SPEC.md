# Hermes Remote Agent Spec

> **Status**: Draft
> **Date**: 2026-06-27

## 1. Problem

Screenpipe has the raw context an agent needs: screenshots, OCR, audio, app/window metadata, browser context, and a local API. The missing layer is a safe way for a user to reach that agent from the devices and apps they already use.

The user story is simple:

> I am away from my laptop. I want to message my Screenpipe agent from my phone, ask what happened on my computer, and approve small actions without opening the desktop app.

The hard part is not the chat transport. The hard part is letting a remote command touch local private context and local input devices without creating a remote-control footgun.

Hermes is the proposed local agent runtime for this:

- runs inside the Screenpipe desktop process boundary
- reads Screenpipe context through explicit capabilities
- receives commands from paired mobile/WhatsApp channels
- turns natural language into structured intents
- executes only through a permissioned local action layer
- keeps an audit trail of every remote command and action

## 2. Goals

- Let users ask Screenpipe questions from mobile and WhatsApp.
- Let users approve local desktop actions remotely.
- Keep private Screenpipe data local by default.
- Make every dangerous capability explicit, revocable, and auditable.
- Support multiple command channels without coupling the agent runtime to any one vendor.
- Start with useful read-only workflows before full computer control.

## 3. Non-goals

- Do not make WhatsApp the core runtime.
- Do not depend on unofficial WhatsApp Web automation for the main product path.
- Do not allow arbitrary remote mouse/keyboard control without a local policy gate.
- Do not bypass the existing Screenpipe API, auth, privacy, or local-first principles.
- Do not require cloud sync for the first version.

## 4. Architecture

Hermes should be a local runtime with channel adapters.

```
WhatsApp / mobile app / desktop chat
        |
        v
Channel adapter
        |
        v
Hermes inbox
        |
        v
Intent planner
        |
        v
Permission and approval policy
        |
        v
Screenpipe context tools + local action tools
        |
        v
Audit log + response to channel
```

The channel receives messages. Hermes owns interpretation. The local action layer owns execution.

### 4.1 Core Modules

| Module | Responsibility |
|--------|----------------|
| `hermes-runtime` | Agent loop, conversation state, tool dispatch, model selection. |
| `hermes-channels` | Mobile, WhatsApp, desktop, and future channel adapters. |
| `hermes-permissions` | Capability grants, risk scoring, approval prompts, revocation. |
| `hermes-actions` | Local tools for app/window/query/automation actions. |
| `hermes-audit` | Append-only command/action/event log. |
| `hermes-secrets` | Channel tokens, webhook secrets, paired-device keys. |

This can start inside the app/server layer and move into crates once the interfaces settle.

## 5. Channel Strategy

### 5.1 Recommended Product Path

Start with a Screenpipe mobile companion channel and add WhatsApp as an optional adapter.

The mobile companion should be the control plane because it can support:

- secure device pairing
- push notifications
- approval prompts
- local biometric unlock
- richer attachments
- emergency revoke
- exact product UX without WhatsApp policy constraints

WhatsApp should be a convenience transport, not the only way to control Hermes.

### 5.2 WhatsApp Options

| Option | Pros | Cons | Recommendation |
|--------|------|------|----------------|
| WhatsApp Business Cloud API | Official, reliable webhooks, production-friendly. | Requires business setup/number, template rules, opt-in constraints. | Use for production WhatsApp support. |
| WhatsApp Web linked-device bridge | Best personal-account UX. | Fragile, policy risk, depends on web automation. | Avoid as core product. Prototype only if explicitly gated. |
| Mobile companion share sheet | Secure, owned UX, works for any user. | Requires building mobile app. | Primary path. |

### 5.3 Channel Interface

Channel adapters should normalize inbound messages before Hermes sees them.

```ts
type HermesMessage = {
  id: string;
  channel: "desktop" | "mobile" | "whatsapp";
  channelUserId: string;
  deviceId?: string;
  receivedAt: string;
  text: string;
  attachments: HermesAttachment[];
  trustLevel: "local" | "paired_device" | "external_webhook";
};
```

Adapters return outbound messages through the same abstraction:

```ts
type HermesReply = {
  channel: HermesMessage["channel"];
  channelUserId: string;
  text: string;
  attachments?: HermesAttachment[];
  approvalRequestId?: string;
};
```

## 6. Permission Model

Remote access should be denied by default. The user grants capabilities explicitly.

### 6.1 Capabilities

| Capability | Examples | Default |
|------------|----------|---------|
| `timeline.read` | Search OCR/audio history. | Ask |
| `screen.current.read` | Read current active screen. | Ask |
| `screenshot.share` | Send screenshot to mobile/WhatsApp. | Ask |
| `audio.transcript.read` | Search meeting/transcript text. | Ask |
| `app.open` | Open URL or app. | Ask |
| `input.keyboard` | Type text into active app. | Off |
| `input.mouse` | Click or scroll. | Off |
| `message.send` | Send WhatsApp/Slack/email messages. | Off |
| `clipboard.read` | Read clipboard. | Off |
| `clipboard.write` | Set clipboard. | Ask |
| `cloud_model.use` | Send selected context to remote model. | Ask |

Each capability should support:

- off
- ask every time
- auto-allow low-risk actions
- auto-allow in selected apps only

### 6.2 Risk Levels

| Risk | Examples | Approval |
|------|----------|----------|
| Low | Summarize last hour, list recent links, open local Screenpipe view. | Can be auto-allowed. |
| Medium | Open URL, share screenshot, draft message, copy text. | Ask unless scoped rule exists. |
| High | Send message, type into active app, click purchase/submit/send, run shell. | Always ask in MVP. |

Hermes should never execute a high-risk action from WhatsApp without an explicit approval challenge.

### 6.3 Approval Challenge

Remote approval should be bound to an action, not a chat message.

```ts
type ApprovalRequest = {
  id: string;
  createdAt: string;
  expiresAt: string;
  requestedBy: HermesMessage;
  action: ProposedAction;
  summary: string;
  risk: "low" | "medium" | "high";
  challengeCode: string;
};
```

Example:

```
Hermes: Draft found in WhatsApp Desktop:
"I'll check after lunch."

Reply APPROVE 1832 to send to John.
```

The code expires quickly and cannot approve a different action.

## 7. Action Bus

Hermes should emit structured actions. The local runtime decides whether and how to execute them.

```ts
type ProposedAction =
  | { type: "context.search"; query: string; range?: TimeRange; filters?: ContextFilters }
  | { type: "screen.current"; includeScreenshot: boolean }
  | { type: "app.open"; target: string }
  | { type: "url.open"; url: string }
  | { type: "clipboard.write"; text: string }
  | { type: "input.type"; text: string; targetApp?: string }
  | { type: "input.click"; target: UiTarget }
  | { type: "message.send"; app: string; recipient: string; body: string };
```

Execution result should be structured too:

```ts
type ActionResult = {
  actionId: string;
  status: "completed" | "denied" | "needs_approval" | "failed";
  userVisibleSummary: string;
  artifacts?: HermesAttachment[];
  error?: {
    code: string;
    message: string;
  };
};
```

This keeps WhatsApp, mobile, desktop chat, and future MCP channels on the same core path.

## 8. Desktop Interface

Hermes should live in Settings as an agent with channels and permissions.

```
Settings
  Agents
    Hermes
      Run Hermes locally                         [on/off]

      Channels
        Screenpipe mobile                        Pair device
        WhatsApp                                 Connect

      Permissions
        Read Screenpipe history                  Ask every time
        Read current screen                      Ask every time
        Share screenshots                        Ask every time
        Open apps and URLs                       Ask every time
        Type into apps                           Off
        Click or scroll                          Off
        Send messages                            Off
        Use cloud models                         Ask every time

      Allowed apps
        Chrome                                   [x]
        WhatsApp Desktop                         [ ]
        Slack                                    [ ]
        Gmail                                    [ ]
        Cursor                                   [x]

      Approvals
        Ask before every remote action           [x]
        Require local confirmation for high risk [x]

      Activity
        Recent commands
        Pending approvals
        Connected devices
        Revoke all remote access
```

The first-run setup should ask for one channel and the smallest capability set:

1. Enable Hermes locally.
2. Pair phone.
3. Allow read-only timeline search.
4. Send test command: "What was the last app I used?"
5. Show activity log entry.

Do not ask for mouse/keyboard/message-send permissions during first-run setup.

## 9. Mobile/WhatsApp UX

### 9.1 Read-only Query

```
User: what was the link I saw 20 minutes ago?

Hermes: I found 3 likely links from Chrome:
1. https://example.com/pricing
2. https://github.com/mediar-ai/screenpipe
3. https://docs.example.com/install

Reply OPEN 1 to open it on your laptop.
```

### 9.2 Remote Approval

```
User: reply to John that I'll check after lunch

Hermes: I found John's thread in WhatsApp Desktop.
Draft:
"I'll check after lunch."

Reply APPROVE 1832 to send.
```

### 9.3 Denied Capability

```
User: send it

Hermes: Message sending is disabled for remote control.
Enable Settings -> Agents -> Hermes -> Send messages to allow this.
```

## 10. Core API Surface

Hermes should depend on stable local interfaces, not UI internals.

```ts
screenpipe.agents.register({
  id: "hermes",
  name: "Hermes",
  channels: ["desktop", "mobile", "whatsapp"],
  permissions: [
    "timeline.read",
    "screen.current.read",
    "screenshot.share",
    "app.open",
    "input.keyboard",
    "input.mouse",
    "message.send",
  ],
  onMessage: async (message, ctx) => {
    return hermes.run(message, ctx);
  },
});
```

Core services Hermes needs:

```ts
screenpipe.context.search(...)
screenpipe.context.currentScreen(...)
screenpipe.context.recentApps(...)
screenpipe.permissions.request(...)
screenpipe.actions.execute(...)
screenpipe.devices.send(...)
screenpipe.audit.log(...)
screenpipe.secrets.get(...)
```

These APIs should be usable by other agents later. Hermes is the first productized agent, not a one-off integration.

## 11. Data Model

Minimal local tables/config:

```sql
CREATE TABLE hermes_channels (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT
);

CREATE TABLE hermes_permissions (
  capability TEXT PRIMARY KEY,
  mode TEXT NOT NULL,
  app_scope_json TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE hermes_approvals (
  id TEXT PRIMARY KEY,
  action_json TEXT NOT NULL,
  risk TEXT NOT NULL,
  challenge_hash TEXT NOT NULL,
  status TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE hermes_audit_log (
  id TEXT PRIMARY KEY,
  channel_id TEXT,
  event_type TEXT NOT NULL,
  event_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
```

Secrets should not live in these tables. Store WhatsApp webhook tokens, mobile device keys, and channel secrets through the existing secrets/vault layer.

## 12. Security Requirements

- All remote channels are off by default.
- Pairing requires local desktop confirmation.
- Device/channel revocation is one click.
- High-risk actions require per-action approval.
- Approval codes expire.
- Approval codes are bound to one action hash.
- Audit logs record inbound command, proposed action, approval, execution, and outbound response.
- Screenshots shared to channels are explicit artifacts and listed in the audit log.
- Cloud model use is a separate permission because context may leave the device.
- WhatsApp inbound webhooks must verify signatures before accepting messages.
- Rate-limit remote commands per channel.

## 13. MVP

### Phase 1: Local Hermes Runtime

- Register Hermes inside Screenpipe.
- Add desktop settings toggle.
- Add read-only context tools:
  - search recent OCR/audio
  - summarize recent activity
  - list recent apps/windows
  - get current active app/window
- Add audit log.

### Phase 2: Mobile Companion Channel

- Pair device with QR code.
- Send commands to local Hermes through Screenpipe-controlled relay or LAN when available.
- Push approval requests.
- Support read-only queries and opening URLs/apps.

### Phase 3: WhatsApp Business Channel

- Add optional WhatsApp Business Cloud API adapter.
- Verify webhook signatures.
- Map inbound messages to `HermesMessage`.
- Send text replies and limited artifacts.
- Keep action approval flow identical to mobile.

### Phase 4: Controlled Desktop Actions

- Add app/URL open.
- Add clipboard write.
- Add draft-only message workflows.
- Add keyboard/mouse only behind explicit app-scoped grants.

## 14. Open Questions

- Should Hermes be implemented as a pipe first, or as a core agent runtime?
- Does Screenpipe want a hosted relay for mobile pairing, or should LAN/local-first pairing ship first?
- Which existing secrets/vault APIs should hold channel credentials?
- What is the minimum cross-platform automation API we can support safely?
- Should screenshot sharing redact by default?
- Should WhatsApp support require a business number, or remain experimental until there is a personal-account-safe path?

## 15. Recommendation

Build Hermes as a local Screenpipe agent runtime with a channel abstraction. Ship the mobile companion channel first because it gives Screenpipe the right approval and security UX. Add WhatsApp through the official Business Cloud API as an optional transport once the permission model, action bus, and audit log exist.

The first shipped version should be read-only plus low-risk actions. Full remote computer control should wait until approval challenges, app scoping, and audit logs are boringly reliable.
