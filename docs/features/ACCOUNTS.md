# Account Management

## Overview

Vesta Launcher supports multiple account types to provide different user experiences and authentication methods. Accounts handle authentication, theming preferences, and feature access control.

## Account Types

### Microsoft Accounts

- **Type**: `"Microsoft"`
- **Authentication**: OAuth 2.0 via Microsoft identity platform
- **Features**: Full access to all launcher features including resource installation, instance management, and persistent data
- **Token Management**: Stores access and refresh tokens with expiration handling
- **Persistence**: All changes and preferences are saved

### Guest Accounts

- **Type**: `"Guest"`
- **Authentication**: No authentication required
- **Features**: Limited access for browsing and exploration
- **Restrictions**: Cannot install resources, cannot create persistent instances, changes not saved
- **Data Isolation**: Temporary session with no data persistence

## Token Expiration and Management

### Microsoft Account Tokens

Microsoft accounts use OAuth 2.0 tokens:

- **Access Token**: Short-lived token (typically 1 hour) for API authentication
- **Refresh Token**: Long-lived token for obtaining new access tokens
- **Expiration**: `token_expires_at` field stores expiration timestamp
- **Refresh Logic**: Automatic token refresh when access token expires
- **Expired Flag**: `is_expired` boolean marks accounts needing re-authentication

### Token Refresh Process

1. Check if `token_expires_at` is past current time
2. Use `refresh_token` to obtain new access token
3. Update `token_expires_at` and `access_token` in database
4. Continue with authenticated requests

## Database Schema

Accounts are stored in the `account` table:

```sql
CREATE TABLE account (
    id INTEGER PRIMARY KEY,
    uuid TEXT NOT NULL,
    username TEXT NOT NULL,
    display_name TEXT,
    access_token TEXT,
    refresh_token TEXT,
    token_expires_at TEXT,
    is_active BOOLEAN NOT NULL,
    skin_url TEXT,
    cape_url TEXT,
    created_at TEXT,
    updated_at TEXT,
    -- Theming fields...
    account_type TEXT NOT NULL,  -- "Microsoft" or "Guest"
    is_expired BOOLEAN NOT NULL
);
```

## Guest Mode Implementation

### Restrictions

Guest accounts have several limitations enforced at the backend:

- **Resource Installation**: Blocked in `install_resource` command
- **Instance Visibility**: `list_instances` hides real instances for guests
- **Persistence**: Changes are temporary and not saved

### UI Handling

- Guest mode shows warning notifications for restricted actions
- Instance list shows only guest-created instances
- Login prompts appear for premium features

## Authentication Flows

### Microsoft Login

1. User clicks login button
2. OAuth 2.0 flow with Microsoft identity platform
3. Authorization code exchange for tokens
4. Account creation/update in database
5. Theme preferences sync from account

### Guest Mode

1. User selects "Continue as Guest" during setup
2. Temporary account created with `ACCOUNT_TYPE_GUEST`
3. Limited UI state (no real instances shown)
4. No token storage required

## Account Switching

- Only one active account at a time (`is_active` flag)
- Switching accounts updates UI state and preferences
- Guest mode can be exited by logging in with Microsoft account

This account system provides secure authentication while offering flexible access options for different user needs.