<p align="center">
  <img src="assets/icon.png?v1" alt="Velo" width="200" height="200" style="border-radius: 24px;" />
</p>

<h1 align="center">Velo</h1>

<p align="center">
  <strong>Email at the speed of thought.</strong>
</p>

<p align="center">
  A blazing-fast, keyboard-first desktop email client built with Tauri, React, and Rust.<br />
  Local-first. Privacy-focused. AI-powered.
</p>

<p align="center">
  <a href="#features">Features</a>&nbsp;&nbsp;&bull;&nbsp;&nbsp;
  <a href="#installation">Installation</a>&nbsp;&nbsp;&bull;&nbsp;&nbsp;
  <a href="docs/keyboard-shortcuts.md">Shortcuts</a>&nbsp;&nbsp;&bull;&nbsp;&nbsp;
  <a href="docs/architecture.md">Architecture</a>&nbsp;&nbsp;&bull;&nbsp;&nbsp;
  <a href="docs/development.md">Development</a>&nbsp;&nbsp;&bull;&nbsp;&nbsp;
  <a href="CONTRIBUTING.md">Contributing</a>
</p>

---

<p align="center">
  <img width="1920" height="1032" alt="Screenshot 2026-02-17 223320" src="https://github.com/user-attachments/assets/dd096d15-4c1e-438c-99f9-c38b50a8a437" />
</p>

---

## Why Velo?

Most email clients are slow, bloated, or send your data to someone else's server. Velo is different:

- **Local-first** -- Your emails live in a local SQLite database. No middleman servers. Read your mail offline.
- **Keyboard-driven** -- Superhuman-inspired shortcuts let you fly through your inbox without touching the mouse.
- **AI-enhanced** -- Summarize threads, generate replies, and search your inbox in natural language -- with your choice of AI provider.
- **Native performance** -- Rust backend via Tauri v2. Small binary, low memory, instant startup.
- **Private by default** -- Remote images blocked, HTML sanitized, emails rendered in sandboxed iframes. Your data stays on your machine.

---

## Features

### Email

- Multi-account support: Gmail (API) and IMAP/SMTP (Outlook, Yahoo, iCloud, Fastmail, and more) with instant switching -- connection settings viewable and editable anytime
- Threaded conversations with collapsible messages
- Full-text search with Gmail-style operators (`from:`, `to:`, `subject:`, `has:attachment`, `label:`, etc.)
- Command palette (`/` or `Ctrl+K`) for quick actions
- Drag-and-drop labels, multi-select, pin threads, mute threads, context menus
- Split inbox with category tabs (Primary, Updates, Promotions, Social, Newsletters)
- Inline reply, contact sidebar with Gravatar

### Composer

- TipTap v3 rich text editor (bold, italic, lists, code, links, images)
- Undo send, schedule send, auto-save drafts
- Multiple signatures, reusable templates with variables
- Send-as email aliases with from-address selector
- Drag-and-drop attachments with inline preview
- Frequency-ranked contact autocomplete

### Smart Inbox

- Snooze threads with presets or custom date/time
- Filters to auto-label, archive, trash, star, or mark read
- AI + rule-based auto-categorization (Primary, Updates, Promotions, Social, Newsletters)
- One-click unsubscribe (RFC 8058) and subscription manager
- Newsletter bundling with delivery schedules
- Smart folders / saved searches with dynamic query tokens
- Quick steps -- custom action chains for batch thread processing
- Follow-up reminders when you haven't received a reply

### AI

Three providers with selectable models -- choose one or mix and match:

| Provider | Models |
|----------|--------|
| **Anthropic Claude** | Haiku 4.5, Sonnet 4, Opus 4 |
| **OpenAI** | GPT-4o Mini, GPT-4o, GPT-4.1 Nano, GPT-4.1 Mini, GPT-4.1 |
| **Google Gemini** | 2.5 Flash, 2.5 Pro |

Thread summaries, smart reply suggestions, AI compose & reply, text transform (improve/shorten/formalize), Ask My Inbox (natural language search). Pick which model to use per provider in Settings. All results cached locally.

### Calendar

- Multi-provider: Google Calendar (full read/write), CalDAV (full read/write, works with any standalone or IMAP-linked CalDAV server), and read-only ICS/webcal feed subscriptions
- Unified view merges calendars from every connected account into one month/week/day view
- Per-calendar visibility toggles and editable colors in a sidebar panel
- Create events without leaving Velo

### Phone Assistant (Telegram)

- Chat with your inbox and calendar from your phone via a Telegram bot -- summarize threads, ask about upcoming events, draft replies, and add calendar events on the go
- Reads recent threads and calendar events across every connected account
- Never sends or creates anything without your confirmation -- drafted replies and events are staged and presented with Send/Save/Cancel (or Add/Cancel) buttons in Telegram
- Runs locally alongside Velo; single allow-listed Telegram user, no third-party server in between

### UI & Design

- Glassmorphism with animated gradient background
- Dark / light / system theme with 8 accent color presets
- Flexible reading pane (right, bottom, hidden), resizable panels
- Configurable density and font scaling
- Pop-out thread windows, custom titlebar, splash screen
- System tray with taskbar badge count
- Persistent bottom status bar for sync/offline status

### Privacy & Security

- OAuth PKCE for Gmail -- no client secret, no backend servers
- Encrypted password/app-password storage for IMAP accounts (AES-256-GCM)
- Remote image blocking with per-sender allowlist
- Phishing link detection with 10 heuristic scoring rules
- SPF/DKIM/DMARC authentication display with badges and warnings
- DOMPurify + sandboxed iframe rendering
- AES-256-GCM encrypted token storage

### System Integration

- `mailto:` deep links, global compose shortcut
- Autostart (hidden in tray), single instance
- [Customizable keyboard shortcuts](docs/keyboard-shortcuts.md)

---

## Installation

Download the latest release for your platform:

**[Download Velo](https://github.com/avihaymenahem/velo/releases/latest)** -- Windows `.msi` / `.exe` &nbsp;&bull;&nbsp; macOS `.dmg` &nbsp;&bull;&nbsp; Linux `.deb` / `.AppImage`

No build tools or programming knowledge required -- just download, install, and run.

### Account setup

**Gmail:** Create OAuth credentials in [Google Cloud Console](https://console.cloud.google.com/) (enable Gmail API + Calendar API), then enter your Client ID in Velo's Settings. No client secret needed (PKCE).

**IMAP/SMTP:** Click "Add IMAP Account" in the account switcher. Enter your email and password -- Velo auto-discovers server settings for popular providers (Outlook, Yahoo, iCloud, Fastmail, etc.). For other providers, enter IMAP/SMTP server details manually. No Google Cloud project needed.

**Calendar-only (CalDAV / ICS):** In the account switcher, choose "CalDAV (Calendar Only)" to connect iCloud, Fastmail, Nextcloud, or any CalDAV server, or "Subscribe by URL (Read-only)" for a public `.ics`/webcal feed — no email account required either way.

**AI (optional):** Add an API key for [Anthropic](https://console.anthropic.com/), [OpenAI](https://platform.openai.com/), or [Google Gemini](https://aistudio.google.com/) in Settings. Then select which model to use for each provider.

**Phone assistant (optional):** Create a Telegram bot via [@BotFather](https://t.me/BotFather), then enter its token and your Telegram user ID in Settings → Assistant.

### Building from source

Build an installable package on another computer from scratch. Steps below are for
**Debian/Ubuntu-based Linux** (including Raspberry Pi OS); notes for macOS/Windows follow.

**1. System dependencies** (Tauri's WebKit/GTK stack)

```bash
sudo apt update
sudo apt install -y \
  libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev \
  pkg-config git ca-certificates
```

**2. Rust** (stable)

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source "$HOME/.cargo/env"      # or open a new terminal
```

**3. Node.js ≥ 20.19** (Vite requires it — Node 22 recommended)

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash -
sudo apt install -y nodejs
node --version                 # expect v22.x
```

**4. Clone and check out the branch**

```bash
git clone https://github.com/joshuacv/velo.git
cd velo
git checkout feat/phone-assistant
```

**5. Install deps and build**

```bash
npm ci
npm run tauri build -- --bundles deb
```

`-- --bundles deb` builds just the `.deb` and skips the AppImage bundler (which needs
`xdg-mime` plus extra downloads). Drop it to build every bundle format.

**6. Result** — the installable package lands at:

```
src-tauri/target/release/bundle/deb/Velo_<version>_<arch>.deb
```

Install it (dependencies resolve automatically):

```bash
sudo apt install ./src-tauri/target/release/bundle/deb/Velo_*.deb
```

Or run the raw binary without installing: `./src-tauri/target/release/velo`.

> **Timing:** the first build compiles the full Rust dependency tree (~10–30 min
> natively, depending on the machine); later builds are incremental and fast. Low-RAM
> machines (e.g. a 1 GB Raspberry Pi) may not have enough memory to compile — build on a
> more capable machine of the **same CPU architecture** and copy the `.deb` over, or
> cross-compile.

**Other platforms**

- **macOS:** skip step 1; install Xcode Command Line Tools (`xcode-select --install`),
  then Rust + Node as above. `npm run tauri build` produces a `.dmg`/`.app`.
- **Windows:** install Visual Studio C++ Build Tools + WebView2, Rust, and Node, then
  `npm run tauri build` for an `.msi`/`.exe`.

**Prerequisites summary:** [Node.js](https://nodejs.org/) ≥ 20.19, [Rust](https://www.rust-lang.org/tools/install), [Tauri v2 deps](https://v2.tauri.app/start/prerequisites/).

For development (hot-reload) instead of a release build, use `npm run tauri dev`. See the
[Development Guide](docs/development.md) for all commands, testing, and more.

---

## Tech Stack

| | |
|--|--|
| **Framework** | Tauri v2 (Rust) + React 19 + TypeScript |
| **Styling** | Tailwind CSS v4 |
| **State** | Zustand 5 (9 stores) |
| **Editor** | TipTap v3 |
| **Email** | Gmail API, IMAP/SMTP (via async-imap + lettre in Rust) |
| **Calendar** | Google Calendar API, CalDAV (tsdav), ICS/webcal feeds |
| **Database** | SQLite + FTS5 (35 tables) |
| **AI** | Claude, GPT, Gemini |
| **Testing** | Vitest + Testing Library |

See [Architecture](docs/architecture.md) for detailed design, data flow, and project structure.

---

## Building

```bash
npm run tauri build
```

**Windows** `.msi` / `.exe` &nbsp;&bull;&nbsp; **macOS** `.dmg` / `.app` &nbsp;&bull;&nbsp; **Linux** `.deb` / `.AppImage`

---

## License

[Apache-2.0](LICENSE)

---

<p align="center">
  Built with Rust and React.<br />
  Made by <a href="https://github.com/avihaymenahem">Avihay</a>.
</p>
