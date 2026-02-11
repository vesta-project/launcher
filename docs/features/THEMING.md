# Theming System

## Overview

Vesta Launcher's theming system allows users to customize the appearance of the application through a variety of options including colors, styles, and modes. Themes are stored per user account and automatically applied when switching accounts.

## Architecture

### Core Components

- **Presets (`src/themes/presets.ts`)**: Central hub for theme definitions and utilities.
- **Theme Application**: `applyTheme` function maps `ThemeConfig` to CSS custom properties on the `:root` element.
- **Storage**: Theme settings are stored in the `AppConfig` and synced to the active `Account` profile.

### Theme Configuration Fields

Themes are configured through the following fields in the backend model:

- `theme_id`: Identifier for the theme preset
- `theme_mode`: Light or dark mode
- `theme_primary_hue`: Primary color hue (0-360)
- `theme_style`: Visual style (glass, satin, flat, bordered, solid)
- `theme_gradient_enabled`: Whether gradients are enabled
- `theme_border_width`: Border width in pixels

### Style Modes

- **Glass**: Translucent background with backdrop filter
- **Satin**: Matte finish
- **Flat**: No backdrop filter
- **Bordered**: High contrast with borders
- **Solid**: Opaque background

### CSS Variable Mapping

The `configToTheme` function in `presets.ts` converts the backend configuration to a `ThemeConfig` object, which is then applied as CSS variables:

```typescript
interface ThemeConfig {
  // Color variables
  '--color-primary': string;
  '--color-background': string;
  // ... other variables
}
```

### Account Synchronization

When the active account is changed, the application automatically applies that account's specific theme settings. Account UUIDs are stored in normalized format (without dashes) for consistency.

### Usage

Themes are applied globally via CSS custom properties, allowing components to use `var(--color-primary)` etc. for consistent styling across the application.