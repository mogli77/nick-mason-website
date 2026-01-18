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

**Client**: Nick Mason Construction, Inc.
**Scope**: $10-15k professional website, includes travel for photography/videography at construction sites
**Partner**: Kelly (collaborating on this project)

### Design Philosophy
- **Primary inspiration**: Chandelier Creative (minimal, clean) and Walker Warner Architects ("live" photo effects)
- **Aesthetic goal**: Elevated lifestyle-brand feel - elegant, simple, exclusive
- **Anti-goal**: Must NOT look like a typical contractor website or use generic templates (why we chose custom HTML/CSS/JS over WordPress/Squarespace)

### Brand Typography
- **"NICK MASON"**: Bold condensed (matches logo patch)
- **"CONSTRUCTION, INC."**: Refined serif
- This pairing is critical to the brand identity

### Video Hosting
- Videos hosted on Cloudinary (account: dylwzl4vu) to avoid Netlify bandwidth costs
- Hero video loops are pulled from Cloudinary URLs

### Known Patterns
- **Navigation color changes**: The inline script (not main.js) handles white text over images → black text over white backgrounds. Any layout changes must preserve this behavior.
- **Code integrity**: When making changes, verify existing functionality (especially nav scripts) still works. Past issues have occurred when updates broke the navigation system.
- **Page transition events**: Use `pageshow` event instead of `DOMContentLoaded` for fade-in transitions to ensure animations fire when using browser back/forward buttons (bfcache compatibility).

---

## Project Overview

This is a static website for Nick Mason Construction, Inc., built with vanilla HTML, CSS, and JavaScript. The site features a clean, editorial design inspired by architecture/construction portfolio sites like Chandelier Creative and Walker Warner.

## Development Workflow

### Preview & Development
- **Open in browser**: Simply open `index.html` in a browser to preview the site
- **No build step**: This is a static site with no compilation or bundling required

### Deployment
- **Platform**: Netlify (auto-deploys from main branch)
- **Process**: Push to `main` branch triggers automatic deployment

## Architecture & Structure

### Core Files
- `index.html` - Single-page site with all content sections
- `css/styles.css` - Complete styling system with CSS custom properties
- `js/main.js` - Minimal JavaScript (currently unused, reserved for future interactivity)
- `images/` - Project photos and static images
- `videos/` - Video loops for hero section

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
