# Auto-Mod Installation Logic

This document describes the automatic mod installation system used by Vesta Launcher for linked instances and modpack management.

## Overview

Auto-mod installation enables seamless deployment of modpacks by automatically downloading, verifying, and installing mods and resources based on a manifest file. This system ensures consistency across installations and prevents manual errors.

## Manifest Format

### Modrinth Pack Format
```json
{
  "formatVersion": 1,
  "game": "minecraft",
  "versionId": "1.0.0",
  "name": "Example Pack",
  "summary": "A sample modpack",
  "files": [
    {
      "path": "mods/fabric-api-0.88.1+1.20.1.jar",
      "hashes": {
        "sha512": "abc123...",
        "sha1": "def456..."
      },
      "downloads": [
        "https://cdn.modrinth.com/data/P7dR8mSH/versions/0.88.1+1.20.1/fabric-api-0.88.1+1.20.1.jar"
      ],
      "fileSize": 1048576
    }
  ],
  "dependencies": {
    "minecraft": "1.20.1",
    "fabric-loader": "0.15.11"
  }
}
```

### CurseForge Format
```json
{
  "minecraft": {
    "version": "1.20.1",
    "modLoaders": [
      {
        "id": "fabric-0.15.11",
        "primary": true
      }
    ]
  },
  "manifestType": "minecraftModpack",
  "manifestVersion": 1,
  "name": "Example Pack",
  "version": "1.0.0",
  "author": "Pack Author",
  "files": [
    {
      "projectID": 306612,
      "fileID": 4615795,
      "required": true
    }
  ],
  "overrides": "overrides"
}
```

## Installation Process

### 1. Manifest Parsing
- Load and validate manifest JSON
- Extract file listings and metadata
- Resolve dependencies and modloader requirements
- Check for platform-specific compatibility

### 2. File Verification
- Scan instance directory for existing files
- Compare local files against manifest
- Identify missing, outdated, or corrupted files
- Generate download queue

### 3. Download Management
- Prioritize critical files (libraries, core mods)
- Use concurrent downloads with configurable limits
- Implement retry logic with exponential backoff
- Support multiple mirror URLs per file

### 4. Integrity Verification
- Verify downloaded files against provided hashes
- Support SHA1, SHA256, and SHA512
- Quarantine failed downloads
- Log verification results

### 5. File Organization
- Place files in correct directories (mods/, config/, etc.)
- Handle overrides and custom paths
- Preserve user modifications where allowed
- Clean up temporary files

## Conflict Resolution

### File Conflicts
- **Manifest Priority**: Manifest files always take precedence
- **User Data Protection**: Preserve user configs in allowed directories
- **Backup Creation**: Create backups before overwriting
- **Merge Strategies**: Attempt to merge compatible changes

### Dependency Conflicts
- **Version Resolution**: Use manifest-specified versions
- **Compatibility Checking**: Validate mod compatibility
- **Error Reporting**: Clear messages for unresolvable conflicts
- **Fallback Options**: Allow manual override in some cases

## Error Handling

### Network Failures
- **Retry Logic**: Configurable retry attempts
- **Mirror Fallback**: Try alternative download URLs
- **Offline Mode**: Use cached files when possible
- **Progress Reporting**: Keep user informed of issues

### File System Issues
- **Permission Errors**: Request elevation or suggest alternative paths
- **Disk Space**: Check available space before downloads
- **Corruption**: Automatic redownload of corrupted files
- **Lock Conflicts**: Handle files locked by running processes

### Validation Errors
- **Manifest Issues**: Clear error messages for invalid manifests
- **Missing Dependencies**: Guide users to resolve missing requirements
- **Platform Mismatches**: Detect and report compatibility issues

## Performance Optimization

### Caching Strategy
- **File Caching**: Reuse downloaded files across instances
- **Manifest Caching**: Cache parsed manifests to reduce reprocessing
- **Hash Caching**: Store computed hashes to avoid recalculation

### Concurrent Operations
- **Download Parallelism**: Configurable concurrent download limit
- **CPU Utilization**: Balance download and verification tasks
- **Memory Management**: Stream large files to avoid memory issues

### Incremental Updates
- **Delta Detection**: Only download changed files
- **Partial Resumes**: Resume interrupted downloads
- **Smart Sync**: Avoid unnecessary operations

## User Experience

### Progress Feedback
- **Detailed Progress**: Show current operation and completion percentage
- **Speed Indicators**: Display download speeds and ETA
- **Error Notifications**: Clear, actionable error messages
- **Completion Summary**: Report successful installations

### Configuration Options
- **Download Settings**: Control concurrency and retry behavior
- **Verification Level**: Choose hash verification strictness
- **Backup Preferences**: Configure automatic backup behavior
- **Conflict Resolution**: Set default conflict handling policies

## Integration Points

### Instance Management
- **Pre-Launch Sync**: Automatic integrity check before launch
- **Background Updates**: Optional automatic modpack updates
- **Repair Operations**: Use auto-installation for repair tasks

### Mod Management
- **Dependency Resolution**: Automatically install required dependencies
- **Optional Mods**: Handle optional mods with user choice
- **Update Notifications**: Alert users to available mod updates

### Platform APIs
- **Modrinth Integration**: Direct API calls for mod metadata
- **CurseForge Support**: Handle CurseForge-specific file structures
- **Custom Sources**: Support user-provided manifest sources

## Security Considerations

### File Validation
- **Hash Verification**: Mandatory for all downloaded files
- **Source Authentication**: Validate download URLs
- **Sandboxing**: Run installation in restricted environment

### User Safety
- **Permission Requests**: Clear indication of required permissions
- **Backup Warnings**: Alert users to destructive operations
- **Rollback Options**: Provide recovery mechanisms

## Troubleshooting

### Common Issues
- **Download Failures**: Check network and firewall settings
- **Hash Mismatches**: Clear cache and retry downloads
- **Permission Denied**: Run as administrator or change install path

### Debug Information
- **Log Files**: Detailed installation logs
- **Manifest Inspection**: Tools to examine manifest contents
- **Network Tracing**: Debug download issues

## Future Enhancements

- **Parallel Installation**: Install multiple instances simultaneously
- **Mod Update Tracking**: Monitor for mod updates
- **Custom Mod Sources**: Support additional mod platforms
- **Advanced Conflict Resolution**: Intelligent merging of user changes