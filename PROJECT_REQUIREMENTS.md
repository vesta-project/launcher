# Vesta Launcher - Project Requirements & Development Status

**Project Type**: Minecraft Launcher (Multi-Instance Management)  
**Architecture**: Tauri 2.0 (Rust Backend) + SolidJS (Frontend)  
**Status**: In Active Development 🚧  
**Last Updated**: November 16, 2025

> **Note**: This project is in active development. Placeholder files, unused code, and incomplete implementations are intentional and represent planned future features.

---

## 📋 Master Feature Checklist

> **Legend**: ✅ Complete | 🚧 In Progress | ⏳ Planned | 🔴 Critical for MVP | 🤖 AI-Completable

### 🏗️ Foundation & Infrastructure

- [x] ✅ Tauri 2.0 + SolidJS project setup
- [x] ✅ Custom SQLite macro system (`#[derive(SqlTable)]`)
- [x] ✅ Vite + Bun build system
- [x] ✅ Workspace structure (piston-lib, piston-macros, vesta-launcher)
- [x] ✅ Custom window decorations (Windows 11 Mica, Win10 Acrylic, Win7 Blur)
- [x] ✅ CSS variable-based theme system with hue animation
- [x] ✅ SolidJS Router with lazy loading
- [x] 🚧 Structured logging system (Rework frontend handling)
- [ ] 🤖 ⏳ Comprehensive error handling patterns
- [x] ✅ Database migration system
- [ ] 🤖 ⏳ Configuration management system

### 🎨 UI Components & Framework

- [x] ✅ Button component
- [x] ✅ TextField component (input, textarea, labels, validation)
- [x] ✅ Combobox component (searchable dropdown)
- [x] ✅ Toast notification component
- [x] ✅ ToggleGroup component
- [x] ✅ Tooltip component
- [x] ✅ Context Menu component
- [x] ✅ Popover component
- [x] ✅ Custom titlebar component
- [x] ✅ Connection status indicator
- [x] 🚧 Instance card component (UI complete, needs data integration)
- [ ] 🤖 ⏳ Modal/Dialog component
- [x] 🤖 ⏳ Progress bar component
- [x] 🤖 ⏳ Loading skeleton component
- [ ] 🤖 ⏳ Tabs component
- [ ] 🤖 ⏳ Dropdown menu component
- [ ] 🤖 ⏳ Color picker component (Use solid-color)

### 🖼️ Pages & Views

- [x] ✅ Home page layout
- [x] 🚧 Init page (3-step wizard: Welcome, Login, Finished - needs backend integration)
- [x] 🚧 Settings page skeleton
- [x] 🚧 Install page skeleton (needs completion)
- [x] ✅ Invalid/404 page
- [x] ✅ Fatal error page
- [x] ✅ Built-in browser page viewer
- [ ] 🤖 ⏳ Instance details page
- [ ] 🤖 ⏳ Mod browser page
- [ ] 🤖 ⏳ Mod details page
- [ ] 🤖 ⏳ Account management page
- [ ] 🤖 ⏳ Notification center page
- [ ] 🤖 ⏳ Logs viewer page
- [ ] 🤖 ⏳ About/Help page

### 🔐 Authentication & Accounts 🔴

- [ ] ⏳ Microsoft OAuth 2.0 implementation
- [ ] 🤖 ⏳ Account database schema
- [ ] 🤖 ⏳ Token storage and encryption
- [ ] 🤖 ⏳ Token refresh mechanism
- [ ] 🤖 ⏳ Offline mode support
- [ ] 🤖 ⏳ Multi-account switching
- [ ] 🤖 ⏳ Account profile display (username, UUID, skin)
- [ ] 🤖 ⏳ Account persistence across sessions

### 🎮 Instance Management 🔴

- [x] 🚧 Instance card UI (static/demo)
- [ ] 🤖 ⏳ Instance database schema (table design)
- [ ] 🤖 ⏳ Instance repository layer (CRUD operations)
- [ ] 🤖 ⏳ Instance service layer (business logic)
- [ ] 🤖 ⏳ Create new instance wizard
- [ ] 🤖 ⏳ Instance configuration (name, version, modloader, icon)
- [ ] 🤖 ⏳ Instance settings (Java path, memory, arguments)
- [ ] 🤖 ⏳ Instance directory management
- [ ] 🤖 ⏳ Instance deletion with confirmation
- [ ] 🤖 ⏳ Instance duplication/cloning
- [ ] 🤖 ⏳ Instance import/export
- [ ] 🤖 ⏳ Dynamic instance list rendering from database

### 🚀 Game Launching 🔴

- [ ] 🤖 ⏳ Minecraft version manifest parsing (from piston-lib/game/metadata.rs)
- [ ] 🤖 ⏳ Version JSON downloading and parsing
- [ ] 🤖 ⏳ Asset downloading and verification
- [ ] 🤖 ⏳ Library downloading and native extraction
- [ ] 🤖 ⏳ Launch argument construction
- [ ] ⏳ Java detection and validation
- [ ] 🤖 ⏳ Process spawning and management
- [ ] 🤖 ⏳ Game log capture and display
- [ ] 🤖 ⏳ Crash detection and reporting
- [ ] 🤖 ⏳ Game state tracking (playing, stopped, crashed)
- [ ] 🤖 ⏳ Pre-launch hooks
- [ ] 🤖 ⏳ Post-exit hooks

### 📦 Mod Management 🔴

- [ ] 🤖 ⏳ Mod database schema
- [ ] 🤖 ⏳ Mod repository layer
- [ ] 🤖 ⏳ Mod service layer
- [ ] 🤖 ⏳ Install mod from local file (.jar)
- [ ] 🤖 ⏳ Install mod from CurseForge
- [ ] 🤖 ⏳ Install mod from Modrinth
- [ ] 🤖 ⏳ Mod dependency resolution
- [ ] 🤖 ⏳ Mod compatibility checking (game version, modloader)
- [ ] 🤖 ⏳ Mod conflict detection
- [ ] 🤖 ⏳ Enable/disable mods per instance
- [ ] 🤖 ⏳ Mod update detection
- [ ] 🤖 ⏳ Bulk mod updates
- [ ] 🤖 ⏳ Mod configuration file management
- [ ] 🤖 ⏳ Mod list UI per instance

### 🔍 Mod Discovery & Browsing

- [ ] 🤖 ⏳ CurseForge API client
- [ ] 🤖 ⏳ Modrinth API client
- [ ] 🤖 ⏳ API rate limiting and request queuing
- [ ] 🤖 ⏳ Search functionality (name, description, author)
- [ ] 🤖 ⏳ Filter by game version
- [ ] 🤖 ⏳ Filter by modloader (Forge, Fabric, Quilt, NeoForge)
- [ ] 🤖 ⏳ Filter by category
- [ ] 🤖 ⏳ Sort by relevance, downloads, updated date, name
- [ ] 🤖 ⏳ Mod detail view (description, gallery, changelog)
- [ ] 🤖 ⏳ Mod dependency visualization
- [ ] 🤖 ⏳ Featured mods section
- [ ] 🤖 ⏳ Popular mods section
- [ ] 🤖 ⏳ Recently updated mods
- [ ] 🤖 ⏳ Pagination for search results

### 💾 File Storage & Caching

- [x] 🚧 AppData directory resolution
- [ ] 🤖 ⏳ Instance directory structure (.minecraft folders)
- [ ] 🤖 ⏳ Mod storage organization
- [ ] 🤖 ⏳ Downloaded file cache (mods, assets, libraries)
- [ ] 🤖 ⏳ Cache database schema
- [ ] 🤖 ⏳ LRU cache eviction policy
- [ ] 🤖 ⏳ Cache integrity verification (checksums)
- [ ] 🤖 ⏳ Shared cache across instances
- [ ] 🤖 ⏳ Cache statistics and management UI
- [ ] 🤖 ⏳ Temporary file cleanup
- [ ] 🤖 ⏳ Backup and restore functionality

### ⚙️ Settings & Configuration

- [x] 🚧 AppConfig database table (expanded with debug_logging and notification_retention_days)
- [x] 🚧 Settings page UI skeleton
- [ ] 🤖 ⏳ Expand AppConfig table (all settings fields)
- [ ] 🤖 ⏳ User preferences persistence
- [ ] ⏳ Java installation detection
- [ ] 🤖 ⏳ Java path configuration
- [ ] 🤖 ⏳ Default directories configuration
- [ ] 🤖 ⏳ Default memory allocation settings
- [ ] 🤖 ⏳ Download parallel connection settings
- [ ] 🤖 ⏳ Theme selection and customization
- [ ] 🤖 ⏳ Language/localization settings
- [ ] 🤖 ⏳ Update preferences (auto/manual)
- [ ] 🤖 ⏳ Notification preferences

### 📥 Download Management

- [ ] 🤖 ⏳ Download queue system
- [ ] 🤖 ⏳ Parallel download manager
- [ ] 🤖 ⏳ Download progress tracking
- [ ] 🤖 ⏳ Bandwidth throttling
- [ ] 🤖 ⏳ Resume interrupted downloads
- [ ] 🤖 ⏳ Download verification (checksums, signatures)
- [ ] 🤖 ⏳ Download retry logic
- [ ] 🤖 ⏳ Download UI (progress bars, ETA)

### 🔔 Notifications

- [x] ✅ Toast notification component
- [x] 🚧 Notification database schema (SqlTable complete)
- [x] 🚧 Notification persistence (backend commands complete)
- [x] 🚧 Notification history (backend complete, UI pending)
- [x] 🚧 Notification categories (info, warning, error, success, debug)
- [x] 🚧 Progress notifications with pulsing and step tracking
- [ ] 🤖 ⏳ Notification action buttons
- [ ] ⏳ System tray notifications (Windows/Mac/Linux)
- [ ] 🤖 ⏳ Notification center UI (sidebar exists, needs backend integration)
- [ ] 🤖 ⏳ Notification preferences
- [x] 🚧 Notification retention (30 days default, cleanup on startup)

### 🔄 Update Management

- [ ] ⏳ Launcher self-update system
- [ ] 🤖 ⏳ Mod update detection
- [ ] 🤖 ⏳ Mod update notifications
- [ ] 🤖 ⏳ Bulk mod updates
- [ ] 🤖 ⏳ Minecraft version updates for instances
- [ ] 🤖 ⏳ Update changelog display
- [ ] 🤖 ⏳ Automatic vs manual update preference
- [ ] 🤖 ⏳ Update scheduling

### 🌐 Built-in Browser

- [x] ✅ Page viewer with overlay
- [x] ✅ Back navigation
- [x] ✅ Forward navigation
- [x] ✅ Refresh
- [x] ✅ Close button
- [x] ✅ Open in external browser
- [ ] 🤖 ⏳ URL display and copying
- [ ] 🤖 ⏳ Pop-out window support
- [ ] 🤖 ⏳ Browser history management
- [ ] 🤖 ⏳ Bookmarks for mod pages
- [ ] 🤖 ⏳ Download interception and handling
- [ ] 🤖 ⏳ Cookie/session management

### 🎨 Theming & Styling

- [x] ✅ CSS variable system
- [x] ✅ Hue animation for init page
- [ ] 🤖 ⏳ Dark theme preset
- [ ] 🤖 ⏳ Light theme preset
- [ ] 🤖 ⏳ Custom theme creator
- [ ] 🤖 ⏳ Color picker for themes
- [ ] 🤖 ⏳ Component hover/focus states consistency
- [ ] 🤖 ⏳ Responsive design (window resizing)
- [ ] 🤖 ⏳ Accessibility (ARIA labels, keyboard nav)
- [ ] 🤖 ⏳ Loading state designs
- [ ] 🤖 ⏳ Error state designs
- [ ] 🤖 ⏳ Empty state designs
- [ ] 🤖 ⏳ Skeleton loaders

### 🧩 Advanced Features

- [ ] 🤖 ⏳ Modpack import (CurseForge format)
- [ ] 🤖 ⏳ Modpack import (Modrinth format)
- [ ] 🤖 ⏳ Modpack export
- [ ] 🤖 ⏳ Modpack updates
- [ ] 🤖 ⏳ World backup and restore
- [ ] 🤖 ⏳ World import/export
- [ ] 🤖 ⏳ Screenshot gallery
- [ ] 🤖 ⏳ Resource pack management
- [ ] 🤖 ⏳ Shader pack support
- [ ] 🤖 ⏳ Server list integration
- [ ] ⏳ Performance monitoring (FPS, RAM usage)
- [ ] 🤖 ⏳ Custom Java arguments per instance
- [ ] 🤖 ⏳ Environment variables per instance
- [ ] 🤖 ⏳ Performance profiles (low, medium, high)

### 🧪 Testing & Quality

- [ ] 🤖 ⏳ Unit tests for services
- [ ] 🤖 ⏳ Integration tests for repositories
- [ ] ⏳ E2E tests for critical flows
- [ ] 🤖 ⏳ Test coverage reporting
- [ ] 🤖 ⏳ Performance benchmarks
- [ ] 🤖 ⏳ Memory leak testing

### 📚 Documentation

- [ ] 🤖 ⏳ User documentation/help
- [ ] 🤖 ⏳ API documentation for piston-lib
- [ ] 🤖 ⏳ Architecture decision records (ADRs)
- [ ] 🤖 ⏳ Component documentation
- [ ] 🤖 ⏳ Developer setup guide
- [ ] 🤖 ⏳ Contributing guidelines

---

## Current Project State

### 📂 Project Structure

```
VestaProject/
├── crates/
│   ├── piston-lib/          # Backend logic (services, repositories, models)
│   │   └── src/
│   │       ├── game/         # Minecraft metadata & version parsing (partial)
│   │       └── models/       # Domain models (planned)
│   └── piston-macros/       # SQL derive macros (complete & functional)
│       └── src/
│           ├── sqlite.rs     # Feature-complete macro implementation
│           └── derive_test.rs # Test/dev file
│
├── vesta-launcher/
│   ├── src-tauri/           # Tauri backend application
│   │   └── src/
│   │       ├── main.rs       # Clean Tauri setup with window effects
│   │       ├── structs/      # Data structures (in development)
│   │       ├── tasks/        # Task management (planned)
│   │       └── utils/        # Utilities
│   │           ├── config/   # Config management (basic)
│   │           ├── sqlite.rs # SQLite wrapper (functional)
│   │           ├── windows.rs # Window utilities
│   │           ├── logging.rs # Logging infrastructure (placeholder)
│   │           └── task.rs    # Task system (placeholder)
│   │
│   └── src/                 # Frontend application
│       ├── components/       # UI components
│       │   ├── pages/        # Page components
│       │   ├── page-root/    # Shared layout components
│       │   └── page-viewer/  # Built-in browser
│       ├── ui/              # Reusable UI component library
│       └── utils/           # Frontend utilities
│
└── ui-playground/           # Component testing sandbox
```

### 🎯 Current State Summary

**What's Working:**

- ✅ Complete UI component library with 12+ reusable components
- ✅ Custom SQL macro system for automatic table generation
- ✅ Build pipeline (Vite + Bun + Cargo)
- ✅ Page routing and navigation
- ✅ Window decorations with platform-specific effects
- ✅ Built-in browser with basic navigation

**What's In Progress:**

- 🚧 Instance management (UI exists, backend integration pending)
- 🚧 Settings system (skeleton exists, needs expansion)
- 🚧 Init flow (UI complete, backend hooks needed)
- 🚧 Database schema (AppConfig exists, core tables needed)

**What's Planned:**

- ⏳ Authentication system (Microsoft OAuth)
- ⏳ Game launching functionality
- ⏳ Mod management and discovery
- ⏳ File caching system
- ⏳ Complete settings implementation

### 💡 Development Philosophy: WAGile Approach

This project follows the **WAGile** (Waterfall planning + Agile execution) approach:

1. **Complete Planning First** - All features defined upfront (this document)
2. **Iterative Development** - Build in priority order, complete each fully
3. **No Technical Debt** - Finish features or cut scope, no half-measures
4. **Living Codebase** - Placeholder files expected during development

**Important Notes:**

- 📝 Files like `logging.rs`, `task.rs` = **future implementations**, not dead code
- 📝 Empty structs like `Settings`, `JavaPath` = **planned features**, not mistakes
- 📝 Hardcoded UI data (16 instance cards) = **mockups awaiting backend**

---

## Architecture Design

### Recommended Layered Architecture

```
┌─────────────────────────────────────────┐
│         Frontend (SolidJS)              │
│  • UI Components (presentation)         │
│  • State Management (signals)           │
│  • View logic only                      │
└─────────────────┬───────────────────────┘
                  │ Tauri IPC
┌─────────────────▼───────────────────────┐
│      Tauri Commands (src-tauri)         │
│  • Input validation                     │
│  • Command routing                      │
│  • Error marshalling                    │
└─────────────────┬───────────────────────┘
                  │
┌─────────────────▼───────────────────────┐
│    Service Layer (piston-lib)           │
│  • InstanceService                      │
│  • ModService                           │
│  • AuthService                          │
│  • DownloadService                      │
│  • LaunchService                        │
│  • CacheService                         │
└─────────────────┬───────────────────────┘
                  │
┌─────────────────▼───────────────────────┐
│   Repository Layer (piston-lib)         │
│  • InstanceRepository                   │
│  • ModRepository                        │
│  • AccountRepository                    │
│  • CacheRepository                      │
└─────────────────┬───────────────────────┘
                  │
┌─────────────────▼───────────────────────┐
│      Data Layer                         │
│  • SQLite (via custom macros)           │
│  • File System                          │
│  • HTTP (API clients)                   │
└─────────────────────────────────────────┘
```

### Recommended `piston-lib` Structure

```
piston-lib/src/
├── lib.rs
├── services/               # Business logic
│   ├── auth_service.rs     # Microsoft OAuth, tokens
│   ├── instance_service.rs # Instance management
│   ├── mod_service.rs      # Mod operations
│   ├── download_service.rs # File downloading
│   ├── launch_service.rs   # Game launching
│   └── cache_service.rs    # Cache management
├── repositories/           # Data access
│   ├── instance_repo.rs
│   ├── mod_repo.rs
│   ├── account_repo.rs
│   └── cache_repo.rs
├── models/                 # Domain models
│   ├── instance.rs
│   ├── mod_info.rs
│   ├── account.rs
│   ├── version.rs
│   └── launch_config.rs
├── api/                    # External APIs
│   ├── curseforge.rs
│   ├── modrinth.rs
│   └── mojang.rs
├── game/                   # Minecraft logic
│   ├── metadata.rs         # Version manifests
│   ├── launcher.rs         # Launch arguments
│   └── log_parser.rs       # Log parsing
└── utils/                  # Helpers
    ├── fs.rs
    ├── http.rs
    └── crypto.rs
```

---

## Implementation Phases

### Phase 0: Foundation (Weeks 1-2) 🏗️

**Goal:** Database schema, architecture patterns, remove blockers

**Tasks:**

- [ ] Design complete database schema (instances, mods, accounts, cache, settings)
- [ ] Implement migration system
- [ ] Create base repository trait
- [ ] Set up structured logging
- [ ] Establish error handling patterns
- [ ] Write architectural decision records

### Phase 1: Core Backend (Weeks 3-6) 🔴

**Goal:** Auth, instances, launching

**Tasks:**

- [ ] Microsoft OAuth 2.0 implementation
- [ ] Instance CRUD operations
- [ ] Game launching system
- [ ] Download management
- [ ] Java detection

**Deliverables:** User can log in, create instances, launch Minecraft

### Phase 2: Mod System (Weeks 7-10) 📦

**Goal:** Mod management and discovery

**Tasks:**

- [ ] Mod database and repository
- [ ] CurseForge/Modrinth API clients
- [ ] Mod installation from file and APIs
- [ ] Dependency resolution
- [ ] Cache system

**Deliverables:** User can install, browse, and update mods

### Phase 3: UI Polish (Weeks 11-14) 🎨

**Goal:** Connect backend to UI, settings, theming

**Tasks:**

- [ ] Dynamic instance list from database
- [ ] Complete settings page
- [ ] Notification system
- [ ] Theme customization
- [ ] Loading/error/empty states

**Deliverables:** Polished, fully functional UI

### Phase 4: Advanced Features (Weeks 15-18) 🚀

**Goal:** Modpacks, worlds, browser enhancements

**Tasks:**

- [ ] Modpack import/export
- [ ] World management
- [ ] Browser pop-out and URL copying
- [ ] Performance monitoring

**Deliverables:** Full feature set

### Phase 5: Polish & Release (Weeks 19-20) ✨

**Goal:** Production-ready

**Tasks:**

- [ ] Testing (unit, integration, E2E)
- [ ] Documentation
- [ ] Auto-update system
- [ ] Release builds

**Deliverables:** MVP release

---

## Development Standards

### Code Quality Guidelines

**Rust Best Practices:**

```rust
// ✅ Good - Clear error handling
pub fn load_instance(id: i32) -> Result<Instance, Error> {
    repository::get_instance(id)
        .context("Failed to load instance")?
}

// ✅ Good - Placeholder for future work
pub struct ModService {
    // Implementation planned for Phase 2
}
```

**TypeScript/SolidJS Best Practices:**

```tsx
// ✅ Good - Data-driven
function InstanceList() {
    const [instances, setInstances] = createSignal<Instance[]>([]);
    
    onMount(async () => {
        const data = await invoke<Instance[]>("get_instances");
        setInstances(data);
    });
    
    return <For each={instances()}>{(inst) => 
        <InstanceCard instance={inst} />
    }</For>;
}
```

### Commit Guidelines

**Format:**

```
<type>(<scope>): <subject>

<body>

<footer>
```

**Types:** `feat`, `fix`, `refactor`, `docs`, `test`, `chore`

**Examples:**

```
feat(auth): implement Microsoft OAuth flow

- Add OAuth redirect handling
- Store access tokens securely
- Implement token refresh

Closes #42
```

### Performance Targets

- **Startup Time:** < 2 seconds
- **Instance Launch:** < 5 seconds
- **Mod Search:** < 500ms (cached) / < 2s (API)
- **UI:** 60 FPS minimum
- **Build Time:** < 30 seconds (incremental)
- **Bundle Size:** < 50 MB

---

## Success Criteria

### MVP (Minimum Viable Product)

- [ ] User can authenticate with Microsoft
- [ ] User can create and launch instances
- [ ] User can install mods from file
- [ ] User can browse CurseForge mods
- [ ] Settings persist between sessions

### V1.0 (Full Release)

- [ ] All MVP features ✓
- [ ] Multi-account support
- [ ] Modpack import/export
- [ ] Auto-updates
- [ ] Complete theme customization
- [ ] Performance monitoring

---

**Last Updated**: November 16, 2025  
**Review Cycle**: Weekly during active development
