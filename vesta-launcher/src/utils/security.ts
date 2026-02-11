/**
 * Basic SVG sanitizer to prevent XSS when using innerHTML with SVGs from external sources.
 * Removes script tags and on* event handlers.
 */
export function sanitizeSvg(svg: string): string {
	if (!svg) return "";

	try {
		const parser = new DOMParser();
		const doc = parser.parseFromString(svg, "image/svg+xml");

		// Handle parsing errors
		if (doc.getElementsByTagName("parsererror").length > 0) {
			console.error("SVG parsing error during sanitization");
			return "";
		}

		const scripts = doc.querySelectorAll("script");
		for (const s of scripts) {
			s.remove();
		}

		const allElements = doc.querySelectorAll("*");
		for (const el of allElements) {
			const attrs = el.attributes;
			for (let i = attrs.length - 1; i >= 0; i--) {
				const attrName = attrs[i].name.toLowerCase();
				// Remove event handlers (onmouseover, onclick, etc)
				if (attrName.startsWith("on")) {
					el.removeAttribute(attrs[i].name);
				}
				// Sanitize links to prevent executable URIs
				if (attrName === "href" || attrName === "xlink:href") {
					const value = el.getAttribute(attrs[i].name);
					const normalized = value?.trim().toLowerCase();
					if (
						normalized?.startsWith("javascript:") ||
						normalized?.startsWith("data:") ||
						normalized?.startsWith("vbscript:")
					) {
						el.removeAttribute(attrs[i].name);
					}
				}
			}
		}

		return doc.documentElement.outerHTML;
	} catch (e) {
		console.error("Failed to sanitize SVG:", e);
		return "";
	}
}
