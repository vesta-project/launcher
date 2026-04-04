import type { ThemeConfig } from "../types";

/**
 * Built-in theme presets
 * These are curated themes with pre-tested contrast and accessibility
 */
export const PRESET_THEMES: ThemeConfig[] = [
	{
		id: "vesta",
		name: "Vesta",
		description: "Signature teal to purple to orange gradient",
		primaryHue: 180,
		opacity: 0,
		borderWidth: 1,
		style: "glass",
		gradientEnabled: true,
		rotation: 180,
		gradientType: "linear",
		gradientHarmony: "triadic",
		customCss: `
            :root {
                --theme-bg-gradient: linear-gradient(180deg, hsl(180 100% 50%), hsl(280 100% 25%), hsl(35 100% 50%));
            }
        `,
		allowHueChange: false, // Locked to signature colors
		allowStyleChange: false,
		allowBorderChange: false,
	},
	{
		id: "solar",
		name: "Solar",
		description: "Signature warm orange satin with solid background",
		primaryHue: 40,
		opacity: 50,
		borderWidth: 1,
		style: "satin",
		gradientEnabled: false,
		allowHueChange: false, // Locked to signature orange
		allowStyleChange: false,
		allowBorderChange: false,
	},
	{
		id: "neon",
		name: "Neon",
		description: "Signature electric pink glass with vibrant gradient",
		primaryHue: 300,
		opacity: 0,
		borderWidth: 1,
		style: "glass",
		gradientEnabled: true,
		rotation: 135,
		gradientType: "linear",
		gradientHarmony: "complementary",
		allowHueChange: false, // Locked to signature pink
		allowStyleChange: false,
		allowBorderChange: false,
	},
	{
		id: "classic",
		name: "Classic",
		description: "Clean customizable theme - Maximum accessibility",
		primaryHue: 210,
		opacity: 100,
		borderWidth: 1,
		style: "flat",
		gradientEnabled: false,
		allowHueChange: true, // Customizable
		allowStyleChange: false,
		allowBorderChange: false,
	},
	{
		id: "forest",
		name: "Forest",
		description: "Signature natural green with subtle glass effect",
		primaryHue: 140,
		opacity: 50,
		borderWidth: 1,
		style: "satin",
		gradientEnabled: true,
		rotation: 90,
		gradientType: "linear",
		gradientHarmony: "analogous",
		allowHueChange: false, // Locked to signature green
		allowStyleChange: false,
		allowBorderChange: false,
	},
	{
		id: "sunset",
		name: "Sunset",
		description: "Signature warm gradient from purple to orange",
		primaryHue: 270,
		opacity: 0,
		borderWidth: 1,
		style: "glass",
		gradientEnabled: true,
		rotation: 180,
		gradientType: "linear",
		gradientHarmony: "triadic",
		allowHueChange: false, // Locked to signature purple/orange
		allowStyleChange: false,
		allowBorderChange: false,
	},
	// {
	// 	id: "prism",
	// 	name: "Prism",
	// 	description: "Technicolor glass with reactive variables",
	// 	author: "Vesta Team",
	// 	primaryHue: 200,
	// 	opacity: 20,
	// 	borderWidth: 1,
	// 	style: "glass",
	// 	gradientEnabled: true,
	// 	rotation: 45,
	// 	gradientType: "linear",
	// 	gradientHarmony: "triadic",
	// 	allowHueChange: true,
	// 	allowStyleChange: false,
	// 	allowBorderChange: false,
	// 	variables: [
	// 		{
	// 			name: "Glow Intensity",
	// 			key: "glow-intensity",
	// 			type: "number",
	// 			min: 0,
	// 			max: 100,
	// 			default: 50,
	// 			unit: "%",
	// 		},
	// 		{
	// 			name: "Glass Blur",
	// 			key: "glass-blur",
	// 			type: "number",
	// 			min: 0,
	// 			max: 40,
	// 			default: 12,
	// 			unit: "px",
	// 		},
	// 		{
	// 			name: "Edge Sharpness",
	// 			key: "edge-sharpness",
	// 			type: "number",
	// 			min: 0,
	// 			max: 100,
	// 			default: 50,
	// 			unit: "%",
	// 		},
	// 	],
	// 	customCss: `
	//         :root {
	//             --effect-glow-strength: calc(var(--theme-var-glow-intensity) / 100);
	//             --glass-blur-radius: calc(var(--theme-var-glass-blur) * 1px);
	//             --border-opacity: calc(var(--theme-var-edge-sharpness) / 100);

	//             --liquid-backdrop-filter: blur(var(--glass-blur-radius)) saturate(1.5);
	//             --effect-blur: var(--glass-blur-radius);
	//             --effect-shadow: 0 8px 32px 0 rgba(var(--primary-base), calc(0.3 * var(--effect-glow-strength)));
	//             --border-glass: hsl(var(--color__primary-hue) 100% 100% / var(--border-opacity));
	//             --background-opacity: 0.15;
	//         }
	//     `,
	// },
	{
		id: "midnight",
		name: "Midnight",
		description:
			"Ultra-dark Midnight mode — pure black surfaces for true blacks",
		primaryHue: 240, // Dark blue for midnight theme preview
		opacity: 100,
		borderWidth: 0,
		style: "solid",
		colorScheme: "dark",
		gradientEnabled: false,
		allowHueChange: true, // Allow hue change for accents
		allowStyleChange: false,
		allowBorderChange: false,
		customCss: `:root {
            /* Force truly black surfaces for Midnight panels using the computed variables */
            --surface-base-computed: hsl(0 0% 0%);
            --surface-raised-computed: hsl(0 0% 2%);
            --surface-overlay-computed: hsl(0 0% 3%);
            --surface-sunken-computed: hsl(0 0% 0%);

            /* Midnight palette overrides */
            --text-primary: hsl(0 0% 100%);
            --text-secondary: hsl(0 0% 70%);
            --text-tertiary: hsl(0 0% 50%);
            --text-disabled: hsl(0 0% 30%);

            /* Accent mapping (Primary hue is maintained from config) */
            --accent-primary: hsl(var(--color__primary-hue) 50% 50%);
            --accent-primary-hover: hsl(var(--color__primary-hue) 60% 60%);
            --interactive-base: hsl(var(--color__primary-hue) 50% 50%);
            --interactive-hover: hsl(var(--color__primary-hue) 60% 60%);

            /* Refined borders for true black look */
            --border-subtle: hsl(var(--color__primary-hue) 10% 15% / 0.5);
            --border-strong: hsl(var(--color__primary-hue) 15% 25% / 0.7);
            --border-glass: hsl(var(--color__primary-hue) 10% 20% / 0.3);

            /* Liquid glass adjustments for Midnight */
            --liquid-tint-saturation: 0%;
            --liquid-tint-lightness: 0%;
            --liquid-background: hsl(0 0% 0% / var(--liquid-tint-opacity));
            --liquid-backdrop-filter: none;
            --effect-blur: 0px;
            --glass-blur: none;

            /* Midnight-optimized shadows */
            --liquid-box-shadow: 0 4px 12px hsl(0 0% 0% / 0.8);
            --effect-shadow: 0 12px 40px rgba(0, 0, 0, 0.9);
            --effect-shadow-depth: 2px;
        }

            /* Specific Midnight styling for containers */
            [class*="page-viewer-root"],
            [data-popper-positioner] > div {
                border: 1px solid hsl(var(--color__primary-hue) 50% 25% / 0.6) !important;
                position: relative;
            }

            [class*="page-viewer-root"]::before,
            [data-popper-positioner] > div::before {
                content: "";
                position: absolute;
                inset: 0;
                border-radius: inherit;
                border: 1px solid hsl(var(--color__primary-hue) 50% 40% / 0.1);
                pointer-events: none;
            }
        `,
	},
	{
		id: "oldschool",
		name: "Old School",
		description: "Classic customizable design with strong borders",
		primaryHue: 210,
		opacity: 100,
		borderWidth: 2,
		style: "bordered",
		gradientEnabled: false,
		allowHueChange: true, // Customizable
		allowStyleChange: false,
		allowBorderChange: false,
	},
	{
		id: "custom",
		name: "Custom",
		description: "Unlock all controls to craft your own theme",
		primaryHue: 220,
		opacity: 0,
		borderWidth: 1,
		style: "glass",
		gradientEnabled: true,
		rotation: 135,
		gradientType: "linear",
		gradientHarmony: "none",
		allowHueChange: true,
		allowStyleChange: true,
		allowBorderChange: true,
	},
];
