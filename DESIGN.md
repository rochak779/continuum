# Continuum — Design System

Use this and only this design guideline for the upcoming bits
---

name: Reliable Compliance

colors:

  surface: '#f8f9ff'

  surface-dim: '#d1dbec'

  surface-bright: '#f8f9ff'

  surface-container-lowest: '#ffffff'

  surface-container-low: '#eef4ff'

  surface-container: '#e5eeff'

  surface-container-high: '#dfe9fa'

  surface-container-highest: '#d9e3f4'

  on-surface: '#121c28'

  on-surface-variant: '#464555'

  inverse-surface: '#27313e'

  inverse-on-surface: '#eaf1ff'

  outline: '#777587'

  outline-variant: '#c7c4d8'

  surface-tint: '#4d44e3'

  primary: '#3525cd'

  on-primary: '#ffffff'

  primary-container: '#4f46e5'

  on-primary-container: '#dad7ff'

  inverse-primary: '#c3c0ff'

  secondary: '#4e45d5'

  on-secondary: '#ffffff'

  secondary-container: '#6860ef'

  on-secondary-container: '#fffbff'

  tertiary: '#005522'

  on-tertiary: '#ffffff'

  tertiary-container: '#00702f'

  on-tertiary-container: '#78f591'

  error: '#ba1a1a'

  on-error: '#ffffff'

  error-container: '#ffdad6'

  on-error-container: '#93000a'

  primary-fixed: '#e2dfff'

  primary-fixed-dim: '#c3c0ff'

  on-primary-fixed: '#0f0069'

  on-primary-fixed-variant: '#3323cc'

  secondary-fixed: '#e3dfff'

  secondary-fixed-dim: '#c3c0ff'

  on-secondary-fixed: '#100069'

  on-secondary-fixed-variant: '#372abf'

  tertiary-fixed: '#7ffc97'

  tertiary-fixed-dim: '#62df7d'

  on-tertiary-fixed: '#002109'

  on-tertiary-fixed-variant: '#005320'

  background: '#f8f9ff'

  on-background: '#121c28'

  surface-variant: '#d9e3f4'

typography:

  h1:

    fontFamily: Inter

    fontSize: 48px

    fontWeight: '700'

    lineHeight: '1.2'

    letterSpacing: -0.02em

  h2:

    fontFamily: Inter

    fontSize: 32px

    fontWeight: '600'

    lineHeight: 40px

    letterSpacing: -0.01em

  h3:

    fontFamily: Inter

    fontSize: 24px

    fontWeight: '600'

    lineHeight: 32px

  h4:

    fontFamily: Inter

    fontSize: 20px

    fontWeight: '600'

    lineHeight: 28px

  body-lg:

    fontFamily: Inter

    fontSize: 18px

    fontWeight: '400'

    lineHeight: 28px

  body-md:

    fontFamily: Inter

    fontSize: 16px

    fontWeight: '400'

    lineHeight: 24px

  body-sm:

    fontFamily: Inter

    fontSize: 14px

    fontWeight: '400'

    lineHeight: 20px

  label-md:

    fontFamily: Inter

    fontSize: 14px

    fontWeight: '500'

    lineHeight: 20px

  label-sm:

    fontFamily: Inter

    fontSize: 12px

    fontWeight: '600'

    lineHeight: 16px

    letterSpacing: 0.02em

  h1-mobile:

    fontFamily: Inter

    fontSize: 32px

    fontWeight: '700'

    lineHeight: 40px

rounded:

  sm: 0.25rem

  DEFAULT: 0.5rem

  md: 0.75rem

  lg: 1rem

  xl: 1.5rem

  full: 9999px

spacing:

  unit: 4px

  container-max: 1280px

  gutter: 24px

  margin-mobile: 16px

  margin-desktop: 32px

  stack-sm: 8px

  stack-md: 16px

  stack-lg: 24px

---

## Brand & Style

This design system is built for high-stakes enterprise environments where clarity, security, and trust are paramount. The aesthetic follows a **Corporate / Modern** SaaS movement—utilizing generous whitespace, a systematic grid, and a sophisticated blue-centric palette to evoke a sense of stability and professional rigor.

The visual narrative focuses on "transparency through structure." By using intentional information density and a clear typographic hierarchy, the UI transforms complex vendor data into actionable insights. The style is unobtrusive yet confident, ensuring that the interface remains functional during long periods of analytical work.

## Colors

The palette is anchored by a deep Indigo primary, signaling technical sophistication. Functional colors (Success, Warning, Danger) are used sparingly to highlight system alerts and risk levels, ensuring they stand out against the neutral background.

- **Primary & Secondary:** Used for high-emphasis actions, navigation states, and branding elements.

- **Neutrals:** A scale of cool greys is used to define borders, secondary text, and layout scaffolding.

- **Backgrounds:** Use `#F8FAFC` for the page body to create a soft contrast against white `#FFFFFF` card containers.

## Typography

The system uses **Inter** exclusively to maintain a clean, utilitarian aesthetic. The typographic scale is optimized for legibility in data-heavy views.

- **Headlines:** Use Bold (700) or Semi-Bold (600) for clear section headers. Apply slight negative letter-spacing for larger displays.

- **Body Text:** Standard reading text uses Regular (400). For emphasizing metadata or interactive labels, use Medium (500).

- **Hierarchy:** Maintain a strict contrast between headers and body to allow users to scan dashboards quickly. Use the mobile-specific `h1-mobile` for Hero sections on small screens to prevent overflow.

## Layout & Spacing

The layout follows a **Fixed grid** philosophy for dashboard views, centering content within a 1280px container on desktop. 

- **Grid:** Use a 12-column grid for desktop with 24px gutters. 

- **Rhythm:** Spacing follows a 4px baseline. Most internal component spacing should rely on `8px` (2 units) or `16px` (4 units) to maintain vertical rhythm.

- **Reflow:** On mobile, margins reduce to 16px and the 12-column grid collapses into a single column. Cards should span the full width of the viewport minus horizontal margins.

## Elevation & Depth

Depth is created through **Tonal layers** and **Ambient shadows**. The goal is to separate the interactive canvas from the background without creating visual clutter.

- **Surface Levels:** 

  - Level 0: Background (#F8FAFC)

  - Level 1: Cards & Containers (#FFFFFF)

  - Level 2: Modals & Popovers (#FFFFFF with elevation)

- **Shadows:** Use a single, very soft "Natural" shadow for cards: `0px 1px 3px rgba(0,0,0,0.1), 0px 1px 2px rgba(0,0,0,0.06)`. Avoid heavy, dark shadows; the interface should feel light and airy.

- **Borders:** Use subtle 1px borders (#E5E7EB) on cards and input fields to define edges where shadows are insufficient.

## Shapes

The shape language is consistently **Rounded**, providing a modern and approachable feel to otherwise dense data.

- **Components:** Standard buttons and inputs use a 0.5rem (8px) radius.

- **Containers:** Cards and large layout sections use a 1rem (16px) or `rounded-lg` (1rem) radius to soften the layout.

- **Icons:** Use icons with a slightly rounded cap and join to match the UI's geometry.

## Components

- **Buttons:** Primary buttons use a solid #4F46E5 background with white text. Secondary buttons use a white background with a #E5E7EB border and #4B5563 text. Padding should be `10px 20px`.

- **Input Fields:** Fields utilize a 1px border (#E5E7EB), 8px corner radius, and 16px horizontal padding. Focus states should use a 2px outer glow of the primary color with 20% opacity.

- **Cards:** The central container of the UI. Must have a white background, 16px border radius, and the defined ambient shadow. Internal padding is typically 24px.

- **Chips/Badges:** Used for status indicators (e.g., "High", "Medium", "Low"). These use a "Soft" style: a desaturated background version of the status color with high-contrast text.

- **Navigation:** A clean top-bar for public pages and a dark-themed (#0F172A) sidebar for application-specific views to provide high contrast against the content area.
