# Test Catalog & How To Run Tests

This document explains where tests live in the repository, how to run them, and highlights a few notable, environment-dependent tests to watch for when running the suite locally.

Overview
- Tests in this workspace are primarily Rust unit and integration tests distributed across crates under `crates/` and integration tests under `tests/` folders. The frontend (`vesta-launcher/`) may contain its own JS/TS tests (Vite/Vitest), but the core launcher logic is tested in Rust.

## Frontend Testing (SolidJS)

The frontend uses **SolidJS** with **Vitest** for unit testing and **@solidjs/testing-library** for component testing. Tests are located in `vesta-launcher/src/` alongside components or in dedicated test files.

### Running Frontend Tests
- Run all frontend tests:
  ```bash
  cd vesta-launcher
  bun run test
  ```

- Run tests in watch mode:
  ```bash
  bun run test --watch
  ```

- Run with coverage:
  ```bash
  bun run test --coverage
  ```

### SolidJS Testing Tips
- **Reactive State Testing**: Use `createRoot` to test signals and effects. SolidJS reactivity is synchronous, so tests can assert immediately after state changes.
  ```typescript
  import { createSignal } from 'solid-js';
  import { createRoot } from 'solid-js';

  test('signal updates', () => {
    createRoot(() => {
      const [count, setCount] = createSignal(0);
      setCount(1);
      expect(count()).toBe(1);
    });
  });
  ```

- **Component Testing**: Use `@solidjs/testing-library` for rendering components and querying DOM.
  ```typescript
  import { render } from '@solidjs/testing-library';
  import { Button } from './Button';

  test('button renders', () => {
    const { getByText } = render(() => <Button>Click me</Button>);
    expect(getByText('Click me')).toBeInTheDocument();
  });
  ```

- **Stores and Context**: Test stores by creating them in a root and asserting state changes. For context providers, wrap components in the provider during render.
  ```typescript
  import { createStore } from 'solid-js/store';

  test('store updates', () => {
    const [state, setState] = createStore({ count: 0 });
    setState('count', 1);
    expect(state.count).toBe(1);
  });
  ```

- **Async Operations**: SolidJS resources and effects can be tested by awaiting or using `tick` from testing-library.
  ```typescript
  import { createResource } from 'solid-js';
  import { waitFor } from '@testing-library/dom';

  test('resource loads', async () => {
    const [data] = createResource(fetchData);
    await waitFor(() => expect(data()).toBeDefined());
  });
  ```

- **Mocking Tauri Commands**: Use Vitest's mocking to simulate `invoke` calls.
  ```typescript
  import { vi } from 'vitest';
  import { invoke } from '@tauri-apps/api/tauri';

  vi.mock('@tauri-apps/api/tauri', () => ({
    invoke: vi.fn(),
  }));

  test('calls command', async () => {
    (invoke as any).mockResolvedValue('result');
    // test component that calls invoke
  });
  ```

### Integration Testing Examples

Integration tests verify that multiple components work together correctly, testing user workflows and data flow.

#### Component Interaction Testing
```typescript
import { render, screen, fireEvent, waitFor } from '@solidjs/testing-library';
import { InstanceList } from './InstanceList';
import { instanceStore } from '../stores/instances';

test('launch instance workflow', async () => {
  // Mock the store
  vi.mocked(instanceStore).instances = [
    { id: 1, name: 'Test Instance', minecraft_version: '1.20.1' }
  ];

  // Mock Tauri invoke
  const mockInvoke = vi.fn().mockResolvedValue(undefined);
  vi.mocked(invoke).mockImplementation(mockInvoke);

  const { getByText } = render(() => <InstanceList />);

  // Click launch button
  fireEvent.click(getByText('Launch'));

  // Verify command was called
  await waitFor(() => {
    expect(mockInvoke).toHaveBeenCalledWith('launch_instance', {
      instanceData: expect.objectContaining({ id: 1 })
    });
  });

  // Check UI updates (assuming store updates launching state)
  expect(getByText('Launching...')).toBeInTheDocument();
});
```

#### Form Submission Testing
```typescript
import { render, screen, fireEvent, waitFor } from '@solidjs/testing-library';
import { CreateInstanceForm } from './CreateInstanceForm';

test('create instance form', async () => {
  const onSubmit = vi.fn();
  const { getByLabelText, getByText } = render(() => (
    <CreateInstanceForm onSubmit={onSubmit} />
  ));

  // Fill form
  fireEvent.change(getByLabelText('Instance Name'), {
    target: { value: 'My Instance' }
  });
  fireEvent.change(getByLabelText('Minecraft Version'), {
    target: { value: '1.20.1' }
  });

  // Submit
  fireEvent.click(getByText('Create'));

  await waitFor(() => {
    expect(onSubmit).toHaveBeenCalledWith({
      name: 'My Instance',
      minecraftVersion: '1.20.1'
    });
  });
});
```

#### Store Integration Testing
```typescript
import { createRoot, createEffect } from 'solid-js';
import { instanceStore, initializeInstances } from '../stores/instances';

test('store initialization', async () => {
  // Mock Tauri invoke
  const mockInstances = [
    { id: 1, name: 'Instance 1' },
    { id: 2, name: 'Instance 2' }
  ];
  vi.mocked(invoke).mockResolvedValue(mockInstances);

  createRoot(() => {
    // Test reactive updates
    let storeValue;
    createEffect(() => {
      storeValue = instanceStore.instances;
    });

    await initializeInstances();

    expect(storeValue).toEqual(mockInstances);
    expect(instanceStore.loading).toBe(false);
  });
});
```

#### Error Handling Testing
```typescript
import { render, screen, waitFor } from '@solidjs/testing-library';
import { InstanceLauncher } from './InstanceLauncher';

test('handles launch errors', async () => {
  // Mock failed launch
  vi.mocked(invoke).mockRejectedValue(new Error('Launch failed'));

  const { getByText } = render(() => <InstanceLauncher instanceId={1} />);

  fireEvent.click(getByText('Launch'));

  await waitFor(() => {
    expect(getByText('Launch failed')).toBeInTheDocument();
  });
});
```

#### Async Data Flow Testing
```typescript
import { render, waitFor } from '@solidjs/testing-library';
import { ModPackImporter } from './ModPackImporter';

test('imports modpack with progress', async () => {
  // Mock import process
  let callCount = 0;
  vi.mocked(invoke).mockImplementation(() => {
    callCount++;
    if (callCount === 1) return Promise.resolve({ status: 'downloading' });
    if (callCount === 2) return Promise.resolve({ status: 'installing' });
    return Promise.resolve({ status: 'completed' });
  });

  const { getByText } = render(() => <ModPackImporter />);

  fireEvent.click(getByText('Import Pack'));

  // Check progress updates
  await waitFor(() => expect(getByText('Downloading...')).toBeInTheDocument());
  await waitFor(() => expect(getByText('Installing...')).toBeInTheDocument());
  await waitFor(() => expect(getByText('Import Complete')).toBeInTheDocument());
});
```

### Best Practices for Integration Tests
- **Mock External Dependencies**: Mock Tauri commands, API calls, and file system operations
- **Test User Journeys**: Focus on complete workflows rather than isolated units
- **Use Realistic Data**: Test with data structures that match production
- **Verify Side Effects**: Check that stores update and UI reflects changes
- **Handle Async Operations**: Use `waitFor` for reactive updates and async operations
- **Clean Up**: Reset mocks and stores between tests

Where tests live
- `crates/piston-lib/` — unit tests and module tests for installers, processors, and launcher logic (primary location for installer-related tests).
- `crates/piston-lib/tests/` — integration-style tests (e.g., installer flow tests).
- `crates/piston-macros/` — tests for the procedural macros (derive behavior, sqlite helpers).
- `src-tauri/` — may contain tests for Tauri-specific or migration logic.
- `playground/` — small example projects and can contain tests used for experimentation.

Notable tests (examples you may encounter)
- `game::launcher::arguments::tests::build_variables_canonicalize_paths` — verifies path canonicalization behavior; can fail on systems with unusual filesystem setups.
- `game::launcher::process::tests::test_verify_java` — checks that `java` is available and usable; fails when Java is not on `PATH`.
- `crates/piston-lib` tests around `prepare_data_files` — these tests validate extraction of `data/*` entries from installer JARs and library artifacts (e.g., `prepare_data_files_handles_maven_and_jar_entries`, `prepare_data_files_extracts_data_from_library_jars`).
- Integration tests in `crates/piston-lib/tests/` such as `integration_natives_flow.rs` — can emulate platform-native behavior and validate multi-step flows.

How to run tests
- Run all tests in the workspace (may be slow):

  cargo test

- Run tests for a single crate (example: `piston-lib`):

  cargo test -p piston-lib --lib

- Run a single test by name (example):

  cargo test -p piston-lib --lib prepare_data_files_extracts_data_from_library_jars

- Run the example installer (useful for manual end-to-end checks):

  cargo run -p piston-lib --example test_install

Environment-dependent tests and tips
- Java: Tests that verify Java or run Java-based processors require `java` on `PATH`. On Windows, ensure the JRE/JDK `bin` directory is in your environment `PATH`. Verify with:

  java -version

- Filesystem canonicalization: Some tests assert canonicalized paths. If a test like `build_variables_canonicalize_paths` fails, check platform-specific path behaviors and filesystem permissions.
- Network requirements: Some tests that validate artifact downloads require network access to Maven repositories or asset servers. If tests fail due to network timeouts, re-run in a connected environment.

Debugging failing tests
- Increase verbosity when running tests:

  RUST_LOG=debug cargo test -p piston-lib --lib

- Inspect test-specific temporary directories printed by the tests (look for `tempdir` or `target/` outputs) to see extracted files like `data/client.lzma` or downloaded artifacts under `libraries_dir`.
- When a Java processor fails with `FileNotFoundException` for `data/*`, inspect the instance `data_dir` and the library paths; ensure the installer extracted the `data/*` entry from the JAR or that a library-provided resource was downloaded.

Adding tests
- Add unit tests alongside the module under `src/` using `#[cfg(test)]` and `mod tests { ... }`.
- For integration tests, add files under the crate `tests/` directory (they are compiled as separate binaries). Use `tempfile` or `assert_fs` crates for safe temporary files and directories.

CI and automation
- CI should run `cargo test --workspace` or crate-targeted tests as appropriate. Consider marking Java-dependent tests as conditional in CI if Java is not available on the worker images.

References in code
- Installer logic & tests: `crates/piston-lib/src/game/installer/` and `crates/piston-lib/tests/`.
- Processor invocation tests: `crates/piston-lib/src/game/installer/forge_processor.rs` and related unit tests that assert argument normalization and file extraction.
- Migration and DB tests: `src-tauri/migrations/` and Diesel model tests in `src-tauri/src/models/`.

If you want, I can also:
- Generate a machine-readable list of all test names in the workspace (requires running `cargo test -- --list` or parsing `cargo metadata`).
- Add a CI-friendly script that runs the non-Java tests quickly and the Java tests only when `java` is present.

## Integration Testing Examples

Integration tests verify end-to-end functionality across components. These examples show how to test full flows in the Vesta codebase.

### Backend Integration Tests (Rust)

#### Example: Full Mod Loader Installation Flow

In `crates/piston-lib/tests/integration_fabric.rs`:

```rust
use piston_lib::game::installer::{InstallSpec, ModloaderType};
use piston_lib::game::metadata::load_or_fetch_metadata;
use std::path::PathBuf;
use tempfile::TempDir;

#[tokio::test]
async fn test_fabric_installation_integration() {
    let temp_dir = TempDir::new().unwrap();
    let data_dir = temp_dir.path().to_path_buf();

    // Setup test metadata
    let metadata = load_or_fetch_metadata(&data_dir).await.unwrap();

    // Find a supported Fabric version
    let fabric_version = metadata
        .get_latest_loader_version("1.20.1", ModloaderType::Fabric)
        .unwrap();

    // Create install spec
    let spec = InstallSpec {
        version_id: "1.20.1".to_string(),
        modloader: Some(ModloaderType::Fabric),
        modloader_version: Some(fabric_version),
        data_dir: data_dir.clone(),
        game_dir: temp_dir.path().join("game"),
        java_path: None, // Use system Java
        dry_run: false,
        concurrency: 4,
    };

    // Run installation
    let result = piston_lib::game::installer::install_modloader(&spec).await;

    // Verify installation
    assert!(result.is_ok(), "Fabric installation should succeed");

    // Check that version directory was created
    let version_dir = spec.game_dir.join("versions").join(&spec.version_id);
    assert!(version_dir.exists(), "Version directory should exist");

    // Verify version.json exists and is valid
    let version_json = version_dir.join(format!("{}.json", spec.version_id));
    assert!(version_json.exists(), "version.json should exist");

    let content = std::fs::read_to_string(&version_json).unwrap();
    let version_manifest: serde_json::Value = serde_json::from_str(&content).unwrap();
    assert_eq!(version_manifest["id"], spec.version_id);
}
```

#### Example: Library Download and Cache Integration

In `crates/piston-lib/tests/integration_cache.rs`:

```rust
use piston_lib::game::installer::core::library::LibraryDownloader;
use reqwest::Client;
use std::path::PathBuf;
use tempfile::TempDir;

#[tokio::test]
async fn test_library_download_with_cache() {
    let temp_dir = TempDir::new().unwrap();
    let cache_dir = temp_dir.path().join("cache");

    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .unwrap();

    let downloader = LibraryDownloader::new(&client, &cache_dir, None);

    // Test downloading a known library
    let maven_coord = "com.mojang:authlib:3.18.38";
    let result = downloader.download_library(maven_coord).await;

    assert!(result.is_ok(), "Library download should succeed");

    let library_path = result.unwrap();
    assert!(library_path.exists(), "Downloaded library should exist");

    // Verify file integrity
    let content = std::fs::read(&library_path).unwrap();
    assert!(!content.is_empty(), "Library file should not be empty");

    // Test cache reuse - second download should be instant
    let start = std::time::Instant::now();
    let result2 = downloader.download_library(maven_coord).await;
    let duration = start.elapsed();

    assert!(result2.is_ok(), "Cached download should succeed");
    assert!(duration < std::time::Duration::from_millis(100), "Cached download should be fast");
}
```

### Frontend Integration Tests

#### Example: Complete Instance Launch Flow

In `vesta-launcher/src/__tests__/integration/instance-launch.test.tsx`:

```typescript
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createStore } from 'solid-js/store';
import { InstanceList } from '../../components/pages/instances/InstanceList';
import { instanceStore } from '../../stores/instances';

// Mock Tauri commands
vi.mock('@tauri-apps/api/tauri', () => ({
  invoke: vi.fn(),
}));

const mockInvoke = vi.mocked(invoke);

describe('Instance Launch Integration', () => {
  beforeEach(() => {
    // Reset mocks
    mockInvoke.mockClear();

    // Mock successful instance list
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'get_instances') {
        return [
          {
            id: 'test-instance',
            name: 'Test Instance',
            version: '1.20.1',
            modloader: 'fabric',
            status: 'stopped',
            last_played: null,
          },
        ];
      }
      if (cmd === 'launch_instance') {
        return { success: true };
      }
      return null;
    });
  });

  test('user can launch instance from list', async () => {
    const user = userEvent.setup();

    render(() => <InstanceList />);

    // Wait for instances to load
    await waitFor(() => {
      expect(screen.getByText('Test Instance')).toBeInTheDocument();
    });

    // Click launch button
    const launchButton = screen.getByRole('button', { name: /launch/i });
    await user.click(launchButton);

    // Verify launch command was called
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('launch_instance', {
        instanceId: 'test-instance',
      });
    });

    // Verify UI updates to show launching state
    expect(screen.getByText(/launching/i)).toBeInTheDocument();
  });

  test('launch failure shows error notification', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'launch_instance') {
        throw new Error('Java not found');
      }
      return null;
    });

    const user = userEvent.setup();

    render(() => <InstanceList />);

    await waitFor(() => {
      expect(screen.getByText('Test Instance')).toBeInTheDocument();
    });

    const launchButton = screen.getByRole('button', { name: /launch/i });
    await user.click(launchButton);

    // Verify error notification appears
    await waitFor(() => {
      expect(screen.getByText(/Java not found/i)).toBeInTheDocument();
    });
  });
});
```

#### Example: Resource Installation Flow

In `vesta-launcher/src/__tests__/integration/resource-install.test.tsx`:

```typescript
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ResourceDetails } from '../../components/pages/resources/ResourceDetails';

const mockInvoke = vi.mocked(invoke);

describe('Resource Installation Integration', () => {
  beforeEach(() => {
    mockInvoke.mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === 'get_resource_details') {
        return {
          id: 'fabric-api',
          name: 'Fabric API',
          description: 'Core API for Fabric mods',
          versions: [
            {
              id: '1.0.0',
              game_versions: ['1.20.1'],
              loaders: ['fabric'],
            },
          ],
        };
      }
      if (cmd === 'install_resource') {
        // Simulate progress updates
        if (args?.onProgress) {
          args.onProgress({ progress: 50, message: 'Downloading...' });
          setTimeout(() => args.onProgress({ progress: 100, message: 'Complete' }), 100);
        }
        return { success: true };
      }
      return null;
    });
  });

  test('user can install resource with progress feedback', async () => {
    const user = userEvent.setup();

    render(() => <ResourceDetails resourceId="fabric-api" />);

    // Wait for details to load
    await waitFor(() => {
      expect(screen.getByText('Fabric API')).toBeInTheDocument();
    });

    // Click install button
    const installButton = screen.getByRole('button', { name: /install/i });
    await user.click(installButton);

    // Verify progress appears
    expect(screen.getByText('Downloading...')).toBeInTheDocument();

    // Wait for completion
    await waitFor(() => {
      expect(screen.getByText('Complete')).toBeInTheDocument();
    });

    // Verify install command was called
    expect(mockInvoke).toHaveBeenCalledWith('install_resource', {
      resourceId: 'fabric-api',
      versionId: '1.0.0',
      instanceId: undefined, // Install to default instance
    });
  });
});
```

### Running Integration Tests

#### Backend Integration Tests
```bash
# Run all integration tests
cargo test --test integration_*

# Run specific integration test
cargo test -p piston-lib --test integration_fabric test_fabric_installation_integration

# With verbose output
cargo test --test integration_* -- --nocapture
```

#### Frontend Integration Tests
```bash
# Run integration tests
cd vesta-launcher
bun run test --run integration/

# Run with coverage
bun run test --run integration/ --coverage
```

### Best Practices for Integration Tests

1. **Use realistic data**: Test with actual Minecraft versions and real mod coordinates
2. **Mock external services**: Use mock servers for API calls, but test real file I/O
3. **Test error paths**: Verify graceful handling of network failures, invalid data, etc.
4. **Clean up resources**: Use temporary directories and ensure test isolation
5. **Test performance**: Add timeouts and verify operations complete within reasonable time
6. **Document dependencies**: Note which external services or files are required

### CI Integration

Integration tests should run in CI with:
- Real network access (for downloading libraries/assets)
- Temporary directories for isolation
- Proper cleanup between test runs
- Separate job from unit tests (slower, more resources)
