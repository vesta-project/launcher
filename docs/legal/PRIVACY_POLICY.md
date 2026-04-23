# Vesta Launcher Privacy Policy

Last updated: 2026-04-23

## Overview

Vesta Launcher collects limited diagnostics to help us detect crashes, investigate bugs, and improve stability.
These diagnostics are processed through Sentry.

Telemetry is enabled by default during onboarding (opt-out), and you can disable it at any time in Settings.

## What We Collect

When telemetry is enabled, we may collect:

- Error and crash reports.
- Stack traces and exception details.
- Basic runtime metadata (application version, OS, environment, release channel).
- Non-sensitive contextual breadcrumbs related to app behavior around a failure.

## What We Do Not Intend to Collect

Vesta Launcher is not designed to intentionally collect:

- Passwords, authentication secrets, or access tokens.
- Private message/chat content.
- Full personal documents unrelated to launcher errors.

However, if sensitive information is included in an error context by third-party tooling or unexpected runtime behavior, it could appear in diagnostics. We continuously work to minimize this risk.

## Why We Collect It

We use telemetry data to:

- Diagnose crashes and runtime failures.
- Prioritize and fix high-impact bugs.
- Improve reliability and release quality.

## Data Processor

Telemetry is processed by Sentry (Functional Software, Inc.) as our monitoring provider.

## Your Choices

- During onboarding, telemetry is enabled by default and can be turned off.
- You can change this preference anytime in launcher Settings.
- If disabled, Vesta Launcher skips Sentry initialization for subsequent app startups.

## Contact

For privacy-related questions, open an issue in the launcher repository:
<https://github.com/vesta-project/launcher/issues>
