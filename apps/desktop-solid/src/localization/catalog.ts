import {
  FluentBundle,
  FluentResource,
  type FluentVariable,
} from "@fluent/bundle";

export type TranslationArgs = Record<string, FluentVariable>;

export function createFluentBundle(
  locale: string,
  sources: readonly string[],
): FluentBundle {
  const bundle = new FluentBundle(locale, { useIsolating: true });
  for (const source of sources) {
    const errors = bundle.addResource(new FluentResource(source));
    if (errors.length > 0) {
      throw new Error(`Invalid Fluent catalog for ${locale}: ${errors.join("; ")}`);
    }
  }
  return bundle;
}

export function formatMessage(
  bundle: FluentBundle | undefined,
  messageId: string,
  args?: TranslationArgs,
): string | undefined {
  if (!bundle) return undefined;
  const fluentId = messageId.replaceAll(".", "-");
  const message = bundle.getMessage(fluentId);
  if (!message?.value) return undefined;

  const errors: Error[] = [];
  const value = bundle.formatPattern(message.value, args, errors);
  return errors.length > 0 ? undefined : value;
}

export function formatLocalizedMessage(
  active: FluentBundle | undefined,
  fallback: FluentBundle | undefined,
  messageId: string,
  args?: TranslationArgs,
): string {
  return (
    formatMessage(active, messageId, args) ??
    formatMessage(fallback, messageId, args) ??
    messageId
  );
}
