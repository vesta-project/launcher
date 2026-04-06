# Startup & Bootstrap Process

Vesta Launcher uses a multi-stage startup process designed to minimize perceived latency, prevent Flash of Unstyled Content (FOUC), and ensure the application state is fully initialized before the user interacts with the UI.

## Process Overview

The startup flow follows these high-level steps:

1.  **Native Window Initialization (Rust)**: The window is created with a solid background and no transparency effects to avoid visual glitches during early rendering.
2.  **Static Loader (HTML/CSS)**: A high-performance CSS/SVG spinner ([startup-loader](vesta-launcher/index.html)) is displayed immediately from `index.html`.
3.  **Bootstrap Script (JS)**: The `bootstrapStartup` function in [startup-bootstrap.ts](vesta-launcher/src/utils/startup-bootstrap.ts) orchestrates the initialization.
4.  **Resource Preloading**: Critical data (config, active account, theme) is fetched in parallel.
5.  **Route Resolution**: The app determines if it should navigate to `/home` or the `/init` (onboarding) flow.
6.  **UI Handover**: The SolidJS app mounts, the splash loader is retired, and the final window effects (acrylic/mica/etc.) are applied.

---

## Detailed Stages

### 1. Backend Setup & Native Window
In `src-tauri/src/setup.rs`, the main window is initialized. Crucially, it starts with:
- `data-window-effect="none"` (Solid background).
- `data-os` attribute set on the root element to enable OS-specific CSS.

### 2. Frontend Bootstrap ([startup-bootstrap.ts](vesta-launcher/src/utils/startup-bootstrap.ts))
This utility is the "brain" of the startup process. It performs the following:

- **Theme Initialization**: Calls `initTheme()` which fetches the app configuration and applies CSS variables to `:root` to prevent FOUC.
- **Account & Config Fetching**: In parallel, it calls `get_config` and `get_active_account` via Tauri commands.
- **State Resolution**: It evaluates if the user has completed onboarding.
    - If `setup_completed` is true and a valid account exists, it targets `home`.
    - Otherwise, it targets `init` and prepares the `InitBootstrapState`.
- **Pre-initialization**: If the target is `home`, it triggers `initializeInstances()` immediately so data is ready by the time the Home page renders.

### 3. App Mounting ([index.tsx](vesta-launcher/src/index.tsx))
The entry point waits for `bootstrapStartup` to complete before rendering the `<App />` component.
- **Retiring the Loader**: Once SolidJS has finished the initial render of the app root, a `MutationObserver` detects the presence of children in `#app` and removes the `#startup-loader` from the DOM with a smooth transition.

---

## Theming & Lifecycle

### Early Theme Application
To avoid the white/black flash before the app loads, `initTheme` applies a "fallback" theme (dark background) immediately, then overrides it with the user's actual configuration as soon as `get_config` returns.

### Window Effects
Window effects (like Mica on Windows or Acrylic on macOS) are applied as soon as the user's configuration is loaded by `initTheme`. This ensures that the transition from the solid bootstrap window to the final themed application happens as early as possible.

## Key Files
- [vesta-launcher/index.html](vesta-launcher/index.html): Contains the static splash loader and initial styles.
- [src/utils/startup-bootstrap.ts](vesta-launcher/src/utils/startup-bootstrap.ts): The core logic for resolving the startup destination.
- [src/components/theming.tsx](vesta-launcher/src/components/theming.tsx): Handles early application of theme variables.
- [src-tauri/src/setup.rs](vesta-launcher/src-tauri/src/setup.rs): Native window configuration.
