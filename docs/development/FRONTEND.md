# Frontend Patterns Guide (SolidJS)

## Overview

Vesta Launcher's frontend is built with SolidJS, a reactive JavaScript library that provides fine-grained reactivity and excellent performance. This guide covers the key patterns, best practices, and architectural decisions used in the project.

## Core Concepts

### Reactivity System

SolidJS uses signals and effects for reactive state management:

```typescript
import { createSignal, createEffect } from 'solid-js';

// Signals for reactive state
const [count, setCount] = createSignal(0);

// Effects run when dependencies change
createEffect(() => {
  console.log('Count changed:', count());
});
```

### Component Architecture

Components are functions that return JSX. Use PascalCase for component names:

```typescript
function MyComponent(props) {
  return <div>{props.title}</div>;
}
```

### Control Flow

Use SolidJS control flow components instead of JavaScript operators:

```typescript
import { Show, For, If } from 'solid-js';

// Conditional rendering
<Show when={user()}>
  <div>Welcome, {user().name}!</div>
</Show>

// List rendering
<For each={items()}>
  {(item) => <li>{item.name}</li>}
</For>
```

## State Management

### Local State

Use `createSignal` for simple local state:

```typescript
const [isOpen, setIsOpen] = createSignal(false);
```

### Global State

Use `createStore` for complex, nested state:

```typescript
import { createStore } from 'solid-js/store';

const [store, setStore] = createStore({
  user: null,
  settings: {}
});

// Update store
setStore('user', { name: 'John' });
setStore('settings', 'theme', 'dark');
```

### Async Data

Use `createResource` for asynchronous data fetching:

```typescript
import { createResource } from 'solid-js';

const [user] = createResource(fetchUser);
```

## Performance Patterns

### Memoization

Use `createMemo` to cache computed values:

```typescript
import { createMemo } from 'solid-js';

const fullName = createMemo(() => `${firstName()} ${lastName()}`);
```

### Avoiding Unnecessary Renders

- Components only re-render when their reactive dependencies change
- Use `untrack` to read signals without creating dependencies
- Prefer `createEffect` over `onMount` for reactive side effects

### Component Composition

Break down complex components into smaller, reusable pieces:

```typescript
function UserCard(props) {
  return (
    <div class="user-card">
      <Avatar user={props.user} />
      <UserInfo user={props.user} />
    </div>
  );
}
```

## Styling

### CSS Modules

Use CSS Modules for component-scoped styles:

```typescript
// styles.module.css
.container {
  padding: 1rem;
}

// component.tsx
import styles from './styles.module.css';

function MyComponent() {
  return <div class={styles.container}>Content</div>;
}
```

### Global Styles

For app-wide styles, use `src/styles.css`.

### Theming

Leverage CSS custom properties for theming. See [Theming System](../features/THEMING.md) for details.

## Icons

Import SVG icons directly as components:

```typescript
import CloseIcon from '@assets/close.svg';

function Modal() {
  return (
    <div>
      <CloseIcon />
    </div>
  );
}
```

## Best Practices

### Avoid Direct DOM Manipulation

SolidJS handles DOM updates automatically. Avoid `document.querySelector` and similar.

### Error Boundaries

Use error boundaries for graceful error handling:

```typescript
import { ErrorBoundary } from 'solid-js';

<ErrorBoundary fallback={<div>Something went wrong</div>}>
  <MyComponent />
</ErrorBoundary>
```

### TypeScript

Use TypeScript for type safety. Define props interfaces:

```typescript
interface UserCardProps {
  user: User;
  onClick?: () => void;
}

function UserCard(props: UserCardProps) {
  // ...
}
```

### Testing

Write tests for components using Vitest and Solid Testing Library.

## Common Patterns

### Form Handling

```typescript
function LoginForm() {
  const [email, setEmail] = createSignal('');
  const [password, setPassword] = createSignal('');

  const handleSubmit = (e) => {
    e.preventDefault();
    // Handle login
  };

  return (
    <form onSubmit={handleSubmit}>
      <input
        type="email"
        value={email()}
        onInput={(e) => setEmail(e.target.value)}
      />
      <input
        type="password"
        value={password()}
        onInput={(e) => setPassword(e.target.value)}
      />
      <button type="submit">Login</button>
    </form>
  );
}
```

### Data Fetching

```typescript
function UserProfile() {
  const [user, { refetch }] = createResource(fetchUser);

  return (
    <Show when={!user.loading} fallback={<div>Loading...</div>}>
      <div>{user().name}</div>
      <button onClick={refetch}>Refresh</button>
    </Show>
  );
}
```

This guide covers the fundamental patterns used in Vesta Launcher's frontend. For more advanced topics, refer to the official SolidJS documentation.