# Symbol Labeler

A static, local-only browser tool for labeling **symbols and elements** in
construction drawings with bounding boxes for object-detection training.

**Project page:** https://noahleegithub.github.io/drawing-symbol-labeler/

## What it does

- Upload a multi-page PDF.
- Define classes (for example `door`, `window`, `column`, `light fixture`).
- Draw, select, move, and resize bounding boxes.
- Mark boxes as **Ignore** so they are excluded from training labels.
- Mark pages complete for review tracking.
- Autosave boxes in the browser for the current PDF.
- Import/export a project JSON.
- Export a detection dataset:
  - rendered page images
  - YOLO labels (normalized `class cx cy w h`)
  - COCO annotations
  - `classes.txt` and `data.yaml`

PDFs and labels stay in the browser. There is no backend, upload endpoint,
analytics, or account system.

## Run locally

```bash
python3 start.py
# or
python3 -m http.server 8765
# open http://localhost:8765/
```

`file://` is not reliable because PDF.js uses ES modules and a worker.

## Controls

| Action | Key / control |
|---|---|
| Select / edit boxes | `V` |
| Draw a box | `B` |
| Switch classes | `1`–`9` |
| Delete selected box | `Delete` / `Backspace` |
| Nudge selected box | Arrow keys; `Shift` for 10× |
| Undo / redo | `Ctrl/Cmd+Z` / `Ctrl/Cmd+Shift+Z` |
| Previous / next page | `PageUp` / `PageDown` |
| Zoom | `+` / `-` |

## Export notes

- **YOLO:** one label file per page; class IDs follow the class-list order.
  Empty label files are valid negative examples.
- **COCO:** boxes are exported at the selected image long edge (1200/2000/3000
  pixels), matching the rendered dataset images.
- **Ignore:** ignored boxes remain in the project JSON but are omitted from
  YOLO and COCO labels.
- **Train/val:** `data.yaml` initially points both splits at the same `images/`
  directory. Split pages into `images/train`, `images/val`, etc. before training.

## Limits

- Axis-aligned bounding boxes only; segmentation masks and rotated boxes are not
  implemented.
- No model-assisted prelabels or central label collection.
- PDFs are not committed or uploaded. Keep source drawings outside the repo.

## Attribution

PDF.js is vendored under `pdfjs/` from `pdfjs-dist 4.10.38` and is licensed under
Apache-2.0. The application code is MIT licensed.
