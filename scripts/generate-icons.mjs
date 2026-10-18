// Renders the plugin's static PNG assets from inline SVG. Run with `npm run icons`.
import { mkdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = path.resolve(import.meta.dirname, "../com.wyntersoft.gitlabci.sdPlugin/imgs");

// A pipeline glyph: three stage nodes joined by a line, the last one a check mark.
const pipelineGlyph = (color) => `
	<path d="M30 72 H114" stroke="${color}" stroke-width="8" stroke-linecap="round"/>
	<circle cx="30" cy="72" r="16" fill="${color}"/>
	<circle cx="72" cy="72" r="16" fill="${color}"/>
	<circle cx="114" cy="72" r="20" fill="${color}"/>
	<path d="M105 72 L112 79 L124 65" fill="none" stroke="#108548" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`;

const monochrome = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 144 144">
	<path d="M30 72 H114" stroke="#FFFFFF" stroke-width="10" stroke-linecap="round"/>
	<circle cx="30" cy="72" r="18" fill="#FFFFFF"/>
	<circle cx="72" cy="72" r="18" fill="#FFFFFF"/>
	<circle cx="114" cy="72" r="22" fill="#FFFFFF"/>
</svg>`;

const branded = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 144 144">
	<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
		<stop offset="0" stop-color="#3A2A7A"/><stop offset="1" stop-color="#1F75CB"/>
	</linearGradient></defs>
	<rect width="144" height="144" rx="28" fill="url(#bg)"/>
	${pipelineGlyph("#FFFFFF")}
</svg>`;

const key = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 144 144">
	<rect width="144" height="144" fill="#2B2B2B"/>
	${pipelineGlyph("#FFFFFF")}
</svg>`;

const assets = [
	{ file: "plugin/marketplace", svg: branded, size: 256 },
	{ file: "plugin/marketplace@2x", svg: branded, size: 512 },
	{ file: "plugin/category-icon", svg: monochrome, size: 28 },
	{ file: "plugin/category-icon@2x", svg: monochrome, size: 56 },
	{ file: "actions/pipeline/icon", svg: monochrome, size: 20 },
	{ file: "actions/pipeline/icon@2x", svg: monochrome, size: 40 },
	{ file: "actions/pipeline/key", svg: key, size: 72 },
	{ file: "actions/pipeline/key@2x", svg: key, size: 144 },
];

for (const { file, svg, size } of assets) {
	const out = path.join(root, `${file}.png`);
	await mkdir(path.dirname(out), { recursive: true });
	await sharp(Buffer.from(svg), { density: 72 * (size / 144) * 4 }).resize(size, size).png().toFile(out);
	console.log(`${file}.png (${size}x${size})`);
}
