# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Instructions for Claude

You are my web designer and front-end developer for this website.

Your goal is to maintain an elevated, editorial aesthetic while making clean, maintainable code changes. Every edit must preserve existing functionality and align with the established design philosophy.

Before writing ANY code: read this file, understand the design intent, and state your reasoning. If something conflicts with the brand or could break existing functionality, stop and ask.

RULES:

NEVER:
- Rewrite working code unnecessarily
- Remove code without checking what depends on it
- Make changes that affect the navigation system without verifying integrity
- Create generic-looking designs
- Assume — ask if unclear

ALWAYS:
- State what file you're editing and why BEFORE making changes
- Preserve the elevated, non-generic aesthetic
- Test that navigation still works after layout changes
- Suggest committing after successful changes
- If a request is unclear, ask for clarification or request a screenshot

## Project Context

**Client**: Nick Mason Construction Co.
**Scope**: $10-15k professional website, includes travel for photography/videography at construction sites
**Partner**: Kelly (collaborating on this project)

### Design Philosophy
- **Primary inspiration**: Chandelier Creative (minimal, clean) and Walker Warner Architects ("live" photo effects)
- **Aesthetic goal**: Elevated lifestyle-brand feel - elegant, simple, exclusive
- **Anti-goal**: Must NOT look like a typical contractor website or use generic templates (why we chose custom HTML/CSS/JS over WordPress/Squarespace)

### Brand Identity
- **Logo**: SVG at `assets/logo/nick-mason-logo.svg` — optimized from brand identity .ai file (page 2)
- **Brand name**: "Nick Mason Construction Co." (NOT "Inc." — confirmed with client)
- The logo is purely typographic — "NICK MASON" bold condensed + "CONSTRUCTION CO." refined serif
- Nav uses `filter: invert(1)` for white logo over dark backgrounds

### Video Hosting
- Videos hosted on Cloudinary (account: dylwzl4vu) to avoid Netlify bandwidth costs
- Hero video loops are pulled from Cloudinary URLs

### Known Patterns
- **Navigation color changes**: Inline scripts (not main.js) handle white logo/text over images → black over white backgrounds. Any layout changes must preserve this behavior.
- **Nav scroll behavior**: On project pages (`.project-page`), nav slides up on scroll-down and reappears on scroll-up (0.8s transition). On index.html, nav stays fixed.
- **Code integrity**: When making changes, verify existing functionality (especially nav scripts) still works. Past issues have occurred when updates broke the navigation system.
- **Page transition events**: Use `pageshow` event instead of `DOMContentLoaded` for fade-in transitions to ensure animations fire when using browser back/forward buttons (bfcache compatibility).
- **Crew strip / grey band**: `.crew-strip-about` is a Walker-Warner-style section-break band with background `#ebeae5`, padding `var(--space-lg)` top/bottom, and a centered "Behind the Build" title (`.crew-strip-title`) in Barlow Condensed 500, 0.25em letter-spacing, uppercase, muted color. Future band sections should reuse this visual pattern.
- **Auto-scroll marquee — eased velocity model**: The crew strip uses a continuous eased-velocity approach (`VELOCITY_EASING = 0.04`, baseline `0.35 px/tick`). Wheel/trackpad input blends with the baseline; there is no hard pause on hover. Touch still pauses; arrow-click cooldown is 600ms. If adding more scrolling strip components, match this pattern rather than using hard on/off state.
- **Lazy-loading in high-image-count strips**: Authored `<img>` tags in marquees or long galleries must carry `loading="lazy" decoding="async"`. `cloneNode(true)` propagates these attributes to duplicates automatically. The auto-scroll recalc already listens for `load` events so `halfWidth` updates as images stream in.
- **Copy voice for project pages**: Grounded and concrete, no em dashes in body copy, no attribution. Let images inspire. Reflect Nick's hands-on approach, materials sourcing, and repurposing habit. Opening quotes set scene and mood; mid-gallery quotes zoom into a single material detail or decision. No sentimentality.

### Visual Verification Tool
- **playwright-cli** (`@playwright/cli`) is the preferred tool for visual verification — more token-efficient than Playwright MCP, supports command chaining, and includes video recording
- Installed globally via npm. Output directories (`.playwright-cli/`, `.playwright-mcp/`) are gitignored
- Playwright MCP is still available as fallback but playwright-cli is preferred
- Decision: Impeccable (AI design guidance) and awesome-design-md (brand design files) were evaluated and NOT adopted — CLAUDE.md already provides tailored guardrails for this project

### Image Pipeline
- **NEVER re-process images with ImageMagick** — this caused quality degradation (darker, worse colors) in early iterations
- User exports from Lightroom: JPEG, sRGB, quality 85-90, long edge 2400px, screen sharpening
- Images go directly from Lightroom → `web/` folders → git → deploy
- No auto-orient, no color space conversion, no resizing by Claude

### Gallery Layout Types
- **full**: Single full-width image (`gallery-item full`)
- **overlap**: Two images overlapping Walker Warner style (`gallery-overlap`, add `reverse` for reversed offset)
- **trio**: Three images in a row (`gallery-trio`)
- **pair**: Two images side by side (`gallery-pair`)
- **collage**: Freeform positioned images (`gallery-collage` with absolute positioning, percentage-based for responsive)
- All collapse to single-column on mobile

---

## Project Overview

This is a static website for Nick Mason Construction Co., built with vanilla HTML, CSS, and JavaScript. The site features a clean, editorial design inspired by architecture/construction portfolio sites like Chandelier Creative and Walker Warner.

## Development Workflow

### Preview & Development
- **Open in browser**: Simply open `index.html` in a browser to preview the site
- **No build step**: This is a static site with no compilation or bundling required

### Deployment
- **Platform**: Netlify (auto-deploys from main branch)
- **Process**: Push to `main` branch triggers automatic deployment

## Architecture & Structure

### Core Files
- `index.html` - Landing page with hero video, project grid, quote, about/contact
- `el-monte.html` - El Monte project page (hero video + gallery)
- `la-marina.html` - La Marina project page
- `pomar-lane.html` - Pomar Lane project page
- `crew.html` - Crew page with collage layout
- `css/styles.css` - Complete styling system with CSS custom properties
- `js/main.js` - Minimal JavaScript (currently unused, reserved for future interactivity)
- `assets/logo/nick-mason-logo.svg` - Optimized SVG logo
- `images/projects/{slug}/web/` - Web-optimized project photos (Lightroom exports)
- `images/crew/web/` - Crew photos
- `images/construction/web/` - Construction-phase photos
- `tools/layout-editor/` - Freeform drag-and-drop layout editor (dev tool)

### Navigation Color System
The navigation has a dynamic color-switching system implemented via inline script in `index.html:154-186`:
- **Light mode** (`.nav-light`): White text with shadow - used over hero video and project images
- **Dark mode** (`.nav-dark`): Black text - used over quote section, about section, and footer
- **Trigger**: Scroll position relative to `.quote-section` determines the state
- The script is inline at the bottom of `index.html` (not in `main.js`)

### CSS Architecture
The stylesheet uses a logical section-based organization:
1. **CSS Custom Properties** (`styles.css:5-27`) - All design tokens (colors, fonts, spacing)
2. **Reset & Base** - Global resets and defaults
3. **Component sections** - Navigation, Hero, Projects Grid, Quote, About, Footer
4. **Responsive** - Mobile overrides at bottom

Key design patterns:
- **Font system**: Three fonts - Barlow Condensed (display), Cormorant Garamond (serif), IBM Plex Sans (body)
- **Grid layout**: Projects use CSS Grid with masonry-style layout (2 columns desktop, 1 column mobile)
- **Transitions**: Custom easing function `cubic-bezier(0.22, 1, 0.36, 1)` for smooth animations
- **Responsive images**: Use `object-fit: cover` for consistent aspect ratios

### Project Grid
- **Layout**: CSS Grid with 2 columns (`styles.css:182-187`)
- **Masonry effect**: Items with class `.tall` span 2 rows for visual variety
- **Hover states**: Images scale slightly, overlay info appears with slide-up animation
- **Mobile**: Collapses to single column, tall items become normal aspect ratio

### Adding New Projects
To add a project to the grid, copy the `<article class="project-item">` structure in `index.html:47-53`:
```html
<article class="project-item">
    <img src="images/project_XX.jpg" alt="Project">
    <div class="project-info">
        <h3 class="project-title">Project Name</h3>
        <span class="project-location">Location, State</span>
    </div>
</article>
```
- Add `.tall` class to make an item span 2 rows
- Place images in `images/` directory
- Grid automatically handles layout

### Design Customization
- **Colors**: Edit CSS custom properties at `styles.css:5-11`
- **Fonts**: Update Google Fonts link in `index.html:9-11` and variables in `styles.css:12-15`
- **Spacing**: Modify spacing scale at `styles.css:17-22`

---

## Studio (freeform visual editor)

A hosted, Miro-style editor for the portfolio page at `/studio/` (noindexed). Owner + Kelly log in with a shared passphrase and edit the page as one freeform canvas: click to select, drag to move (with snap guides), corner handles for proportional resize, side handles to stretch, double-click to adjust crop, marquee to multi-select and group-move, toolbar for z-order/delete, drag photos or videos in from the tray. Publish commits `portfolio.html` to GitHub via a Netlify Function and auto-deploys; the publish dialog has a Notes field that lands in the commit message (Claude reads these when asked to polish a layout).

- **Architecture**: static SPA (`studio/`) + two zero-dependency Netlify Functions (`netlify/functions/studio-*.mjs`). Canvas is a same-origin iframe built from `srcdoc` (GitHub source, scripts stripped).
- **Freeform format**: the gallery region is one `.ff-canvas` (aspect-ratio container) of absolutely-positioned `.ff-frame` figures with percentage geometry. Exact width-unit geometry rides in `data-ff` attributes so serialization is idempotent (`studioDebug.roundTrip().ok`). The region is self-contained (own `<style>`, including ≤767px stacking in reading order) — styles.css untouched.
- **Legacy migration**: if the gallery is still in the old hand-written grammar, first open measures the rendered layout at forced desktop width and converts it pixel-faithfully to frames; first publish rewrites the region in ff format. When hand-editing portfolio.html after that, keep the ff-canvas structure (or let Studio own it).
- **Publish safety**: server re-fetches the file, strict full-line anchors, region-hash 409 on two-editor conflict, splice-only-the-region, sanity checks, `dryRun` support. Any bad publish is one `git revert` away.
- **Env vars (Netlify)**: `GITHUB_TOKEN` (fine-grained PAT, Contents R/W on this repo only, expires 2026-08-11), `STUDIO_PASSWORD`, `STUDIO_TARGET_BRANCH` (context-scoped: production→`main`, branch-deploy→`studio` so the `studio` branch deploy is a safe staging environment).
- **Local dev**: `netlify dev --port 8890` (reads `.env`, gitignored; no token needed — functions fall back to the working tree, publish is dryRun-only locally).

---

## Positioning Mode

A development tool for visually positioning and scaling elements. Instead of back-and-forth CSS adjustments, drag elements to the exact position you want, scale them, then lock the values.

### How to Use

**Step 1: Enable positioning mode**
Tell Claude: `enable positioning mode on [CSS selector]`

Claude will:
- Add the positioning script to index.html
- The element becomes draggable with a coordinate/scale display

**Step 2: Position and scale the element**
- **Drag** the element to move it
- **Arrow keys** for 1px nudges
- **Shift + Arrow keys** for 10px nudges
- **Scroll wheel** over element to scale
- **+/-** keys to scale by 1%
- Watch the X/Y/Scale values update in real-time (top-right overlay)

**Step 3: Lock the position**
Tell Claude: `lock [element] at X: [number] Y: [number] Scale: [number]%`

Claude will:
- Apply those exact coordinates and scale to the CSS
- Remove the positioning script from index.html

### Controls Reference
| Action | Result |
|--------|--------|
| Drag | Move element freely |
| Arrow keys | Nudge 1px |
| Shift + Arrow | Nudge 10px |
| Scroll wheel | Scale up/down (2% increments) |
| +/- keys | Scale up/down (1% increments) |
| ESC | Cancel and restore original position |

### File Location
`js/positioning-mode.js` - Reusable script, not loaded by default
