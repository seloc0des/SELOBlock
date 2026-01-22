#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const sizes = [16, 32, 48, 128];
const iconsDir = path.join(__dirname, '..', 'icons');

const createPngPlaceholder = (size) => {
  const svg = `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#00d4ff;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#7c3aed;stop-opacity:1" />
    </linearGradient>
  </defs>
  <circle cx="${size/2}" cy="${size/2}" r="${size/2 - size/16}" fill="url(#grad)"/>
  <path d="M${size*0.3} ${size*0.5}L${size*0.42} ${size*0.62}L${size*0.7} ${size*0.35}" stroke="white" stroke-width="${size/12}" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
</svg>`;
  return svg;
};

console.log('Icon generation script');
console.log('======================');
console.log('');
console.log('To generate PNG icons, you can use one of the following methods:');
console.log('');
console.log('1. Using ImageMagick (recommended):');
sizes.forEach(size => {
  console.log(`   convert -background none icons/icon${size}.svg icons/icon${size}.png`);
});
console.log('');
console.log('2. Using Inkscape:');
sizes.forEach(size => {
  console.log(`   inkscape icons/icon${size}.svg -o icons/icon${size}.png`);
});
console.log('');
console.log('3. Use an online SVG to PNG converter');
console.log('');
console.log('For now, creating placeholder PNG data URIs in a reference file...');

const pngReference = `# Icon Reference

The extension requires PNG icons. Convert the SVG files to PNG using:

\`\`\`bash
# Using ImageMagick
for size in 16 32 48 128; do
  convert -background none icons/icon\${size}.svg icons/icon\${size}.png
done

# Or using Inkscape
for size in 16 32 48 128; do
  inkscape icons/icon\${size}.svg -o icons/icon\${size}.png
done
\`\`\`

Or use an online converter like https://svgtopng.com/
`;

fs.writeFileSync(path.join(iconsDir, 'README.md'), pngReference);
console.log('Created icons/README.md with conversion instructions');
