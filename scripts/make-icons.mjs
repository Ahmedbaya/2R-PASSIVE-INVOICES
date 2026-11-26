// Generates every icon and image from YOUR logo.
//
// Usage:
//   npm run icons                          -> uses build/logo.png (or any file starting with "logo")
//   npm run icons -- "C:\path\to\logo.png" -> uses that file (copied to build/logo.png first)
import sharp from 'sharp'
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const buildDir = join(root, 'build')
mkdirSync(buildDir, { recursive: true })

const IMAGE_EXT = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.tif', '.tiff', '.avif']
const args = process.argv.slice(2)
const allowPlaceholder = args.includes('--placeholder')
const pathArg = args.find((a) => !a.startsWith('--'))

// Looks for a file whose name starts with "logo" in the build folder or the project folder
function findOwnLogo() {
  const found = []
  for (const folder of [buildDir, root]) {
    for (const name of readdirSync(folder)) {
      if (!/^logo/i.test(name)) continue
      if (!IMAGE_EXT.includes(extname(name).toLowerCase())) continue
      const full = join(folder, name)
      const stat = statSync(full)
      if (stat.isFile()) found.push({ full, time: stat.mtimeMs })
    }
  }
  found.sort((a, b) => b.time - a.time) // the most recently modified wins
  return found.length > 0 ? found[0].full : null
}

let source = null

if (pathArg) {
  const p = resolve(pathArg)
  if (!existsSync(p)) {
    console.error('\nFile not found: ' + p)
    process.exit(1)
  }
  try {
    const png = await sharp(p).png().toBuffer()
    source = join(buildDir, 'logo.png')
    writeFileSync(source, png)
    console.log('Your logo was copied to ' + source)
  } catch (e) {
    console.error('\nCould not read this image: ' + p + '\n' + e.message)
    process.exit(1)
  }
} else {
  source = findOwnLogo()
}

if (!source) {
  const placeholder = join(buildDir, 'logo.svg')
  if (allowPlaceholder && existsSync(placeholder)) {
    source = placeholder
    console.warn('\nWARNING: using the PLACEHOLDER logo, not your own.')
  } else {
    console.error('\nYOUR LOGO WAS NOT FOUND.')
    console.error('Files in the build folder: ' + (readdirSync(buildDir).join(', ') || '(empty)'))
    console.error('Either save your logo as build\\logo.png, or run:')
    console.error('  npm run icons -- "C:\\full\\path\\to\\your-logo.png"')
    process.exit(1)
  }
}

const meta = await sharp(source).metadata()
console.log(`Logo used: ${source} (${meta.width}x${meta.height} px)`)
if ((meta.width ?? 0) < 256 || (meta.height ?? 0) < 256) {
  console.warn('Note: this logo is small. 512x512 pixels or more gives sharper icons.')
}

const transparent = { r: 0, g: 0, b: 0, alpha: 0 }
const render = (size) =>
  sharp(source, { density: 288 })
    .resize(size, size, { fit: 'contain', background: transparent })
    .png()
    .toBuffer()

// An .ico file is a small header plus PNG images (this is how modern Windows icons are stored)
function makeIco(images) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2) // 1 = icon
  header.writeUInt16LE(images.length, 4)

  const dir = Buffer.alloc(16 * images.length)
  let offset = 6 + 16 * images.length
  images.forEach((img, i) => {
    const o = i * 16
    const dim = img.size >= 256 ? 0 : img.size // 0 means 256
    dir.writeUInt8(dim, o)
    dir.writeUInt8(dim, o + 1)
    dir.writeUInt8(0, o + 2)
    dir.writeUInt8(0, o + 3)
    dir.writeUInt16LE(1, o + 4)
    dir.writeUInt16LE(32, o + 6)
    dir.writeUInt32LE(img.data.length, o + 8)
    dir.writeUInt32LE(offset, o + 12)
    offset += img.data.length
  })
  return Buffer.concat([header, dir, ...images.map((i) => i.data)])
}

// The Windows installer wizard only accepts .bmp images (24-bit, no transparency)
function makeBmp(width, height, rgb) {
  const rowSize = Math.ceil((width * 3) / 4) * 4
  const pixelSize = rowSize * height
  const buf = Buffer.alloc(54 + pixelSize)
  buf.write('BM', 0)
  buf.writeUInt32LE(54 + pixelSize, 2)
  buf.writeUInt32LE(54, 10)
  buf.writeUInt32LE(40, 14)
  buf.writeInt32LE(width, 18)
  buf.writeInt32LE(height, 22)
  buf.writeUInt16LE(1, 26)
  buf.writeUInt16LE(24, 28)
  buf.writeUInt32LE(pixelSize, 34)
  buf.writeInt32LE(2835, 38)
  buf.writeInt32LE(2835, 42)
  for (let y = 0; y < height; y++) {
    const src = (height - 1 - y) * width * 3 // BMP rows are stored bottom to top
    const dst = 54 + y * rowSize
    for (let x = 0; x < width; x++) {
      buf[dst + x * 3] = rgb[src + x * 3 + 2] // blue
      buf[dst + x * 3 + 1] = rgb[src + x * 3 + 1] // green
      buf[dst + x * 3 + 2] = rgb[src + x * 3] // red
    }
  }
  return buf
}

async function toBmp(pipeline) {
  const { data, info } = await pipeline
    .flatten({ background: '#ffffff' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  return makeBmp(info.width, info.height, data)
}

for (const dir of [join(root, 'resources'), join(root, 'src/renderer/src/assets')]) {
  mkdirSync(dir, { recursive: true })
}

// 1. Windows icon (installer, .exe, shortcuts)
const icoImages = []
for (const size of [16, 24, 32, 48, 64, 128, 256]) {
  icoImages.push({ size, data: await render(size) })
}
writeFileSync(join(buildDir, 'icon.ico'), makeIco(icoImages))

// 2. PNG icon (window icon)
const png512 = await render(512)
writeFileSync(join(buildDir, 'icon.png'), png512)
writeFileSync(join(root, 'resources', 'icon.png'), png512)

// 3. Logo shown inside the app, in the PDF reports and in the Excel export (embedded in the code)
const logo = await render(192)
writeFileSync(
  join(root, 'src/renderer/src/assets/logo.ts'),
  `// Generated by scripts/make-icons.mjs. Do not edit by hand.\n` +
    `export const LOGO = 'data:image/png;base64,${logo.toString('base64')}'\n`
)

// 4. Installer wizard images (light backgrounds, so any logo stays visible)
const sidebarSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="164" height="314">' +
  '<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">' +
  '<stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#cbd5e1"/>' +
  '</linearGradient></defs><rect width="164" height="314" fill="url(#g)"/></svg>'
writeFileSync(
  join(buildDir, 'installerSidebar.bmp'),
  await toBmp(sharp(Buffer.from(sidebarSvg)).composite([{ input: await render(128), left: 18, top: 48 }]))
)
writeFileSync(
  join(buildDir, 'installerHeader.bmp'),
  await toBmp(
    sharp({ create: { width: 150, height: 57, channels: 3, background: '#ffffff' } }).composite([
      { input: await render(47), left: 98, top: 5 }
    ])
  )
)

console.log('\nDone. Icons, installer images and the in-app logo were regenerated from your logo.')