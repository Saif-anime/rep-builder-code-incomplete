# EURO PARKING SERVICES - Design Guidelines

## Design Approach
**System-Based Approach**: Material Design + Carbon Design System hybrid
This enterprise enforcement platform demands clarity, efficiency, and professional credibility. The design balances data density with scanability, using established patterns from Material Design for feedback/interaction and Carbon Design for data-heavy interfaces.

## Design Principles
1. **Evidence First**: All UI decisions prioritize clear evidence presentation and chain of custody
2. **Operational Efficiency**: Minimize clicks, maximize information density without clutter
3. **Trust & Authority**: Professional aesthetic reinforcing legal/enforcement context
4. **Role Clarity**: Visual hierarchy reflects user permissions and workflows

---

## Typography
**Font Families** (Google Fonts):
- Primary: Inter (UI, body text, tables)
- Monospace: JetBrains Mono (timestamps, license plates, technical data)

**Hierarchy**:
- Page Headers: text-2xl font-semibold
- Section Titles: text-lg font-medium
- Body/Tables: text-sm font-normal
- Metadata/Timestamps: text-xs font-mono
- Evidence IDs/Plates: text-base font-mono font-bold

---

## Layout System
**Spacing Units**: Tailwind units of **2, 4, 6, and 8** (p-2, m-4, gap-6, h-8)
- Tight spacing (2): Table cells, compact lists
- Standard spacing (4): Form fields, card padding
- Comfortable spacing (6): Section gaps, content blocks
- Generous spacing (8): Page margins, major sections

**Grid Structure**:
- Sidebar: fixed w-64, left-aligned, full-height
- Main Content: flex-1 with max-w-7xl container
- Evidence Grids: grid-cols-2 lg:grid-cols-3 xl:grid-cols-4
- Data Tables: full-width with horizontal scroll

---

## Component Library

### Navigation
**Left Sidebar** (w-64, fixed):
- Vertical navigation with icons (Heroicons)
- Active state: subtle left border accent
- Section grouping with dividers
- User profile at bottom with role badge
- Logout action clearly separated

### Dashboard Cards
**Stat Cards** (3-4 column grid):
- Large metric number (text-3xl font-bold)
- Label below (text-sm)
- Trend indicator with icon
- Minimal border, subtle shadow

**Activity Feed**:
- Timeline layout with timestamps
- Evidence thumbnails inline (64x64)
- Status badges (Pending/Reviewed/Approved)
- Action buttons right-aligned

### Evidence Display
**Evidence Cards**:
- 16:9 aspect ratio thumbnail
- Overlay: Camera ID, timestamp (absolute positioned, bottom)
- AI confidence badge (top-right corner)
- Hover: enlarge/view action
- Click: full evidence modal

**Evidence Detail Modal**:
- Full-size image/video player (left 2/3)
- Metadata panel (right 1/3)
- AI Analysis section with OpenAI explanation
- ANPR results with license plate highlighted
- Download/Export actions footer

### Data Tables
**Evidence/Detection Tables**:
- Sticky header with sort indicators
- Row hover state for focus
- Thumbnail column (80x80)
- Status column with colored badges
- Actions column (right-aligned icons)
- Pagination footer

### Forms
**Manual Upload Interface**:
- Large drag-drop zone (min-h-64)
- Preview thumbnails in grid
- Form fields: 2-column layout on desktop
- Required field indicators (*)
- Submit action: primary button (full-width mobile, right-aligned desktop)

**Settings Forms**:
- Grouped sections with dividers
- Label-above-input pattern
- Help text below fields (text-xs)
- Save/Cancel actions sticky at bottom

### AI Analysis Components
**Violation Explanation Panel**:
- Heading: "AI Analysis"
- OpenAI summary in readable paragraph
- Confidence meter (horizontal bar)
- Detected objects list with icons
- ANPR results in monospace font
- Flagged concerns highlighted

### Status Indicators
**Badges**:
- Pending: neutral/gray
- Violation Detected: red/warning
- No Violation: green/success
- Under Review: blue/info
- Sizes: text-xs px-2 py-1 rounded-full

**Alerts/Notifications**:
- Toast-style (top-right)
- Auto-dismiss (5s)
- Color-coded by severity

---

## Specialized Elements

### Camera Feed Integration
**Live View Grid**:
- 2x2 or 3x3 camera grid
- Camera name overlay (top)
- Status indicator (recording/offline)
- Click to expand single feed

### ANPR Visualization
- License plate image cropped/highlighted
- OCR text in large monospace
- UK validation indicator (checkmark/warning)
- Confidence score below

### Evidence Chain of Custody
- Timeline visualization (vertical)
- Each action node: timestamp, user, action
- Hash verification status
- Download audit log action

---

## Images
**No hero images** - This is a functional dashboard, not marketing
**Evidence thumbnails**: Throughout (camera captures, manual uploads)
**User avatars**: Profile photos in sidebar/headers
**Camera preview**: Grid layouts for live monitoring

---

## Accessibility
- All interactive elements min 44x44px touch target
- Form labels explicit (not placeholder-only)
- Status communicated via text + color
- Keyboard navigation throughout
- ARIA labels for icon-only actions

---

## Final Notes
This design prioritizes **professional credibility, operational efficiency, and legal compliance**. Every element serves the enforcement workflow - from evidence capture to violation review to appeal preparation. The aesthetic is clean, authoritative, and data-focused without unnecessary embellishment.