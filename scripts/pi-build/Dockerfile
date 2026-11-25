# Cross-build Velo for Raspberry Pi (arm64) via QEMU emulation on an x86_64 host.
# Debian Bookworm base = matches Raspberry Pi OS (Bookworm) glibc/webkit versions.
FROM --platform=linux/arm64 debian:bookworm

RUN apt-get update && apt-get install -y \
    libwebkit2gtk-4.1-dev build-essential curl wget file \
    libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev \
    pkg-config git ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Rust (stable)
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
ENV PATH="/root/.cargo/bin:${PATH}"

# Node 22 (>=20.19 required by Vite)
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
 && apt-get install -y nodejs \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /build
# Clone the fork's integration branch (DB fix + model fix + assistant).
RUN git clone https://github.com/joshuacv/velo.git . \
 && git checkout feat/phone-assistant

RUN npm ci
# Build only the .deb — the AppImage bundler needs xdg-mime + downloads extra
# tooling from GitHub, neither of which we need for a Raspberry Pi install.
RUN npm run tauri build -- --bundles deb

# Artifact lands in /build/src-tauri/target/release/bundle/deb/
