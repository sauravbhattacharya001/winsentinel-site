#!/usr/bin/env node
/**
 * Generate OG images (PNG) from SVG templates in /og/ directory.
 *
 * Prerequisites: npm install sharp
 * Usage: node scripts/generate-og-images.js
 *
 * Outputs PNG files alongside SVGs (og/default.png, og/pricing.png, etc.)
 * These PNGs are what og:image meta tags reference.
 */

const fs = require('fs');
const path = require('path');

async function main() {
  let sharp;
  try {
    sharp = require('sharp');
  } catch {
    console.error('ERROR: sharp not installed. Run: npm install sharp');
    process.exit(1);
  }

  const ogDir = path.join(__dirname, '..', 'og');
  const svgs = fs.readdirSync(ogDir).filter(f => f.endsWith('.svg'));

  for (const svg of svgs) {
    const input = path.join(ogDir, svg);
    const output = path.join(ogDir, svg.replace('.svg', '.png'));
    await sharp(input)
      .resize(1200, 630)
      .png({ quality: 90 })
      .toFile(output);
    console.log(`✓ ${svg} → ${svg.replace('.svg', '.png')}`);
  }

  console.log(`\nDone. ${svgs.length} OG images generated.`);
  console.log('Commit the .png files and deploy.');
}

main().catch(e => { console.error(e); process.exit(1); });
