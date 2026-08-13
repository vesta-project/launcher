import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { validateLocaleDirectory } from "./validate-locales";

interface TestLocale {
	code: string;
	name: string;
	nativeName: string;
	direction: "ltr" | "rtl";
	enabled: boolean;
}

let localeRoot: string;

async function writeManifest(locales: TestLocale[]): Promise<void> {
	await writeFile(
		path.join(localeRoot, "manifest.json"),
		JSON.stringify({ sourceLocale: "en", locales }),
	);
}

async function writeCatalog(locale: string, source: string): Promise<void> {
	const directory = path.join(localeRoot, locale);
	await mkdir(directory, { recursive: true });
	await writeFile(path.join(directory, "common.ftl"), source);
}

const english: TestLocale = {
	code: "en",
	name: "English",
	nativeName: "English",
	direction: "ltr",
	enabled: true,
};

const french: TestLocale = {
	code: "fr",
	name: "French",
	nativeName: "Français",
	direction: "ltr",
	enabled: false,
};

describe("locale catalog validation", () => {
	beforeEach(async () => {
		localeRoot = await mkdtemp(path.join(tmpdir(), "vesta-locales-"));
		await writeManifest([english]);
		await writeCatalog("en", "welcome = Welcome, { $name }!\nquit = Quit\n");
	});

	afterEach(async () => {
		await rm(localeRoot, { recursive: true, force: true });
	});

	it("accepts a valid source catalog", async () => {
		const result = await validateLocaleDirectory(localeRoot);

		expect(result.failures).toEqual([]);
		expect(result.sourceMessageCount).toBe(2);
	});

	it("reports an invalid manifest shape instead of throwing", async () => {
		await writeFile(path.join(localeRoot, "manifest.json"), "[]");

		const result = await validateLocaleDirectory(localeRoot);

		expect(result.failures[0]).toContain("manifest root must be an object");
	});

	it("reports a missing source locale without reading an invalid path", async () => {
		await writeFile(
			path.join(localeRoot, "manifest.json"),
			JSON.stringify({ locales: [english] }),
		);

		const result = await validateLocaleDirectory(localeRoot);

		expect(result.failures).toContain(
			"manifest: sourceLocale must be a locale code",
		);
	});

	it("allows a disabled locale before its first Crowdin export", async () => {
		await writeManifest([english, french]);

		const result = await validateLocaleDirectory(localeRoot);

		expect(result.failures).toEqual([]);
		expect(result.summaries).toContain(
			"fr: awaiting first Crowdin export [disabled]",
		);
	});

	it("requires an enabled locale to have catalogs", async () => {
		await writeManifest([english, { ...french, enabled: true }]);

		const result = await validateLocaleDirectory(localeRoot);

		expect(result.failures).toContain("fr: locale directory is missing");
	});

	it("reports partial translation coverage without rejecting missing messages", async () => {
		await writeManifest([english, french]);
		await writeCatalog("fr", "welcome = Bonjour, { $name } !\n");

		const result = await validateLocaleDirectory(localeRoot);

		expect(result.failures).toEqual([]);
		expect(result.summaries).toContain(
			"fr: 1/2 messages (50% catalog coverage) [disabled]",
		);
	});

	it("rejects changed variables and unknown translated messages", async () => {
		await writeManifest([english, french]);
		await writeCatalog(
			"fr",
			"welcome = Bonjour, { $username } !\nunknown = Inconnu\n",
		);

		const result = await validateLocaleDirectory(localeRoot);

		expect(result.failures).toContain(
			'fr/common.ftl: message "welcome" must preserve variables { name }',
		);
		expect(result.failures).toContain(
			'fr/common.ftl: message "unknown" does not exist in the source locale',
		);
	});

	it("rejects duplicate and noncanonical locale codes", async () => {
		await writeManifest([
			english,
			{ ...french, code: "pt-br", direction: "rtl" },
			{ ...french, code: "PT-BR" },
		]);

		const result = await validateLocaleDirectory(localeRoot);

		expect(result.failures).toContain(
			'manifest: locale code "pt-br" must use canonical BCP 47 casing "pt-BR"',
		);
		expect(result.failures).toContain(
			'manifest: duplicate locale code "PT-BR"',
		);
	});

	it("reports invalid locale metadata instead of throwing", async () => {
		await writeFile(
			path.join(localeRoot, "manifest.json"),
			JSON.stringify({
				sourceLocale: "en",
				locales: [
					english,
					{
						code: "fr",
						name: 42,
						nativeName: "",
						direction: "sideways",
						enabled: "yes",
					},
				],
			}),
		);

		const result = await validateLocaleDirectory(localeRoot);

		expect(result.failures).toContain(
			'manifest: locale "fr" must have an English name',
		);
		expect(result.failures).toContain(
			'manifest: locale "fr" must have a native name',
		);
		expect(result.failures).toContain(
			'manifest: locale "fr" direction must be "ltr" or "rtl"',
		);
		expect(result.failures).toContain(
			'manifest: locale "fr" enabled must be boolean',
		);
	});

	it("rejects attribute-only messages unsupported by the runtime", async () => {
		await writeCatalog("en", "button =\n    .label = Continue\n");

		const result = await validateLocaleDirectory(localeRoot);

		expect(result.failures).toContain(
			'en/common.ftl: message "button" has no value; Vesta does not consume Fluent attributes directly',
		);
	});

	it("rejects Fluent syntax that the runtime would otherwise skip", async () => {
		await writeCatalog("en", "broken = {");

		const result = await validateLocaleDirectory(localeRoot);

		expect(
			result.failures.some((failure) =>
				failure.startsWith("en/common.ftl: invalid Fluent syntax"),
			),
		).toBe(true);
	});
});
