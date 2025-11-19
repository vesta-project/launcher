module.exports = (ctx) => ({
	parser: ctx.parser ? "sugarss" : false,
	map: ctx.env === "development" ? ctx.map : false,
	plugins: {
		autoprefixer: true,
		cssnano: {
			preset: "default",
		},
		"postcss-contrast": {
			light: "hsl(0, 0%, 80%)",
			dark: "hsl(0, 0%, 10%)",
		},
	},
});
