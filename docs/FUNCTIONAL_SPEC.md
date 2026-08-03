# DupeNoMore — Complete Functional Specification

**Purpose:** Find and remove duplicate images and files across large personal libraries.

**The problem:** Over years of downloading, copying, backing up, and reorganizing, the same image ends up in multiple folders — sometimes identical, sometimes resized, recompressed, or renamed. This wastes disk space and makes it impossible to know which copy is the "best" version. Manually comparing thousands of files is not realistic.

**The user:** Someone with thousands to hundreds of thousands of images and videos scattered across multiple drives and folders, who wants to clean up without accidentally deleting something irreplaceable.

---

## How to read this document

Each feature follows this structure:

- **User Story** — what the user needs and why
- **Why** — the problem this solves (included where the motivation isn't obvious from the story)
- **Acceptance Criteria** — how you know the feature works (testable, describes WHAT must be true, not HOW)
- **Solution** — the specific design choices made (bullet points; could be changed without breaking the criteria)

Terms are explained in plain language on first use. Technical terms that appear in the application interface are introduced with a brief definition.

---

## 1. TELLING THE APP WHERE TO LOOK

### US-001: Choosing folders to scan

**Story:** As a user, I want to tell the application which folders contain my images, so that it only looks where I want it to.

**Why:** Images can be spread across drives, external disks, cloud sync folders, and download directories. The user needs full control over scope.

**Acceptance Criteria:**
- I can add multiple folder paths to a scan list
- I can remove folders from the list
- My folder list is remembered between sessions
- I can browse my file system to find folders, or type paths manually
- I can see how many folders are configured

**Solution:**
- "Folders" page with add/remove list
- Operating system folder picker dialog, with manual text entry as fallback
- Folder count displayed at the top

---

### US-002: Enabling and disabling folders

**Story:** As a user, I want to temporarily disable specific folders without removing them, so that I can skip them in the next scan without losing my configuration.

**Acceptance Criteria:**
- I can toggle each folder between enabled and disabled
- Disabled folders are visually distinct but remain in the list
- Disabled folders are skipped during scanning

**Solution:**
- Per-folder toggle switch: enabled/disabled

---

### US-003: Including or excluding subfolders

**Story:** As a user, I want to choose per folder whether its subfolders are also scanned, so that I can control scan depth.

**Acceptance Criteria:**
- I can toggle per folder whether subfolders are included
- The setting is remembered per folder

**Solution:**
- Per-folder toggle: include subfolders yes/no

---

### US-004: Prioritizing folders

**Story:** As a user, I want to set a priority order on my folders, so that when duplicates are found, the application prefers keeping files from my most important locations.

**Why:** A photo in "My Photos/2023" is probably more important to keep than the same photo in "Downloads/temp". The user's folder structure reflects their organizational intent.

**Acceptance Criteria:**
- I can order my folders from most important to least important
- When the application suggests which file to keep, files in higher-priority folders are preferred (as a tiebreaker after quality metrics like resolution and file size)
- Priority order is saved and persists

**Solution:**
- Drag-and-drop folder reordering
- Priority is the 4th criterion in auto-selection (after pixel count, file size, oldest date)

---

## 2. CONFIGURING HOW THE SCAN WORKS

### US-010: Choosing scan intensity with profiles

**Story:** As a user, I want to choose how aggressively the application searches for duplicates, so that I can balance between "find everything" and "only show me obvious copies" — without understanding the technical details.

**Why:** Different situations call for different approaches. A quick cleanup needs speed and certainty. A first-time deep clean needs thoroughness even if it means reviewing some false matches.

**Acceptance Criteria:**
- I can choose from a range of pre-built scan intensity levels
- Each level has a plain-language description of what it finds, what it misses, how fast it is, and how many false positives to expect
- Choosing a level automatically configures all technical settings
- I can create, edit, save, and delete my own custom profiles
- Built-in profiles cannot be deleted

**Solution:**
- 10 built-in profiles ranging from "exact copies only" to "maximum coverage":

| Intent | What it finds | What it misses | Speed | False positives |
|--------|--------------|----------------|-------|-----------------|
| Exact only | Byte-identical copies | Everything else | Fastest | Zero |
| Quick | Obvious copies, light recompression | Resized/edited | Fast | Very few |
| Strict | Near-exact (both algorithms must agree) | Weaker matches | Fast | Minimal |
| Balanced *(recommended)* | Recompressed, lightly edited | Heavy edits | Moderate | Few |
| Large media library | Moderate, both algos agree | Weaker single-algo | Moderate | Minimal |
| Thorough *(first clean)* | Resized, recompressed, three algorithms | Heavy crops | Slower | Some |
| Loose | Cropped, watermarked, color-adjusted | Very different | Slower | More |
| Aggressive | Heavily modified, web re-downloads | Very different | Slow | Many |
| Web downloads | Internet re-compression/resizing | Non-web differences | Moderate | Some |
| Maximum coverage | Everything remotely similar | Nothing | Slowest | Most |

- Profile management: Apply, Edit, Delete, New profile buttons

---

### US-011: Tuning comparison algorithms

**Story:** As a user, I want to fine-tune how images are compared, so that I can optimize for my specific collection.

**Why:** No single comparison method catches everything. Different algorithms detect different types of similarity. Adjusting their sensitivity and how they combine lets the user match their collection's characteristics.

**Acceptance Criteria:**
- I can enable/disable each comparison algorithm independently
- I can adjust the sensitivity for each algorithm (how different two images can be and still count as matching)
- I can set how many algorithms must agree for a match (requiring more agreement means fewer false positives but also fewer true matches)
- I can set how thoroughly the system searches for candidate pairs (deeper search finds more at the cost of speed)
- I can reset all settings to defaults
- I can save current settings as a named profile for reuse

**Solution:**

*Six comparison algorithms available — each detects different types of similarity:*
- **dHash** — compares brightness gradients between neighboring pixels. Catches: recompression, resize, brightness changes.
- **pHash** — analyzes the image's frequency structure (the broad shapes, not fine details). Catches: color changes, contrast, format conversion.
- **aHash** — compares each pixel to the average brightness. Fast but less precise — more false positives than others.
- **wHash** — uses wavelet analysis to capture detail at multiple scales. Catches: compression artifacts, subtle edits.
- **mHash** — like aHash but more robust to outlier pixels (lens flare, dead pixels, bright spots).
- **bHash** — divides image into blocks and compares block averages. Catches: partial matches. Option for fast or full mode.
- Each algorithm has a threshold slider (higher = more lenient, finds more but with more false positives)

*How algorithms combine:*
- **Ensemble minimum** (1–6): how many algorithms must independently agree. 1 = any single match is enough (maximum recall). 2+ = multiple must agree (fewer false positives).
- **Search depth** (1–5, labeled Fast → Maximum): how broadly the system searches for candidate pairs before doing full comparison.
- **Match logic**: three modes for combining algorithm results — each checks independently (default), any match counts, or all enabled must match.
- **Anchor requirement**: optionally require one specific algorithm to always match, regardless of what others say.

---

### US-012: Choosing fingerprint resolution

**Story:** As a user, I want to control the level of detail in image fingerprints, so that I can trade off between precision and speed.

**Why:** Higher-resolution fingerprints capture more detail and can distinguish more subtle differences, but take longer to compute and compare. Most users should use the default.

**Acceptance Criteria:**
- I can choose between standard, high, and maximum fingerprint detail
- The application warns me that changing this setting requires clearing previously cached fingerprints (because old and new fingerprints are incompatible)
- Sensitivity thresholds need proportional adjustment when detail level changes

**Solution:**
- Three settings: 8 (standard, 64-bit — all thresholds calibrated for this), 16 (high, 256-bit), 32 (maximum, 1024-bit)
- Warning message when changed: "Clear fingerprint cache before rescanning"

---

### US-013: Detecting transformed copies

**Story:** As a user, I want to find copies that have been rotated, flipped, or converted to black-and-white, so that these common transformations don't prevent detection.

**Acceptance Criteria:**
- I can enable detection of rotated copies
- I can enable detection of horizontally flipped (mirrored) copies
- I can enable detection of color-to-grayscale conversions
- Each detection type can be toggled independently

**Solution:**
- Three toggles on the Scan page: rotation detection, mirror detection, color change detection

---

### US-014: Filtering which files to scan

**Story:** As a user, I want to control which files are included in the scan by size, type, date, and name pattern, so that I can skip irrelevant files and focus on what matters.

**Acceptance Criteria:**
- I can set minimum and maximum file size limits
- I can specify which file types to include (by extension)
- I can choose to include or exclude video files
- I can set a date range to only scan files from a specific period
- I can exclude files matching specific name patterns
- I can automatically skip operating system folders

**Solution:**
- Min/max size inputs
- Extensions text field (comma-separated)
- "Include video files" toggle
- Date from/to pickers with date type selector (modified date or created date)
- Exclude patterns text field (glob/wildcard syntax)
- "Skip system folders" toggle

---

## 3. RUNNING THE SCAN

### US-020: Starting and monitoring a scan

**Story:** As a user, I want to start a scan and see its progress in real-time, so that I know it's working and can estimate how long it will take.

**Acceptance Criteria:**
- I can start a scan with one click
- While scanning, I see: current phase, files processed, files remaining, groups found so far
- When the scan finishes, I see a summary (total files, groups found, time taken)
- Results are saved automatically
- I can start a scan quickly from anywhere in the application without navigating to the scan page first

**Solution:**
- "Run" page with per-scan progress display
- Three phases: collect files → compute fingerprints → compare fingerprints
- "▶ Scan" shortcut button in the navigation bar (always visible)
- Results saved automatically to the scans directory

---

### US-021: Not losing progress on interruption

**Story:** As a user, I want to resume a scan that was interrupted (crash, restart, power loss), so that I don't lose hours of computation.

**Why:** Computing fingerprints for 100,000 images takes significant time. Comparing them takes longer. Losing that work to a crash is unacceptable.

**Acceptance Criteria:**
- Previously computed fingerprints are not recomputed after restart
- The comparison phase resumes approximately where it left off
- Progress is saved periodically, not just at the end
- If scan settings changed since the last run, stale progress is discarded and a fresh scan starts
- I can see in the log that a resume is happening

**Solution:**
- **Fingerprint cache:** persistent store of computed fingerprints, keyed by file path and modification date. Only new or changed files are re-fingerprinted on restart.
- **Comparison checkpoint:** comparison state saved periodically during the comparison phase. On the next scan with matching settings and file count, comparison resumes from the saved position.
- Console log shows when a resume occurs and from which position.

---

### US-022: Controlling a running scan

**Story:** As a user, I want to pause, resume, or cancel a scan, so that I can free up my computer or stop a scan I no longer need.

**Acceptance Criteria:**
- I can pause a running scan and resume it later
- I can abort a scan permanently
- Partial results from an aborted scan are saved so I can review what was found

**Solution:**
- Pause/Resume and Abort buttons on the Run page
- Aborted scans save partial results as an interim file (viewable in the Results list)

---

### US-023: Scanning only new files (incremental scan)

**Story:** As a user, I want to scan only files that are new or changed since my last scan, so that subsequent scans are much faster.

**Acceptance Criteria:**
- I can run an incremental scan that only processes new or changed files
- I can choose which folder to scan incrementally
- Previously fingerprinted files are skipped automatically

**Solution:**
- "Incremental scan" section on the Results page
- Folder selector with browse button
- Uses the fingerprint cache to skip already-processed files

---

### US-024: Scanning non-image files

**Story:** As a user, I want to find duplicate non-image files (documents, executables, archives), so that I can clean up all types of redundancy.

**Why:** Duplicates aren't limited to images — downloaded installers, documents, and archives also accumulate over time.

**Acceptance Criteria:**
- I can scan for duplicate files (not just images) using different matching methods
- Available methods include: identical content matching, detecting copy-pattern filenames (e.g., "file (1).txt"), similar-name matching (names that are close but not identical), pattern-based matching (user-defined rules), and version grouping for software installers
- Results appear in the same review interface as image scans

**Solution:**
- File scan mode on the Scan page (scan type selector)
- Five match modes:
  - **Exact content**: byte-identical files (same content, different name/location)
  - **Copy pattern**: detects and strips common copy suffixes ("Copy", "(1)", " - Copy")
  - **Name similarity**: groups files with similar names (using edit-distance calculation)
  - **Wildcard**: user-defined matching patterns with AND/OR logic and presets
  - **Version grouping**: groups installers/executables by base name and extracted version numbers

---

### US-025: Guided scan setup (wizard)

**Story:** As a user who is new to the application, I want a guided step-by-step process to set up and run my first scan, so that I don't need to understand all the settings upfront.

**Acceptance Criteria:**
- A wizard walks me through: choosing folders, selecting a scan intensity, and starting the scan
- Each step is clearly explained in plain language
- I can go back to previous steps
- I can cancel the wizard at any time

**Solution:**
- Multi-step wizard accessible from the Scan page
- Step 1: add folders, Step 2: choose intensity (simplified), Step 3: review and start
- Back/Next/Cancel/Start navigation

---

## 4. MANAGING RESULTS

### US-030: Viewing past scan results

**Story:** As a user, I want to see all my previous scan results and understand what each contains, so that I can choose which to review.

**Acceptance Criteria:**
- I see a list of all past scan results
- Each result shows: when it was scanned, how many duplicate groups were found, and what scan settings were used
- I can load any result for review
- I can delete results I no longer need
- I can refresh the list to pick up newly created results

**Solution:**
- "Results" page with a scrollable list
- Each entry shows: date, group count, compact settings summary
- Load, Delete, and Refresh buttons

---

### US-031: Exporting results

**Story:** As a user, I want to export scan results in different formats, so that I can share them, analyze them in other tools, or archive them.

**Acceptance Criteria:**
- I can export in a format viewable in any browser without special software
- I can export in a format suitable for spreadsheet analysis
- I can export in a format suitable for machine processing
- I can export in a plain readable text format
- I can export as a compressed archive
- Each export contains all group and file information

**Solution:**
- Five export formats: HTML (browser), CSV (spreadsheets), JSON (machine), TXT (reading), ZIP (archive)
- Export button per result with format selector

---

### US-032: Importing results

**Story:** As a user, I want to import previously exported result files, so that I can continue work across machines or restore from backup.

**Acceptance Criteria:**
- I can import a previously exported result file
- Imported results appear in the list and can be reviewed normally

**Solution:**
- Import button with file picker on the Results page

---

### US-033: Managing comparison checkpoints

**Story:** As a user, I want to see and clean up comparison checkpoints from interrupted scans, so that stale data doesn't accumulate.

**Acceptance Criteria:**
- I can see whether any comparison checkpoints exist from interrupted scans
- I can delete stale checkpoints

**Solution:**
- Checkpoints section on the Results page showing saved comparison state
- Delete button per checkpoint

---

### US-034: Scan settings recorded in results

**Story:** As a user, I want each result to record what scan settings produced it, so that I can compare results from different configurations and understand why certain matches were or weren't found.

**Acceptance Criteria:**
- Each result permanently records the scan configuration used to produce it
- When reviewing a result, I can see the settings at a glance
- The results list shows a compact settings indicator per entry

**Solution:**
- Scan configuration embedded in every result file
- Compact settings line at the top of the Review page (e.g., "dhash:10 · phash:12 · ensemble=1 · depth=normal · threshold")
- Same settings shown in the Results list per entry

---

## 5. REVIEWING DUPLICATES — SEEING THE EVIDENCE

### US-040: Comparing duplicate files visually

**Story:** As a user, I want to see all copies of an image side by side with clear metadata, so that I can visually confirm they're duplicates and decide which is best.

**Acceptance Criteria:**
- Each group of duplicates shows all files as cards in a horizontal row
- Each card shows: thumbnail, filename, folder path, file size, image dimensions (width × height and megapixels), and file date
- When the image contains an original capture date in its metadata (separate from the file system date), that date is also shown
- When the capture date and file date differ significantly, a visual indicator warns me
- Long folder paths don't break the layout, and the most meaningful part (the folder closest to the file) remains visible
- Thumbnails are large enough to see meaningful content

**Solution:**
- Cards at 300px width with 1:1 square thumbnails
- Labeled metadata rows with aligned columns across cards
- Capture date (from EXIF metadata) shown when available; ⚠ icon when it differs from file date by more than 30 days
- Path displayed right-to-left (truncates from the left, keeping the rightmost folder visible)

---

### US-041: Video file thumbnails

**Story:** As a user, I want to see preview frames for video files, not just generic icons, so that I can identify video duplicates visually.

**Acceptance Criteria:**
- Video files show a preview frame as their thumbnail
- If the primary thumbnail method isn't available, a fallback method is used
- If no preview can be generated at all, a recognizable video icon appears

**Solution:**
- Primary: ffmpeg (a separate video processing tool) extracts the first frame as a thumbnail
- Fallback: the browser's built-in video player renders a preview from the beginning of the file
- Final fallback: 🎬 icon placeholder

---

### US-042: Similarity score display

**Story:** As a user, I want to see how closely each file matches the others in its group, so that I can distinguish between identical copies and vaguely similar images.

**Why:** A 100% match needs no review — it's an identical copy. A 78% match might not even be a real duplicate and needs careful inspection. The score tells me how much attention each group requires.

**Acceptance Criteria:**
- Each non-identical match shows a percentage score
- Byte-identical files show a distinct "identical" indicator instead of a percentage
- The group header shows the range of scores in the group (e.g., "78–94%")
- I can see which comparison algorithm produced the score and its raw values (on hover or interaction)
- The score remains visible regardless of what other actions I take on the card

**Solution:**
- Match % badge on each card, colored by strength: green (≥95%), amber (80–94%), grey (<80%)
- "MD5✓" badge for byte-identical files
- Range badge in group header
- Tooltip showing per-algorithm breakdown on hover

---

### US-043: Best-value highlighting

**Story:** As a user, I want to instantly see which file in a group has the best size, resolution, or newest date, so that I can make quick decisions without reading every number.

**Why:** When comparing 3–6 files, scanning numbers is slow. Color coding lets the eye jump to the winner immediately.

**Acceptance Criteria:**
- The file with the best value for each metric is visually distinct from the others
- If two or more files tie on a metric, they're marked differently from a unique winner
- The highlighting is subtle — not distracting or easily confused with error states

**Solution:**
- Unique best = soft green text
- Tied best = soft blue text
- Normal = default grey
- Applied independently to Size, Dimensions, and Date rows

---

### US-044: File name quality indicator

**Story:** As a user, I want to see which files have meaningless names (hashes, random strings), so that I know when renaming the kept file would help.

**Why:** `87ec3de328fa2838aa2ce18050857a6f.jpg` tells you nothing about the image. A descriptive name like `sunset-beach-2023.jpg` makes future browsing possible. When deleting duplicates, keeping the descriptive name matters.

**Acceptance Criteria:**
- Files with names that appear to be hashes or random strings are flagged with a visible label
- Files with descriptive, human-readable names are not flagged
- The distinction is obvious at a glance

**Solution:**
- Automatic name scoring based on character patterns:
  - Hex hashes (16+ hex characters) → orange "hash" label
  - Random alphanumeric strings (no vowel patterns suggesting real words) → orange "random" label
  - Timestamps, copy patterns, short names → no label
  - Descriptive names with recognizable words → no label

---

### US-045: Detecting potential higher-quality versions

**Story:** As a user, I want to know when a smaller-resolution file is unexpectedly large in file size, because it might be saved in a higher-quality format (less compression, lossless encoding), so that I don't automatically discard it based on resolution alone.

**Why:** A 2000×1500 TIFF at 5MB may contain more actual image quality than a 4000×3000 JPEG at 3MB that's heavily compressed. Resolution alone doesn't tell the full story. This flag prompts the user to look more carefully before choosing.

**Acceptance Criteria:**
- Files with lower resolution but significantly larger file size than another in the group are flagged
- The threshold for "significantly larger" is configurable
- The flag is positive — it highlights a potential quality advantage, not a problem
- I can filter to show only groups containing such a file

**Solution:**
- "Hi-fi ★" badge (blue) on qualifying cards
- Default threshold: 1.5× file size ratio, adjustable
- "Hi-fi" filter checkbox in the toolbar with threshold input

---

### US-046: Same-folder duplicate detection

**Story:** As a user, I want to know when all files in a group are in the same folder, so that I can handle these quickly — they're almost always accidental copies.

**Why:** Same-folder duplicates (like `photo.jpg` and `photo (1).jpg`) are usually unintentional and can be cleaned up with high confidence. Flagging them lets the user batch-process the easy cases first.

**Acceptance Criteria:**
- Groups where every file is in the same directory are visually flagged in the header

**Solution:**
- "📁 Same folder" badge in the group header

---

### US-047: Confidence level display

**Story:** As a user, I want to see at a glance how confident the application is that files are truly duplicates, so that I know which groups need my attention and which I can handle quickly.

**Why:** Byte-identical files (Certain) need zero review — they're the same file. Strong perceptual matches (Probable) need a quick glance. Weak matches (Uncertain) need careful inspection. The confidence level tells the user how to allocate their time.

**Acceptance Criteria:**
- Each group shows a confidence level
- At least three levels exist: high confidence (virtually guaranteed duplicates), medium confidence (strong visual match), and low confidence (possible match, needs manual verification)
- The confidence level is based on the match method and strength

**Solution:**
- Three levels:
  - CERTAIN (green): byte-identical or very high perceptual match
  - PROBABLE (yellow): strong perceptual match
  - UNCERTAIN (red): weaker match — needs manual review
- Colored badge in the group header

---

### US-048: Group header information

**Story:** As a user, I want the group header to show key summary information at a glance, so that I can quickly assess each group without examining every card.

**Acceptance Criteria:**
- The group header shows: confidence level, number of files in the group, match method used (byte-identical or perceptual), match percentage range, common folder path, and which file is currently marked as keep
- All information is compact enough to fit in a single row

**Solution:**
- Header row with: confidence badge, file count, "MD5✓" indicator (for byte-identical), percentage range badge, "📁 Same folder" badge (when applicable), common path, and "✓ kept-filename" on the right side
- 🚫 (ignore group) and ▾ (collapse) buttons at the right end

---

### US-049: Image zoom and side-by-side comparison

**Story:** As a user, I want to zoom into images at full resolution and compare two images side by side, so that I can spot subtle differences like compression artifacts, watermarks, or slight crops.

**Acceptance Criteria:**
- I can view any image at full resolution in an overlay
- The overlay shows the filename, file size, and dimensions
- I can compare two images side by side by selecting a second image while the first is zoomed
- I can close the overlay easily with both keyboard and mouse

**Solution:**
- Click thumbnail → full-resolution overlay
- While zoomed, click another thumbnail → both shown side by side
- Close: Escape key or click the image
- Info bar at bottom shows file metadata

---

### US-050: Opening files in external applications

**Story:** As a user, I want to open a file in my system's default viewer or show it in my file manager, so that I can inspect it outside the application or navigate to its location on disk.

**Acceptance Criteria:**
- I can open any file in the operating system's default application for that file type
- I can open the file's containing folder with the file highlighted/selected

**Solution:**
- 👁 (view) button: opens the file in the default application
- 📂 (folder) button: opens the containing folder with the file selected

---

### US-051: Handling large result sets (pagination)

**Story:** As a user, I want to browse thousands of duplicate groups without the application becoming slow or unresponsive.

**Why:** A thorough scan can find 5,000–10,000+ groups. Rendering all at once makes the browser unusable.

**Acceptance Criteria:**
- The application remains responsive regardless of total group count
- Groups are displayed in manageable pages
- I can navigate between pages
- I can see which page I'm on, how many pages there are, and which groups are shown
- Pagination controls appear at both the top and bottom of the list
- Filtering and sorting work across all groups, not just the current page

**Solution:**
- Maximum 500 groups rendered per page
- Prev/Next buttons at top and bottom
- Page indicator: "Page 3 of 17 · showing 1001–1500 of 8111 groups"
- Filters and sorting operate on the full dataset, then the result is paginated

---

### US-052: Switching between result files

**Story:** As a user, I want to switch between different scan results without leaving the Review page, so that I can quickly compare results from different scans.

**Acceptance Criteria:**
- I can select a different result file while on the Review page
- The display updates to show the selected result
- My decisions for the previous result are preserved

**Solution:**
- Result file dropdown at the top of the Review page
- Selecting a different result loads it immediately
- Decisions are saved per result file

---

## 6. REVIEWING DUPLICATES — MAKING DECISIONS

### US-060: Keep/remove selection

**Story:** As a user, I want to mark files as "keep" or "remove" within each group, so that I can decide which copies to delete.

**Acceptance Criteria:**
- Each file can be toggled between keep and remove
- The visual distinction is immediately obvious
- I can lock a file to prevent accidental changes
- I can change my mind at any time before executing the cleanup

**Solution:**
- Click card to toggle
- Green border + "✓ KEEP" for keep
- Red border + "✗ Remove" for remove
- 🔒/🔓 button to lock/unlock individual files

---

### US-061: Automatic best-file selection

**Story:** As a user, I want the application to automatically pick the best file in each group, so that I only need to manually review edge cases.

**Why:** For hundreds or thousands of groups, manually comparing every file is not practical. Automation handles the obvious cases, leaving the user to focus on genuinely ambiguous matches.

**Acceptance Criteria:**
- I can auto-select the best file across all visible groups with one click
- The selection priority is clear and deterministic (resolution, then file size, then date, then folder priority)
- For byte-identical groups, I can accept all of them at once — since the files are literally the same, there's nothing to visually review
- I can see how many groups were processed

**Solution:**
- "⭐ Auto-select best" button: applies the priority algorithm to all visible groups
- "✓ Accept all MD5" button: auto-selects in all byte-identical groups (no review possible or needed)
- Priority order: most pixels → biggest file → oldest capture/file date → highest folder priority

---

### US-062: Bulk selection by rule

**Story:** As a user, I want to apply simple selection rules across all visible groups at once, so that I can handle common cases efficiently.

**Acceptance Criteria:**
- I can keep the file with: the largest size, highest resolution, newest date, oldest date, highest-priority folder, or shortest filename — across all visible groups at once
- I can mark all files as keep, all as remove, or invert all current decisions
- Each action confirms what it did

**Solution:**
- Buttons: Largest, Most pixels, Newest, Oldest, Priority folder, Shortest name
- Utility buttons: Keep all, Remove all, Invert

---

### US-063: Folder-based selection

**Story:** As a user, I want to make keep/remove decisions based on folder paths or patterns, so that I can say things like "remove everything from my temp downloads folder."

**Acceptance Criteria:**
- I can type a folder path or wildcard pattern (e.g., `*Downloads*`)
- I can mark all matching files as keep, remove, locked, or unlocked
- The pattern matches against the full file path

**Solution:**
- Text input with wildcard support
- Buttons: +Keep, -Remove, 🔒Lock, 🔓Unlock

---

### US-064: Renaming the kept file

**Story:** As a user, I want to rename the kept file to a better filename from one of the duplicates, so that I keep both the best quality and the most descriptive name.

**Why:** Often the highest-quality copy has a meaningless hash name while a smaller copy has a descriptive name. After deleting the duplicate, the descriptive name would be lost forever.

**Acceptance Criteria:**
- I can copy any filename from a duplicate to the kept file
- A confirmation shows old and new names before the rename happens
- The rename takes effect on disk immediately
- If a file with that name already exists in the folder, the rename is blocked with an error

**Solution:**
- ✏ button on each card
- Renames the group's kept file to this card's filename in the same directory
- Name collision check before renaming

---

### US-065: Saving decisions manually

**Story:** As a user, I want to explicitly save my keep/remove decisions, so that I have a clear save point I can trust.

**Acceptance Criteria:**
- I can save my current decisions with one click
- The save confirms that it succeeded
- Saved decisions are restored when I reload the result

**Solution:**
- 💾 Save button in the toolbar
- Saves decisions to a per-result overrides file
- Works alongside auto-save (see US-112)


### US-066: Automated best-name transfer

**Story:** As a user, I want to automatically transfer the most descriptive filename to the kept file across all visible groups, so that I don't have to manually rename hundreds of files one by one.

**Why:** After auto-selecting the best quality file in each group, many kept files end up with meaningless hash or random names while their lower-quality duplicates have descriptive, human-readable names. Renaming one at a time is tedious across thousands of groups. Automating this with a review step keeps the user in control while eliminating repetitive work.

**Acceptance Criteria:**
- I can trigger an automated best-name analysis across all currently visible groups
- The application identifies groups where a non-kept file has a better name than the kept file (using the name quality scoring)
- A list of proposed renames is shown, each with: current kept filename, proposed new filename, and the source it came from
- Each proposed rename has a selection marker (checked by default) that I can toggle on or off
- I can review the full list before anything happens on disk
- An "Apply all" button executes all selected renames at once
- A summary shows how many files were renamed, how many were skipped, and whether any failed (e.g., due to name collisions)
- Groups where the kept file already has the best name are not included in the list

**Solution:**
- "✏ Auto-rename" button in the Select row (next to Auto-select best)
- Scans all visible groups, compares the name quality score of the kept file against all other files in the group
- Proposes renaming the kept file to the highest-scoring name in the group (if it scores higher than the current name)
- Rename preview displayed as a scrollable list with checkboxes, showing before → after for each group
- "Select all" / "Deselect all" toggles at the top of the list
- "Apply selected" button executes checked renames sequentially
- Results summary with counts: renamed, skipped (unchecked), failed (collision or error)

---

## 7. REVIEWING DUPLICATES — NARROWING THE VIEW

### US-070: Filtering by confidence level

**Story:** As a user, I want to show/hide groups by their match confidence, so that I can review uncertain matches separately from obvious ones.

**Acceptance Criteria:**
- I can toggle visibility for each confidence level independently
- Group count updates to reflect how many groups are currently visible

**Solution:**
- Three toggle buttons in the toolbar: Certain, Probable, Uncertain

---

### US-071: Filtering by similarity range

**Story:** As a user, I want to show only matches within a specific similarity range, so that I can focus on a band — for example, the 80–90% range where false positives concentrate.

**Acceptance Criteria:**
- I can set a minimum and maximum match percentage
- Groups where no file falls within the range are hidden entirely
- Within a visible group, individual files outside the range are also hidden (but the reference file always remains visible so the group makes sense)
- The filter updates immediately as I change the values

**Solution:**
- Two number inputs (min %, max %) in the toolbar
- Dual-level filtering: group-level (hide groups with no qualifying match) and card-level (hide individual cards outside the range)

---

### US-072: Filtering for potential higher-quality versions

**Story:** As a user, I want to filter to only show groups where a lower-resolution file might actually be higher quality, so that I can review these unusual cases specifically.

**Why:** These are the cases where the obvious choice (keep highest resolution) might be wrong. Filtering for them lets the user give them the extra attention they need without wading through thousands of straightforward groups.

**Acceptance Criteria:**
- I can toggle a filter to show only groups containing at least one such file
- I can adjust the file-size ratio threshold that defines "unexpectedly large"

**Solution:**
- "Hi-fi" checkbox with threshold input (default 1.5×) in the toolbar

---

### US-073: Filtering by decision state

**Story:** As a user, I want to find groups where I've kept multiple files or made no decision yet, so that I can review them.

**Acceptance Criteria:**
- I can filter to show only groups where more than one file is marked as keep (these might need a second look — usually only one copy is needed)
- I can filter to show only groups where no file is marked for removal (groups I haven't reviewed yet)

**Solution:**
- "Multi-keep" toggle button
- "No selection" toggle button

---

### US-074: Sorting groups

**Story:** As a user, I want to sort groups by different criteria, so that I see the most important or actionable groups first.

**Acceptance Criteria:**
- I can sort by: similarity (lowest first — borderline cases), similarity (highest first), potential space freed, number of files in the group, or unreviewed groups first
- Sorting works across all groups, not just the current page

**Solution:**
- Sort dropdown in the toolbar with five options
- Sorting operates on the full dataset, then paginates

---

## 8. PERMANENTLY REMOVING GROUPS FROM RESULTS

*Note: These operations are different from marking files for removal (section 6). These permanently delete groups from the result file itself. Marking files for removal is reversible; permanently removing groups is not.*

### US-080: Removing empty and single-file groups

**Story:** As a user, I want to permanently remove groups that have no useful comparison left, so that my result set shrinks over time as I work through it.

**Why:** After executing deletions or filtering, some groups end up with only one file — there's no pair to compare, so they're just noise. Removing them permanently makes the result set cleaner for future review sessions.

**Acceptance Criteria:**
- I can permanently remove groups with only one file remaining (no actual duplicate to compare)
- I can permanently remove groups with no remaining matches
- The removal modifies the result file — these groups don't come back on reload
- I see how many groups were removed and how many remain

**Solution:**
- "- Singletons" and "- Empty groups" buttons
- Each modifies the result file on disk

---

### US-081: Removing groups by match percentage

**Story:** As a user, I want to permanently remove groups that fall below, above, or within a specific similarity range, so that I can discard entire bands of matches I'm not interested in.

**Why:** Groups at 78% similarity are often false positives from aggressive scan profiles. Rather than reviewing each one, I can permanently discard the entire band and focus on higher-confidence matches.

**Acceptance Criteria:**
- I can permanently remove all groups below a percentage threshold
- I can permanently remove all groups above a threshold
- I can permanently remove all groups within a percentage range (e.g., 80–90%)
- Each operation shows how many groups were removed and how many remain

**Solution:**
- "- Below %" button: prompts for threshold, shows helpful context (e.g., 84% is a common algorithm boundary)
- "- Above %" button: prompts for threshold
- "- Range %" button: prompts for range (e.g., "80-90")

---

### US-082: Removing groups from a specific folder

**Story:** As a user, I want to permanently remove all groups containing files from a specific folder, so that I can exclude an entire directory from my results.

**Why:** Different from folder-based *selection* (US-063), which marks files keep/remove within groups and is reversible. This permanently removes the groups from the result file — useful when an entire folder is irrelevant and shouldn't clutter the review.

**Acceptance Criteria:**
- I can permanently remove all groups containing files from a specific folder
- A confirmation shows which folder will be affected before proceeding

**Solution:**
- "－" (filter folder) button on each card
- Removes all groups containing files from that folder from the result file

---

## 9. THE IGNORE LIST

### US-090: Ignoring groups and individual files

**Story:** As a user, I want to permanently mark files or groups as "not duplicates," so that they never show up as matches again — even after rescanning.

**Why:** Some images are legitimately similar but intentionally separate: photos from the same session, before/after edits, design variations of the same concept. Once I've confirmed these are intentionally separate files, I don't want to see them again every time I scan.

**Acceptance Criteria:**
- I can ignore an entire group (all files in it treated as "not duplicates of each other")
- I can ignore a single file (it won't appear in any future duplicate group)
- I can ignore all currently visible files at once (respecting current filters — only files I can actually see are ignored, not those hidden by filters)
- Ignore decisions persist across rescans and application restarts
- Ignored groups and files are automatically hidden when loading results

**Solution:**
- 🚫 button on group header → ignores entire group as a unit
- 🚫 button on individual card → ignores that specific file
- "🚫 Ignore visible" bulk action → ignores all currently visible cards (not those hidden by match% filter)
- Ignore list stored persistently; checked on every result load

---

## 10. EXECUTING THE CLEANUP

### US-100: Configuring what happens to files

**Story:** As a user, I want to choose what happens to files I've marked for removal (and optionally, files I've marked for keeping), so that I have full control over the outcome.

**Acceptance Criteria:**
- I can choose the removal action: move to application-managed recoverable storage, move to a specific folder of my choice, or delete permanently
- I can optionally move kept files to a specific destination folder (consolidating them)
- I can choose whether to preserve the original folder structure in the destination

**Solution:**
- Actions panel (opened via "⚡ Actions" button) with:
  - "Removed → move to" destination selector (default: application trash)
  - "Kept → move to" destination selector (optional)
  - "Reproduce folder structure" toggle
  - Browse buttons for folder selection

---

### US-101: Excluding files from the action

**Story:** As a user, I want to add last-minute exclusion rules before executing, so that I can protect specific files from being moved or deleted even if they're marked for removal.

**Why:** Safety net — the user might realize just before executing that all files from a specific drive or matching a specific pattern should be protected, without having to go back and change individual selections.

**Acceptance Criteria:**
- I can add exclusion rules based on path patterns or other criteria
- Excluded files are skipped during action execution
- I can add multiple rules
- I can see which rules are active before executing

**Solution:**
- "Deselect filters" section in the Actions panel
- "+ Add filter" button to add exclusion rules
- Each filter has a type selector and value input

---

### US-102: Previewing and executing

**Story:** As a user, I want to preview what will happen before executing, and then execute with confidence that I understand the consequences.

**Acceptance Criteria:**
- I can do a dry run that shows exactly what would be moved/deleted without actually doing it
- When I execute for real, I see progress and a summary
- Permanently destructive actions require an explicit confirmation that clearly states the consequences

**Solution:**
- "Dry run" button: simulates and shows results without modifying any files
- "Run" button: executes after confirmation dialog
- Permanent deletion shows a prominent warning about irreversibility

---

### US-103: Recovering from mistakes (undo)

**Story:** As a user, I want to undo file operations if I made a mistake, so that files aren't permanently lost.

**Why:** Permanently deleting or misplacing irreplaceable files is the worst possible outcome of using this application. A robust undo system is essential for user confidence.

**Acceptance Criteria:**
- Files moved to the application's recoverable storage can be restored
- A log records every operation with the original file path
- I can undo individual operations
- I can download the full log as a file for external reference

**Solution:**
- Undo log stored per action execution
- "Undo" button in the Actions panel
- "Download action log" button for external record
- Application-managed recoverable storage (separate from the operating system's recycle bin)

---

### US-104: Trash management

**Story:** As a user, I want to manage the application's recoverable storage, so that I can see how much space it uses and permanently delete old files when I'm confident they're not needed.

**Acceptance Criteria:**
- I can see how many files are in recoverable storage and their total size
- I can permanently delete all files in recoverable storage (with confirmation)
- Statistics can be refreshed

**Solution:**
- Trash statistics displayed in Settings (file count, total size)
- "Empty trash" button with confirmation dialog
- "Refresh" button to update statistics

---

## 11. NAVIGATION, PROGRESS, AND PERSISTENCE

### US-110: Keyboard-driven review

**Story:** As a user, I want to navigate and make decisions using only the keyboard, so that I can review hundreds of groups efficiently without constant mouse movement.

**Acceptance Criteria:**
- I can move between groups using keyboard shortcuts
- I can auto-select the best file in the focused group with one key
- I can toggle keep/remove with one key
- I can jump to the next unreviewed group
- I can close the zoom overlay with a key
- Shortcuts don't interfere when I'm typing in a text field or other input
- A visible reference shows available shortcuts

**Solution:**
- `j`/`↓` next group, `k`/`↑` previous group
- `a` auto-select, `Space` toggle, `n` next unreviewed, `Esc` close zoom
- Focused group highlighted with purple outline, scrolls into view
- Shortcut hint panel in bottom-right corner
- Shortcuts disabled when any input element is focused

---

### US-111: Progress tracking and space savings

**Story:** As a user, I want to see how far I am in my review and how much space I'll free up, so that I can feel the progress and estimate how much work remains.

**Acceptance Criteria:**
- I can see how many groups I've made decisions on vs. total groups
- I can see the total number of files marked for removal and their combined disk space
- Both counters update in real-time as I work

**Solution:**
- Toolbar displays: review progress (e.g., "✓ 450/8111 reviewed") and space savings (e.g., "🗑 290 files · 10.79 GB")
- Updates after every selection change

---

### US-112: Automatic saving of decisions

**Story:** As a user, I want my keep/remove decisions saved automatically, so that a browser crash or accidental tab close doesn't lose my work.

**Acceptance Criteria:**
- Decisions are saved periodically without any manual action
- Decisions are saved when I close or navigate away from the browser tab
- On reload, all previous decisions are fully restored

**Solution:**
- Auto-save triggers every 50 selection changes
- Save also triggers on browser tab close/navigation (using browser APIs that work even during abrupt exits)
- Decisions stored in per-result override files

---

### US-113: Collapsing reviewed groups

**Story:** As a user, I want to collapse groups I've already handled, so that they take less space while I continue working through the rest.

**Acceptance Criteria:**
- I can collapse any group to show only its header (hiding all cards)
- I can expand a collapsed group to see its cards again
- The collapse state is visually clear (different icon for collapsed vs. expanded)

**Solution:**
- ▾ (expanded) / ▸ (collapsed) toggle button on each group header

---

### US-114: Sticky toolbar

**Story:** As a user, I want the filter and action toolbar to always be visible while I scroll through groups, so that I can change filters or apply actions without scrolling back to the top.

**Acceptance Criteria:**
- The toolbar remains visible at the top of the screen as I scroll through groups
- Content scrolls behind the toolbar
- The toolbar doesn't obscure group content when the page first loads

**Solution:**
- Toolbar fixed at the top of the viewport during scrolling

---

## 12. SEMANTIC IMAGE SEARCH (OPTIONAL)

### US-120: Setting up semantic search

**Story:** As a user, I want to set up AI-powered image search so that I can find images by describing them in words.

**Why:** With thousands of images, finding "that photo of a sunset on the beach" requires either perfect folder organization or visual AI that understands image content.

**Acceptance Criteria:**
- I can download the required AI model (one-time setup)
- I can see download progress and status
- I can choose which folders to index for search
- I can see how many images have been indexed
- The model and index persist between sessions
- I can configure authentication for model downloads (if required by the model provider)
- I can configure the search timeout

**Solution:**
- CLIP model (~350MB one-time download) provides text-to-image and image-to-image understanding
- Download progress bar and status display on the Search page
- Folder selector with "include subfolders" toggle for indexing
- Index progress bar and image count
- Authentication token configurable in Settings (for faster downloads)
- Search timeout configurable in Settings

---

### US-121: Searching by text and by image

**Story:** As a user, I want to search my library by typing a description OR by selecting a reference image, so that I can find specific content flexibly.

**Acceptance Criteria:**
- I can type a text description and get matching images ranked by relevance
- I can select an image and find visually similar images in my indexed library
- I can control how many results to show

**Solution:**
- Text search: finds images that match the description
- Image similarity search: finds images that look like the selected one
- Max results control
- Results displayed as ranked thumbnail grid

---

## 13. APPLICATION SETTINGS

### US-130: Storage configuration

**Story:** As a user, I want to configure where scan results and data are stored.

**Acceptance Criteria:**
- I can set the folder where scan results are stored
- I can browse to select the folder

**Solution:**
- Path input with browse button in Settings
- Default: scans directory next to the application

---

### US-131: Fingerprint cache management

**Story:** As a user, I want to see and manage the fingerprint cache, so that I can clear it if needed (for example, after changing the fingerprint resolution).

**Acceptance Criteria:**
- I can see cache statistics (number of cached items, disk space used)
- I can clear the entire cache
- Clearing warns that the next scan will take longer because all fingerprints must be recomputed

**Solution:**
- Cache statistics in Settings
- "Clear cache" button with confirmation dialog explaining the impact

---

### US-132: Integration status

**Story:** As a user, I want to see whether optional tools and integrations are available, and configure their settings.

**Acceptance Criteria:**
- I can see whether video thumbnail support is available
- I can configure authentication for the AI model provider
- I can configure the search timeout for semantic search

**Solution:**
- ffmpeg status display (detected / not detected)
- Authentication token input (masked) for AI model downloads
- Search timeout input for CLIP search

---

### US-133: Application management

**Story:** As a user, I want to see the application version, restart the server, and check for updates.

**Acceptance Criteria:**
- The version number is visible
- I can restart the application server (it relaunches automatically)
- I can trigger a check for package updates

**Solution:**
- Version displayed in Settings and in the navigation bar
- "Restart" button triggers a server restart (the restart loop relaunches it automatically)
- "Check for updates" button installs the latest package versions

---

## 14. APPLICATION SHELL AND INFRASTRUCTURE

### US-140: Navigation

**Story:** As a user, I want to move between application areas easily, with the workflow order clear.

**Acceptance Criteria:**
- Main workflow areas are in logical order: configure → scan → view results → review duplicates
- Additional tools (search) are accessible but visually separated from the main workflow
- Settings are accessible but not mixed with the workflow
- A quick-start scan button is always available regardless of current page
- I can toggle between dark and light themes
- The current application version is visible

**Solution:**
- Top navigation: workflow tabs left-to-right (Folders · Scan · Run · Results · Review), Search separated, Settings on the right
- "▶ Scan" shortcut button always visible in the nav bar
- Theme toggle (◑) cycles dark/light
- Version number in the top-left corner

---

### US-141: Always-fresh files after updates

**Story:** As a user, I want the application to always load the latest version after I update, without needing to manually clear my browser cache.

**Acceptance Criteria:**
- After extracting a new version, the browser loads fresh files immediately on next visit
- No manual cache clearing or hard-refresh needed

**Solution:**
- All static files served with headers that instruct the browser not to cache them

---

### US-142: Auto-restart on crash

**Story:** As a user, I want the server to restart automatically if it crashes, so that I don't need to manually relaunch it.

**Acceptance Criteria:**
- If the server process exits unexpectedly, it relaunches automatically after a brief delay
- I can stop the restart loop permanently by closing the server window

**Solution:**
- Startup script runs in a restart loop with a short delay between restarts
- Closing the terminal window stops the loop

---

### US-143: Error visibility

**Story:** As a user, I want to see application errors clearly, so that I can report them or understand what went wrong.

**Acceptance Criteria:**
- Errors are displayed visibly in the interface, not just hidden in browser developer tools
- I can copy error details for reporting
- I can dismiss error messages

**Solution:**
- Error bar at the top of the page showing the error message
- Copy button to copy error details to clipboard
- Dismiss button to close the error bar

---

### US-144: Confirmation for destructive actions

**Story:** As a user, I want to be asked for confirmation before any action that can't be easily undone, so that I don't accidentally lose data.

**Acceptance Criteria:**
- All permanently destructive actions require confirmation before proceeding
- The confirmation clearly states what will happen and that it cannot be undone
- I can cancel at the confirmation step

**Solution:**
- Confirmation dialog for: permanent group removal, trash emptying, permanent file deletion, cache clearing, and result file deletion
- Dialog shows the specific action and its consequences
- OK/Cancel buttons with the destructive option visually distinct

---

## 15. BACKUP AND PORTABILITY

### US-150: Full state export and import

**Story:** As a user, I want to export and import my complete application state, so that I can back it up or transfer everything to another machine.

**Acceptance Criteria:**
- I can export a single file containing all settings, scan results, review decisions, and the ignore list
- I can import from that file to restore the full state
- The export does not include actual images — only application metadata and decisions

**Solution:**
- Export as a single compressed archive containing all configuration and data files
- Import restores the full state from that archive
- Available from the Results page

---

### US-151: Non-destructive updates

**Story:** As a user, I want to update the application by extracting a new version over the existing folder, without losing any of my data.

**Acceptance Criteria:**
- Extracting the update replaces only application code files
- All data (settings, results, decisions, ignore list, fingerprint cache) is preserved
- No manual migration or data backup is needed

**Solution:**
- Distribution archive excludes all data directories
- All persistent state stored in dedicated data directories that are not overwritten
- Code files (application logic, interface, stylesheets) are safely overwritable

---

*Total: 72 user stories across 15 functional areas.*
*Each story has testable acceptance criteria (describing what, not how) and a documented solution (describing current design choices).*
