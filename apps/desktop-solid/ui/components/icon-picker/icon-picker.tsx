import type { JSX } from "@solidjs/web";
import { For, Show, createSignal } from "solid-js";
import { AddGlyph, CheckGlyph, EditGlyph } from "../../internal/icons";
import { Popover } from "../popover/popover";
import "./icon-picker.css";

export interface IconPickerOption {
  value: string;
  src: string;
  label: string;
  badge?: JSX.Element;
}
export interface IconPickerProps {
  value: string;
  options: IconPickerOption[];
  preview: string;
  onSelect: (value: string) => void;
  onUpload?: (file: File) => void;
}

/** Port of Vesta's icon grid, with assets and upload policy supplied by its host. */
export function IconPicker(props: IconPickerProps) {
  const [open, setOpen] = createSignal(false);
  let input: HTMLInputElement | undefined;
  return (
    <>
      <Popover
        open={open()}
        onOpenChange={setOpen}
        title="Choose icon"
        class="ui-icon-picker-popover"
        trigger={(triggerProps) => (
          <button
            {...triggerProps}
            type="button"
            data-vesta="icon-picker-trigger"
            aria-label="Change instance icon"
          >
            <img src={props.preview} alt="" />
            <span data-vesta="icon-picker-edit" aria-hidden="true">
              <EditGlyph />
            </span>
          </button>
        )}
      >
        <div data-vesta="icon-picker-grid">
          <Show when={props.onUpload}>
            <button
              type="button"
              data-vesta="icon-picker-upload"
              aria-label="Upload icon"
              onClick={() => {
                setOpen(false);
                input?.click();
              }}
            >
              <AddGlyph />
            </button>
          </Show>
          <For each={props.options} keyed={(option) => option.value}>
            {(option) => (
              <button
                type="button"
                data-vesta="icon-picker-option"
                aria-label={option().label}
                aria-pressed={props.value === option().value ? "true" : "false"}
                onClick={() => {
                  if (props.value !== option().value) props.onSelect(option().value);
                  setOpen(false);
                }}
              >
                <img src={option().src} alt="" loading="lazy" />
                <Show when={props.value === option().value}>
                  <span data-vesta="icon-picker-check">
                    <CheckGlyph />
                  </span>
                </Show>
                <Show when={option().badge}>
                  <span data-vesta="icon-picker-badge">{option().badge}</span>
                </Show>
              </button>
            )}
          </For>
        </div>
      </Popover>
      <input
        ref={(element) => {
          input = element;
        }}
        type="file"
        accept="image/*"
        hidden
        aria-label="Upload instance icon"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) props.onUpload?.(file);
        }}
      />
    </>
  );
}
