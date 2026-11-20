# Manual QA Checklist — Maya Video Studio

Use this checklist in desktop Chrome, Edge, and Firefox (>= 1024px viewport) to verify browser behaviors that unit tests cannot cover.

## 1. Layout & Privacy
- [ ] Resize the browser window below `1024px` wide and confirm the desktop-required notice appears cleanly. Resize back to `>= 1024px` and confirm the 3-panel + bottom timeline NLE workspace restores.
- [ ] Verify the privacy notice reads: `"Your videos stay on your device."` Confirm **zero** network requests leave the device with video bytes, file names, or external API calls during import/editing/export (only local static `/ffmpeg/ffmpeg-core.js`, `/ffmpeg/ffmpeg-core.wasm`, and `/ffmpeg/font.ttf`).
- [ ] Edit the project name inline in the top bar and confirm Undo/Redo history updates cleanly.

## 2. Multi-Clip Media Library & Asset Validation
- [ ] Drop or select multiple MP4/MOV videos (`<= 200 MB`, `<= 10 min` each) at once and also import a 2nd/3rd video later; confirm thumbnails, names, durations, and dimensions render in the Media tab.
- [ ] Confirm spoofed `.mp4` files, `> 200 MB` single files, `> 10 min` videos, exceeding the `400 MB` total video budget, and exceeding `20` clips on the Video track all display clear validation errors.
- [ ] Click **Add to timeline** on a video library item (places it at the end of the ripple Video track) and drag another library item onto the Video track (inserts at the drop/playhead position).
- [ ] Click the **Remove** button on a library item and confirm it removes both the library entry and its clips from the timeline while rippling remaining Video clips cleanly.
- [ ] Import an audio file (`MP3`, `WAV`, or `M4A`, `<= 20 MB`) and a PNG/JPG image (`<= 5 MB`); confirm spoofed/oversized files are rejected and valid clips add to the timeline.

## 3. Ripple Video Track, Timeline & Keyboard Shortcuts
- [ ] Drag a Video track clip left or right past neighbors and confirm it reorders cleanly with zero gaps (strict ripple).
- [ ] Split, trim (left/right edges), duplicate (`Ctrl/Cmd+D`), and delete (`Delete`/`Backspace`) individual Video track clips and verify zero gaps remain.
- [ ] Scrub the playhead across the time ruler (project time `0 .. totalDuration`); zoom with the zoom slider, `+`/`-` keys, and `Ctrl+Wheel`.
- [ ] Toggle **Snap** on/off, add stacked **Text row** / **Overlay row** lanes, drag text/image clips vertically across rows, and toggle track **Mute** / **Hide** icons.
- [ ] Test keyboard shortcuts: `Space` (play/pause), `ArrowLeft` / `ArrowRight` (1 frame; `Shift` = 1s), `S` (split at playhead), `Delete` / `Backspace`, `Ctrl/Cmd+D`, `Ctrl/Cmd+Z` / `Ctrl/Cmd+Shift+Z` (including single-step undo after dragging a clip or preview overlay).

## 4. Multi-Clip Mixed-Size Preview & Export (Required End-to-End Check)
- [ ] **3-Clip Mixed Sources + Silent Clip + Text Across Cut**:
  1. Import **3 video clips with different resolutions/aspect ratios** (e.g., 16:9 landscape, 9:16 portrait, and 1:1 square), where **1 of the clips has no audio track**.
  2. Confirm all 3 clips play back continuously across cuts in project time while text, overlay, and audio tracks stay synced.
  3. Drag a clip on the Video track to reorder the sequence.
  4. Place a **Text** clip spanning across the boundary cut between two differently sized clips.
  5. Open **Export Project** and confirm Canvas presets (`Original`, `1080p 16:9`, `720p 16:9`, `9:16`, `1:1`) and Framing (`Fit (black bars)` vs `Fill (crop)`) update the preview stage cleanly.
  6. Export the project with **Fit** and again with **Fill**, then play back both downloaded MP4 files and verify smooth transitions across cuts, zero audio-desync or failure around the silent clip, consistent frame rate, and crisp text overlay across the cut.

## 5. AI Captions (Gemini)
- [ ] Open **Settings**, confirm the API key field is masked, verify the `aistudio.google.com` link, save a key, reload the page, and confirm persistence in `localStorage`. Test **Remove key**.
- [ ] In the **AI** tab, select a language (and test `Auto-detect`) and click **Generate Captions**. Confirm timestamped clips populate the **Captions** track, appear on the preview, are editable in the Inspector, and export via **Download .srt**.

## 6. Audio-Only Export & Cancellation
- [ ] Test **Quality** (`Small`, `Balanced`, `High`), **Export audio only (mp3)**, `> 2 minute` slow re-encode warning, and **Cancel Export** mid-render.
