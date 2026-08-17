# Primary FRCA Revision Library

An offline-friendly Primary FRCA revision app with:

- 800 source questions from QBase 6 and Get Through Primary FRCA MTFs
- Learning, untimed practice, and timed exam modes
- Multiple True/False and user-authored single-best-answer MCQs
- Search, filters, bookmarks, mistake review, progress saving, and dark mode
- Adaptive spaced-review scheduling with confidence ratings and a due queue
- Performance dashboard, topic analysis, daily goals, and a mistake notebook
- Flexible timed exams with weak/due/random selection and balanced chapters
- Personal notes, issue markers, JSON/CSV question import, and shareable exam setup links
- Responsive mobile navigation, keyboard shortcuts, larger text, and accessibility improvements
- Installable offline-friendly PWA support

## Local development

```bash
npm install
npm run dev
```

## Production build

```bash
npm run build
```

The included GitHub Actions workflow publishes the `dist` directory to GitHub Pages on every push to `main`.

Progress and personal MCQs are stored locally in each browser and device.
