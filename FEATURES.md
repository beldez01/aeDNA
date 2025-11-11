# æDNA Feature Updates

## 1. Page State Persistence 🔄

All tool pages now remember your settings when you navigate away and come back!

### How it works:
- **Automatic saving**: Your control settings (sliders, toggles, colormaps, etc.) are automatically saved to browser localStorage
- **Automatic restoration**: When you return to a page, all settings are exactly as you left them
- **Per-page memory**: Each tool maintains its own independent settings

### Pages with persistence:
- ✅ **Differentials** - All map modes, gains, vector settings, colormaps preserved
- 🔄 **More pages coming soon** - The `usePageState` hook can be added to any page

### Technical details:
- Uses the new `usePageState` hook (`lib/usePageState.ts`)
- State is stored in browser localStorage with key format: `aedna_page_{pageName}`
- JSON serialization for complex state objects
- Handles SSR gracefully

---

## 2. Projects System (Studio) 🎨

The Studio now has a full project management system!

### New Features:

#### **Projects Panel** (Left Column)
- **Create New Projects**: Click "New" to create a named project
- **Switch Between Projects**: Click any project to load its workspace
- **Save Progress**: Click "Save" to persist current project state
- **Rename/Delete**: Hover over a project to see rename and delete buttons
- **Visual Indicators**: Active project is highlighted in emerald

#### **Layout Changes**
```
[Projects] [Clipboard] [Workpage]
   2 cols      3 cols      7 cols
```

#### **What's Saved Per Project**:
- All workpage items (images, positions, scales, opacity)
- Canvas size (width/height)
- Background color
- Item layer order

### Data Persistence:
- Projects are stored in **IndexedDB** (browser database)
- **Survives page refreshes** and browser restarts
- Each project is independent with its own complete state

### Workflow:
1. **Create** a new project
2. **Add images** from clipboard or drag & drop
3. **Arrange** on workpage (position, scale, transparency)
4. **Save** your project
5. **Switch** between different projects anytime
6. **Compile** final PNG when ready

### Technical Implementation:
- New `PROJECTS_STORE` in IndexedDB (DB version bumped to 2)
- Project type includes: `{ id, name, createdAt, workItems, canvasSize, bg }`
- State lifted from `Workpage` to `ClipboardWorkpage` parent for project management
- Automatic project loading/saving with full data integrity

---

## Usage Tips:

### State Persistence:
- Settings persist **per browser** (won't sync across devices)
- Clear localStorage to reset all pages: `localStorage.clear()` in browser console
- Works in incognito mode but cleared when you close the window

### Projects:
- **Save frequently** to avoid losing work
- Projects are **local to your browser** (not synced)
- Use descriptive names for easy organization
- Delete old projects to keep things tidy

---

## For Developers:

### Adding state persistence to a new page:

```typescript
import { usePageState } from "../../lib/usePageState";

// In your component:
const [settings, setSettings] = usePageState("page-key", {
  slider1: 0.5,
  toggle1: true,
  colormap: "turbo",
});

// Access values:
const { slider1, toggle1, colormap } = settings;

// Update (triggers auto-save):
setSettings(prev => ({ ...prev, slider1: newValue }));
```

### Benefits:
- ✅ Type-safe
- ✅ SSR compatible  
- ✅ Automatic JSON serialization
- ✅ Updater function support
- ✅ localStorage error handling

