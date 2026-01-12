import type { JSX, ValidComponent } from "solid-js";
import { Show, splitProps } from "solid-js";
import * as PaginationPrimitive from "@kobalte/core/pagination";
import type { PolymorphicProps } from "@kobalte/core/polymorphic";
import { cn } from "@utils/ui";
import "./pagination.css";

export const PaginationItems = PaginationPrimitive.Items;

type PaginationRootProps<T extends ValidComponent = "nav"> =
  PaginationPrimitive.PaginationRootProps<T> & { class?: string | undefined };

export const Pagination = <T extends ValidComponent = "nav">(
  props: PolymorphicProps<T, PaginationRootProps<T>>
) => {
  const [local, others] = splitProps(props as PaginationRootProps, ["class"]);
  return (
    <PaginationPrimitive.Root
      class={cn("pagination-root", local.class)}
      {...others}
    />
  );
};

type PaginationItemProps<T extends ValidComponent = "button"> =
  PaginationPrimitive.PaginationItemProps<T> & { class?: string | undefined };

export const PaginationItem = <T extends ValidComponent = "button">(
  props: PolymorphicProps<T, PaginationItemProps<T>>
) => {
  const [local, others] = splitProps(props as PaginationItemProps, ["class"]);
  return (
    <PaginationPrimitive.Item
      class={cn(
        "launcher-button launcher-button--ghost pagination-item",
        local.class
      )}
      {...others}
    />
  );
};

type PaginationEllipsisProps<T extends ValidComponent = "div"> =
  PaginationPrimitive.PaginationEllipsisProps<T> & {
    class?: string | undefined;
  };

export const PaginationEllipsis = <T extends ValidComponent = "div">(
  props: PolymorphicProps<T, PaginationEllipsisProps<T>>
) => {
  const [local, others] = splitProps(props as PaginationEllipsisProps, ["class"]);
  return (
    <PaginationPrimitive.Ellipsis
      class={cn("pagination-ellipsis", local.class)}
      {...others}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        class="size-4"
      >
        <circle cx="12" cy="12" r="1" />
        <circle cx="19" cy="12" r="1" />
        <circle cx="5" cy="12" r="1" />
      </svg>
      <span class="sr-only">More pages</span>
    </PaginationPrimitive.Ellipsis>
  );
};

type PaginationPreviousProps<T extends ValidComponent = "button"> =
  PaginationPrimitive.PaginationPreviousProps<T> & {
    class?: string | undefined;
    children?: JSX.Element;
  };

export const PaginationPrevious = <T extends ValidComponent = "button">(
  props: PolymorphicProps<T, PaginationPreviousProps<T>>
) => {
  const [local, others] = splitProps(props as PaginationPreviousProps, ["class", "children"]);
  return (
    <PaginationPrimitive.Previous
      class={cn(
        "launcher-button launcher-button--ghost pagination-nav-btn",
        local.class
      )}
      {...others}
    >
      <Show
        when={local.children}
        fallback={
          <>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              class="size-4"
            >
              <path d="M15 6l-6 6l6 6" />
            </svg>
            <span>Previous</span>
          </>
        }
      >
        {(children) => children()}
      </Show>
    </PaginationPrimitive.Previous>
  );
};

type PaginationNextProps<T extends ValidComponent = "button"> =
  PaginationPrimitive.PaginationNextProps<T> & {
    class?: string | undefined;
    children?: JSX.Element;
  };

export const PaginationNext = <T extends ValidComponent = "button">(
  props: PolymorphicProps<T, PaginationNextProps<T>>
) => {
  const [local, others] = splitProps(props as PaginationNextProps, ["class", "children"]);
  return (
    <PaginationPrimitive.Next
      class={cn(
        "launcher-button launcher-button--ghost pagination-nav-btn",
        local.class
      )}
      {...others}
    >
      <Show
        when={local.children}
        fallback={
          <>
            <span>Next</span>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              class="size-4"
            >
              <path d="M9 6l6 6l-6 6" />
            </svg>
          </>
        }
      >
        {(children) => children()}
      </Show>
    </PaginationPrimitive.Next>
  );
};
