# Guest Mode

Guest Mode in Vesta Launcher provides temporary, isolated sessions for users who want to explore the launcher without creating a permanent account. This feature enables browsing and limited functionality while maintaining data isolation and security.

## Overview

Guest Mode allows users to:
- Browse instances and resources without authentication
- Test launcher features in a sandboxed environment
- Access the launcher when internet connectivity is limited
- Use the launcher without committing to a full account setup

## Key Characteristics

### Temporary Sessions
- **No Persistence**: All data is lost when the session ends
- **Automatic Cleanup**: Guest sessions are automatically removed on logout or app restart
- **No Account Creation**: Doesn't require Microsoft OAuth or account registration

### Data Isolation
- **Separate Database**: Uses isolated account records with special UUID
- **No Cross-Contamination**: Guest data doesn't affect real user accounts
- **Clean Slate**: Each guest session starts fresh

### Feature Restrictions
- **No Instance Launching**: Cannot start Minecraft instances
- **Limited Modifications**: Cannot make permanent changes to instances
- **No Resource Installation**: Cannot install mods or resources
- **No Settings Persistence**: Configuration changes don't persist

## Technical Implementation

### Guest Account Structure

Guest accounts use a special UUID and account type:

```rust
pub const ACCOUNT_TYPE_GUEST: &str = "Guest";
pub const GUEST_UUID: &str = "00000000000000000000000000000000";
```

**Database Record:**
```sql
INSERT INTO account (
    uuid, username, display_name, account_type, is_active
) VALUES (
    '00000000000000000000000000000000',
    'LocalGuest',
    'Local Guest',
    'Guest',
    true
);
```

### Session Lifecycle

#### 1. Session Creation
```rust
#[tauri::command]
pub async fn start_guest_session(app_handle: AppHandle) -> Result<(), String> {
    // Create marker file for session tracking
    let marker_path = app_data_dir.join(".guest_mode");
    std::fs::File::create(&marker_path)?;
    
    // Create guest account in database
    // Set as active account
    // Emit configuration updates
}
```

#### 2. Session Markers
- **File Marker**: `.guest_mode` file in app data directory
- **Database Flag**: Special UUID identifies guest accounts
- **UI Indicators**: Visual cues throughout the interface

#### 3. Session Cleanup
Automatic cleanup occurs on:
- **Explicit Logout**: User chooses to sign in
- **App Restart**: Stale guest sessions are detected and removed
- **Account Switch**: Switching to authenticated account

### Cleanup Process

```rust
// 1. Remove marker file
let marker_path = app_data_dir.join(".guest_mode");
let _ = std::fs::remove_file(&marker_path);

// 2. Delete guest account from database
diesel::delete(account.filter(uuid.eq(GUEST_UUID))).execute(&mut conn)?;

// 3. Reset active account in config
if config.active_account_uuid == Some(GUEST_UUID.to_string()) {
    config.active_account_uuid = None;
}
```

## User Interface

### Onboarding Flow

Guest Mode is presented as an option during initial setup:

```tsx
const handleGuestMode = async () => {
    try {
        await invoke("start_guest_session");
        // Navigate to main interface
    } catch (error) {
        setErrorMessage(`Failed to start guest session: ${error}`);
    }
};
```

**UI Messaging:**
- "Continue as Guest" button during onboarding
- Clear warnings about limitations
- Offline connectivity handling

### Visual Indicators

#### Persistent Notification
Guest sessions show a persistent notification banner:

```typescript
let actions = vec![NotificationAction {
    action_id: "logout_guest".to_string(),
    label: "Sign In".to_string(),
    action_type: "primary".to_string(),
}];

manager.create(CreateNotificationInput {
    client_key: Some("guest_mode_warning".to_string()),
    title: Some("Guest Mode Active".to_string()),
    description: Some("You are in guest mode. Changes will not be saved, and certain features are restricted.".to_string()),
    severity: Some("info".to_string()),
    notification_type: Some(NotificationType::Patient),
    dismissible: Some(false), // Persistent
    actions: Some(actions),
});
```

#### UI Restrictions
Components check for guest status and disable restricted features:

```tsx
const isGuest = () => activeAccount()?.account_type === ACCOUNT_TYPE_GUEST;

// Disable instance launching
<button disabled={isGuest()}>Launch Instance</button>

// Disable resource installation
<button disabled={isGuest()}>Install Mod</button>
```

### Restricted Features

#### Instance Management
- **Creation**: Allowed (but data is temporary)
- **Modification**: Limited (version changes disabled)
- **Launching**: Completely disabled
- **Deletion**: Allowed

#### Resource System
- **Browsing**: Fully functional
- **Searching**: Available
- **Installation**: Disabled
- **Dependency Resolution**: View-only

#### Settings & Configuration
- **Viewing**: Allowed
- **Modification**: Changes don't persist
- **Theme Selection**: Temporary
- **Account Settings**: N/A

## Security Considerations

### Data Isolation
- **No Real Account Access**: Cannot access authenticated user data
- **Clean Environment**: No residual data from previous sessions
- **No Credential Storage**: No passwords or tokens stored

### Network Restrictions
- **Offline Capability**: Works without internet for browsing
- **Limited API Access**: Cannot authenticate or access user-specific APIs
- **Safe Fallback**: Provides functionality when authentication fails

### Session Boundaries
- **No Persistence**: Data evaporates on session end
- **No Cross-Session State**: Each guest session is independent
- **Automatic Cleanup**: Prevents data accumulation

## Use Cases

### Primary Scenarios

#### 1. First-Time Exploration
- Users trying the launcher before committing to account setup
- Evaluating features without Microsoft OAuth complexity
- Testing launcher compatibility

#### 2. Offline Usage
- Using launcher when internet connectivity is unavailable
- Browsing existing instances without network-dependent features
- Emergency access when authentication services are down

#### 3. Demonstration/Presentation
- Showing launcher features without real account data
- Training scenarios with clean environment
- Development and testing

#### 4. Limited Access Environments
- School or workplace computers with restrictions
- Shared computers where permanent accounts aren't desired
- Temporary access scenarios

### Secondary Scenarios

#### 5. Account Migration
- Testing launcher before migrating from another launcher
- Verifying instance compatibility
- Planning account setup

#### 6. Troubleshooting
- Isolating launcher issues from account-specific problems
- Testing in clean environment
- Debugging authentication-related issues

## Limitations & Warnings

### Functional Restrictions
- **No Game Launching**: Core limitation for security and data isolation
- **No Modifications**: Cannot install mods or change instance configurations
- **No Persistence**: All changes lost on logout
- **No Sharing**: Cannot export or share guest session data

### User Experience Considerations
- **Clear Communication**: Users must understand limitations upfront
- **Easy Exit**: Simple path to create real account
- **No Surprises**: No unexpected data loss
- **Helpful Guidance**: Suggestions for upgrading to full account

## Implementation Details

### Database Schema Impact
Guest accounts use the same `account` table structure but with:
- Fixed UUID for easy identification
- Special account type for UI logic
- Automatic cleanup on session end

### State Management
- **Account Store**: Tracks guest status alongside authenticated accounts
- **UI Components**: Conditional rendering based on account type
- **API Calls**: Backend checks account type for authorization

### Event Handling
- **Session Events**: `core://logout-guest` for cleanup coordination
- **Config Updates**: Active account changes trigger UI updates
- **Notification System**: Persistent warnings and action buttons

## Future Enhancements

### Potential Improvements
- **Guest Data Export**: Allow saving instance configurations
- **Limited Persistence**: Save preferences within guest session
- **Guest Account Upgrade**: Seamless conversion to real account
- **Advanced Restrictions**: Granular permission system

### Technical Extensions
- **Guest Instance Templates**: Pre-configured instances for guests
- **Resource Preview**: Mock installations for demonstration
- **Session Duration**: Configurable guest session timeouts
- **Multi-Guest Support**: Multiple concurrent guest sessions