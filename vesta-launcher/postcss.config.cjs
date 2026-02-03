module.exports = (ctx) => ({
	parser: ctx.parser ? "sugarss" : false,
	map: ctx.env === "development" ? ctx.map : false,
	plugins: {
		autoprefixer: true,
		cssnano: {
			preset: "default",
		},
		"@csstools/postcss-contrast-color-function": {},
	},
});
