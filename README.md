<p align="center">
  <img src="vesta-launcher/public/vesta.png" alt="Vesta Launcher" width="400" />
</p>

<h3 align="center">Vesta Launcher</h3>

<p align="center">
  A modern desktop Minecraft launcher that supports multiple mod loaders including Fabric, Forge, NeoForge, and Quilt. Easily manage instances, install mods, and launch Minecraft with a clean, intuitive interface.
</p>

---


### Installation

Download the latest version from [GitHub Releases](https://github.com/vesta-project/launcher/releases).

#### You may experience issues when trying to install for the first time.

We have not signed our app packages yet.

**Windows users:** You may see `Windows protected your PC`. Click `More info` and then `Run anyway` to continue.

**macOS users:** The app is installed as `Vesta Launcher.app`.
- First try: right-click the app in Finder and choose **Open**, then **Open** again.
- If Gatekeeper still blocks it, and the app is in `/Applications`, you can remove the quarantine flag:
  ```bash
  sudo xattr -dr com.apple.quarantine "/Applications/Vesta Launcher.app"
  ```

### Community

Need help or want to chat with other users? Join our [Discord]( https://discord.com/invite/zuDNHNHk8E)

### For Developers

This repository contains the source code for Vesta Launcher, built with Tauri (Rust backend) and SolidJS (TypeScript frontend).

#### Prerequisites

- Rust toolchain (stable)
- Bun or Node.js
- Java (for some features)

#### Quick Start

```bash
bun run vesta:dev
```

See [docs/README.md](docs/README.md) for detailed development guides.

---
<p align="center">
  <sub>This project is licensed under the <a href="LICENSE">GNU General Public License v3.0</a>.</sub>
</p>
