## 2024-10-24 - Added aria-labels to copy buttons
**Learning:** Found several icon-only copy to clipboard buttons using the 📋 emoji without an `aria-label`. They had `title` attributes, but screen readers rely on `aria-label` for better context on icon buttons.
**Action:** Always ensure that any button containing only an icon (like emojis or SVGs) has a descriptive `aria-label` attribute, matching its `title` if appropriate, so it is fully accessible to screen readers.
