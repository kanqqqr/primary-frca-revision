/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/set-state-in-effect, @typescript-eslint/no-unused-expressions */

import { useEffect, useMemo, useState } from "react";
import questionsData from "./data/questions.json";

type Option = { key: string; text: string; correct: boolean };
type QuestionFormat = "true-false" | "mcq";
type AnswerValue = boolean | string;
type Answers = Record<string, AnswerValue>;
type Question = {
  id: string;
  book: string;
  section: string;
  number: number;
  question: string;
  options: Option[];
  explanation: string;
  chapters: string[];
  source: string;
  type?: string;
  format?: QuestionFormat;
  answer?: string;
  custom?: boolean;
};
type Progress = { bookmarked?: boolean; answered?: boolean; correct?: number; attempts?: number };
type Mode = "home" | "library" | "practice" | "exam" | "results" | "create";

const QUESTIONS = questionsData as Question[];
const TRUE_FALSE_COUNT = QUESTIONS.filter((q) => getFormat(q) === "true-false").length;
const MCQ_COUNT = QUESTIONS.filter((q) => getFormat(q) === "mcq").length;
const pageSize = 10;

function shuffle<T>(items: T[]) {
  return [...items].sort(() => Math.random() - 0.5);
}

function loadProgress(): Record<string, Progress> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem("frca-progress") || "{}");
  } catch {
    return {};
  }
}

function loadCustomQuestions(): Question[] {
  if (typeof window === "undefined") return [];
  try {
    const saved = JSON.parse(localStorage.getItem("frca-custom-questions") || "[]");
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

function getFormat(q: Question): QuestionFormat {
  return q.answer || q.format === "mcq" ? "mcq" : "true-false";
}

function scoreTotal(q: Question) {
  return getFormat(q) === "mcq" ? 1 : q.options.length;
}

function isComplete(q: Question, answers: Answers) {
  if (getFormat(q) === "mcq") return typeof answers.selected === "string";
  return q.options.every((option) => typeof answers[option.key] === "boolean");
}

function scoreQuestion(q: Question, answers: Answers) {
  if (getFormat(q) === "mcq") return answers.selected === q.answer ? 1 : 0;
  return q.options.reduce((total, option) => total + (answers[option.key] === option.correct ? 1 : 0), 0);
}

export default function Home() {
  const [mode, setMode] = useState<Mode>("home");
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [progress, setProgress] = useState<Record<string, Progress>>({});
  const [customQuestions, setCustomQuestions] = useState<Question[]>([]);
  const [query, setQuery] = useState("");
  const [book, setBook] = useState("all");
  const [section, setSection] = useState("all");
  const [chapter, setChapter] = useState("all");
  const [status, setStatus] = useState("all");
  const [libraryFormat, setLibraryFormat] = useState<QuestionFormat | "all">("all");
  const [page, setPage] = useState(1);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [practiceQuestions, setPracticeQuestions] = useState<Question[]>([]);
  const [practiceIndex, setPracticeIndex] = useState(0);
  const [practiceAnswers, setPracticeAnswers] = useState<Record<string, Answers>>({});
  const [practiceSubmitted, setPracticeSubmitted] = useState(false);
  const [examQuestions, setExamQuestions] = useState<Question[]>([]);
  const [examIndex, setExamIndex] = useState(0);
  const [examAnswers, setExamAnswers] = useState<Record<string, Answers>>({});
  const [examFlags, setExamFlags] = useState<Set<string>>(new Set());
  const [examSeconds, setExamSeconds] = useState(0);
  const [examStarted, setExamStarted] = useState(false);
  const [questionFormat, setQuestionFormat] = useState<QuestionFormat>("true-false");
  const [examConfig, setExamConfig] = useState({
    book: "all",
    section: "all",
    chapter: "all",
    format: "true-false" as QuestionFormat,
    count: 20,
    minutes: 25,
  });

  const allQuestions = useMemo(() => QUESTIONS.concat(customQuestions), [customQuestions]);
  const allBooks = useMemo(() => [...new Set(allQuestions.map((q) => q.book))], [allQuestions]);
  const allSections = useMemo(() => [...new Set(allQuestions.map((q) => q.section))], [allQuestions]);
  const allChapters = useMemo(() => [...new Set(allQuestions.flatMap((q) => q.chapters))].sort(), [allQuestions]);

  useEffect(() => {
    setProgress(loadProgress());
    setCustomQuestions(loadCustomQuestions());
    const savedTheme = localStorage.getItem("frca-theme") as "light" | "dark" | null;
    if (savedTheme) setTheme(savedTheme);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("frca-theme", theme);
  }, [theme]);
  useEffect(() => {
    localStorage.setItem("frca-progress", JSON.stringify(progress));
  }, [progress]);
  useEffect(() => {
    localStorage.setItem("frca-custom-questions", JSON.stringify(customQuestions));
  }, [customQuestions]);
  useEffect(() => {
    if (!examStarted || examSeconds <= 0) return;
    const timer = window.setInterval(() => setExamSeconds((value) => value - 1), 1000);
    return () => window.clearInterval(timer);
  }, [examStarted, examSeconds]);
  useEffect(() => {
    if (examStarted && examSeconds === 0) finishExam();
  }, [examSeconds, examStarted]);

  const filtered = useMemo(
    () =>
      allQuestions.filter((q) => {
        const p = progress[q.id] || {};
        const haystack = [q.question, q.book, q.section, q.chapters.join(" "), q.options.map((o) => o.text).join(" ")].join(" ").toLowerCase();
        const needsReview = p.answered && p.correct !== scoreTotal(q);
        return (
          (book === "all" || q.book === book) &&
          (section === "all" || q.section === section) &&
          (chapter === "all" || q.chapters.includes(chapter)) &&
          (libraryFormat === "all" || getFormat(q) === libraryFormat) &&
          (status === "all" ||
            (status === "bookmarked" && p.bookmarked) ||
            (status === "unanswered" && !p.answered) ||
            (status === "incorrect" && needsReview)) &&
          (!query.trim() || haystack.includes(query.toLowerCase().trim()))
        );
      }),
    [allQuestions, book, chapter, libraryFormat, progress, query, section, status],
  );

  const answered = allQuestions.filter((q) => progress[q.id]?.answered).length;
  const reviewCount = allQuestions.filter((q) => {
    const p = progress[q.id];
    return p?.bookmarked || (p?.answered && p.correct !== scoreTotal(q));
  }).length;

  function updateProgress(id: string, value: Progress) {
    setProgress((current) => ({ ...current, [id]: { ...current[id], ...value } }));
  }

  function startPractice(source = filtered, requestedFormat = questionFormat) {
    const matching = source.filter((q) => getFormat(q) === requestedFormat);
    const fallback = allQuestions.filter((q) => getFormat(q) === requestedFormat);
    const pool = matching.length ? matching : fallback;
    setPracticeQuestions(shuffle(pool).slice(0, Math.min(20, pool.length)));
    setPracticeIndex(0);
    setPracticeAnswers({});
    setPracticeSubmitted(false);
    setMode("practice");
  }

  function startExam() {
    const pool = allQuestions.filter(
      (q) =>
        getFormat(q) === examConfig.format &&
        (examConfig.book === "all" || q.book === examConfig.book) &&
        (examConfig.section === "all" || q.section === examConfig.section) &&
        (examConfig.chapter === "all" || q.chapters.includes(examConfig.chapter)),
    );
    setExamQuestions(shuffle(pool).slice(0, Math.min(examConfig.count, pool.length)));
    setExamIndex(0);
    setExamAnswers({});
    setExamFlags(new Set());
    setExamSeconds(examConfig.minutes * 60);
    setExamStarted(true);
    setMode("exam");
  }

  function setAnswer(kind: "practice" | "exam", q: Question, key: string, value: AnswerValue) {
    const setter = kind === "practice" ? setPracticeAnswers : setExamAnswers;
    setter((current) => ({ ...current, [q.id]: { ...(current[q.id] || {}), [key]: value } }));
  }

  function submitPractice() {
    const q = practiceQuestions[practiceIndex];
    if (!q) return;
    const answers = practiceAnswers[q.id] || {};
    if (!isComplete(q, answers)) return;
    updateProgress(q.id, { answered: true, correct: scoreQuestion(q, answers), attempts: (progress[q.id]?.attempts || 0) + 1 });
    setPracticeSubmitted(true);
  }

  function finishExam() {
    setExamStarted(false);
    setMode("results");
  }

  function saveCustomQuestion(question: Question) {
    setCustomQuestions((current) => current.concat(question));
    setQuestionFormat("mcq");
    setMode("home");
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="mobile-menu" onClick={() => document.body.classList.toggle("nav-open")} aria-label="Open navigation">☰</button>
        <div className="brand-mark">FR</div>
        <div className="brand"><strong>Primary FRCA Revision</strong><span>QBase 6 + Get Through MTFs</span></div>
        <div className="top-actions"><button className="theme-toggle" onClick={() => setTheme(theme === "light" ? "dark" : "light")} aria-label="Toggle dark mode">{theme === "light" ? "☾" : "☀"}</button><button className="reset-button" onClick={() => { if (window.confirm("Reset all saved progress?")) setProgress({}); }}>Reset</button></div>
      </header>
      <div className="layout">
        <aside className="sidebar" id="sidebar">
          <div className="side-label">Start here</div>
          <NavButton active={mode === "home"} onClick={() => setMode("home")} icon="⌂" label="Choose a quiz" />
          <div className="side-label section-label">Workspace</div>
          <NavButton active={mode === "library"} onClick={() => setMode("library")} icon="▦" label="Question library" count={allQuestions.length} />
          <NavButton active={mode === "practice"} onClick={() => startPractice(filtered)} icon="◉" label="Practice session" count={answered} />
          <NavButton active={mode === "exam"} onClick={() => { setExamStarted(false); setMode("exam"); }} icon="◷" label="Exam simulator" />
          <NavButton active={mode === "create"} onClick={() => setMode("create")} icon="＋" label="Create an MCQ" count={customQuestions.length} />
          <NavButton active={mode === "results"} onClick={() => setMode("results")} icon="↗" label="Latest results" />
          <NavButton active={false} onClick={() => { setStatus("bookmarked"); setMode("library"); }} icon="★" label="Review queue" count={reviewCount} />
          <div className="side-label section-label">Books</div>
          {allBooks.map((value) => <button className="book-link" key={value} onClick={() => { setBook(value); setSection("all"); setMode("library"); setPage(1); }}>{value}<span>{allQuestions.filter((q) => q.book === value).length}</span></button>)}
        </aside>
        <main className="main-content">
          <div className="content-wrap">
            {mode === "home" && <HomeView answered={answered} totalQuestions={allQuestions.length} sourceCount={allBooks.length} selectedFormat={questionFormat} onSelectFormat={setQuestionFormat} trueFalseCount={TRUE_FALSE_COUNT} mcqCount={customQuestions.length + MCQ_COUNT} customQuestions={customQuestions} onCreate={() => setMode("create")} onBrowse={(selectedBook: string, selectedFormat: QuestionFormat) => { setBook(selectedBook); setLibraryFormat(selectedFormat); setSection("all"); setMode("library"); }} onPractice={(selectedBook: string, selectedFormat: QuestionFormat) => { const pool = selectedBook === "all" ? allQuestions : allQuestions.filter((q) => q.book === selectedBook); startPractice(pool, selectedFormat); }} onExam={(selectedBook: string, selectedFormat: QuestionFormat) => { setExamConfig((current) => ({ ...current, book: selectedBook, format: selectedFormat })); setExamStarted(false); setMode("exam"); }} />}
            {mode === "create" && <CreateQuestionView existingCount={customQuestions.length} onSave={saveCustomQuestion} onCancel={() => setMode("home")} />}
            {mode === "library" && <LibraryView filtered={filtered} page={page} setPage={setPage} query={query} setQuery={setQuery} book={book} setBook={setBook} section={section} setSection={setSection} chapter={chapter} setChapter={setChapter} libraryFormat={libraryFormat} setLibraryFormat={setLibraryFormat} status={status} setStatus={setStatus} revealed={revealed} setRevealed={setRevealed} progress={progress} updateProgress={updateProgress} startPractice={startPractice} bookOptions={allBooks} sectionOptions={allSections} chapterOptions={allChapters} mcqCount={customQuestions.length + MCQ_COUNT} />}
            {mode === "practice" && <PracticeView questions={practiceQuestions} index={practiceIndex} setIndex={setPracticeIndex} answers={practiceAnswers} setAnswer={setAnswer} submitted={practiceSubmitted} submit={submitPractice} onFinish={() => setMode("home")} />}
            {mode === "exam" && <ExamView started={examStarted} questions={examQuestions} index={examIndex} setIndex={setExamIndex} answers={examAnswers} setAnswer={setAnswer} flags={examFlags} setFlags={setExamFlags} seconds={examSeconds} config={examConfig} setConfig={setExamConfig} start={startExam} finish={finishExam} questionPool={allQuestions} bookOptions={allBooks} sectionOptions={allSections} chapterOptions={allChapters} />}
            {mode === "results" && <ResultsView questions={examQuestions} answers={examAnswers} onRestart={() => setMode("exam")} onReview={() => { setStatus("incorrect"); setMode("library"); }} />}
          </div>
        </main>
      </div>
    </div>
  );
}

function NavButton({ active, onClick, icon, label, count }: { active: boolean; onClick: () => void; icon: string; label: string; count?: number }) {
  return <button className={"nav-item " + (active ? "active" : "")} onClick={onClick}><b>{icon}</b><span>{label}</span>{count !== undefined && <small>{count}</small>}</button>;
}

function FormatPicker({ value, onChange, trueFalseCount, mcqCount }: { value: QuestionFormat; onChange: (value: QuestionFormat) => void; trueFalseCount: number; mcqCount: number }) {
  return <div className="format-picker" role="group" aria-label="Question format"><button className={"format-choice " + (value === "true-false" ? "active" : "")} onClick={() => onChange("true-false")}><span className="format-icon">T/F</span><span><strong>True / False MTF</strong><small>Judge each statement independently</small></span><b>{trueFalseCount} available</b></button><button className={"format-choice " + (value === "mcq" ? "active" : "")} onClick={() => onChange("mcq")}><span className="format-icon">MCQ</span><span><strong>Single-best-answer MCQ</strong><small>Choose one answer from five options</small></span><b>{mcqCount ? mcqCount + " available" : "Create your first"}</b></button></div>;
}

function HomeView({ answered, totalQuestions, sourceCount, selectedFormat, onSelectFormat, trueFalseCount, mcqCount, customQuestions, onCreate, onBrowse, onPractice, onExam }: any) {
  const sourceCountFor = (book: string) => QUESTIONS.filter((q) => q.book === book && getFormat(q) === selectedFormat).length;
  const customCount = customQuestions.filter((q: Question) => getFormat(q) === selectedFormat).length;
  return <><section className="hero home-hero"><div><p className="eyebrow">Primary FRCA question bank</p><h1>Choose what you want to practise.</h1><p>Pick the question format and source first. Then choose learning or exam mode.</p></div><div className="stats"><Stat value={totalQuestions} label="questions" /><Stat value={sourceCount} label="sources" /><Stat value={answered} label="answered" /></div></section><div className="workflow-steps"><span className="current"><b>1</b> Choose a format</span><span><b>2</b> Choose a source</span><span><b>3</b> Start the quiz</span></div><section className="format-panel"><div><p className="eyebrow">Question format</p><h2>How do you want to answer?</h2><p>Choose True/False MTF or a real single-best-answer MCQ.</p></div><FormatPicker value={selectedFormat} onChange={onSelectFormat} trueFalseCount={trueFalseCount} mcqCount={mcqCount} /></section><div className="format-note"><strong>Important distinction</strong><span>The attached QBase 6 and Get Through books use legacy MTF questions: each A–E statement is marked True or False. Your created MCQs use one-choice SBA controls, matching the current Primary FRCA style.</span></div><div className="source-grid"><SourceCard icon="📚" title="QBase 6" description="Legacy MCQ companion with five independent True/False statements per question." count={sourceCountFor("QBase 6")} onBrowse={() => onBrowse("QBase 6", selectedFormat)} onPractice={() => onPractice("QBase 6", selectedFormat)} onExam={() => onExam("QBase 6", selectedFormat)} /><SourceCard icon="📝" title="Get Through Primary FRCA MTFs" description="Five Primary FRCA papers with explanations and chapter tags." count={sourceCountFor("Get Through MTFs")} onBrowse={() => onBrowse("Get Through MTFs", selectedFormat)} onPractice={() => onPractice("Get Through MTFs", selectedFormat)} onExam={() => onExam("Get Through MTFs", selectedFormat)} /><SourceCard icon="◈" title="All question banks" description="Mix both attached sources for a broader random test and spaced revision." count={QUESTIONS.filter((q) => getFormat(q) === selectedFormat).length} onBrowse={() => onBrowse("all", selectedFormat)} onPractice={() => onPractice("all", selectedFormat)} onExam={() => onExam("all", selectedFormat)} /><article className="source-card custom-source-card"><div className="source-icon">✦</div><div className="source-copy"><h2>My MCQs</h2><p>Create five-option single-best-answer questions for the exact topics you want to rehearse.</p><span className="source-count">{customCount ? customCount + " questions in this format" : "No personal MCQs yet"}</span></div><div className="source-actions"><button className="primary-button" onClick={onCreate}>＋ Create an MCQ</button><button className="secondary-button" disabled={!customCount} onClick={() => onBrowse("My MCQs", "mcq")}>Browse my MCQs</button><button className="secondary-button" disabled={!customCount} onClick={() => onPractice("My MCQs", "mcq")}>Practice my MCQs</button><button className="secondary-button" disabled={!customCount} onClick={() => onExam("My MCQs", "mcq")}>Exam mode</button></div></article></div><div className="how-it-works"><div><strong>Learning mode</strong><span>Choose an answer, submit, and see the explanation immediately.</span></div><div><strong>Exam mode</strong><span>Hide answers, use the timer, flag questions, and review your score at the end.</span></div></div></>;
}

function SourceCard({ icon, title, description, count, onBrowse, onPractice, onExam }: { icon: string; title: string; description: string; count: number; onBrowse: () => void; onPractice: () => void; onExam: () => void }) {
  const available = count > 0;
  return <article className="source-card"><div className="source-icon">{icon}</div><div className="source-copy"><h2>{title}</h2><p>{description}</p><span className="source-count">{count ? count + " questions in this format" : "No questions in this format"}</span></div><div className="source-actions"><button className="secondary-button" disabled={!available} onClick={onBrowse}>Browse chapters</button><button className="secondary-button" disabled={!available} onClick={onPractice}>Learning mode</button><button className="primary-button" disabled={!available} onClick={onExam}>Exam mode →</button></div></article>;
}

function Filters({ query, setQuery, book, setBook, section, setSection, chapter, setChapter, libraryFormat, setLibraryFormat, status, setStatus, bookOptions, sectionOptions, chapterOptions, mcqCount }: any) {
  return <div className="toolbar"><div className="toolbar-row"><label className="search-box">⌕<input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search questions, options, chapters…" /></label><select value={book} onChange={(e) => setBook(e.target.value)}><option value="all">All books</option>{bookOptions.map((v: string) => <option key={v}>{v}</option>)}</select><select value={section} onChange={(e) => setSection(e.target.value)}><option value="all">All sections</option>{sectionOptions.map((v: string) => <option key={v}>{v}</option>)}</select><select value={chapter} onChange={(e) => setChapter(e.target.value)}><option value="all">All chapters</option>{chapterOptions.map((v: string) => <option key={v}>{v}</option>)}</select><select value={libraryFormat} onChange={(e) => setLibraryFormat(e.target.value)}><option value="all">All formats</option><option value="true-false">True / False MTF</option><option value="mcq" disabled={!mcqCount}>Single-best-answer MCQ{mcqCount ? "" : " (create one first)"}</option></select><select value={status} onChange={(e) => setStatus(e.target.value)}><option value="all">All status</option><option value="unanswered">Unanswered</option><option value="bookmarked">Bookmarked</option><option value="incorrect">Needs review</option></select></div></div>;
}

function LibraryView({ filtered, page, setPage, query, setQuery, book, setBook, section, setSection, chapter, setChapter, libraryFormat, setLibraryFormat, status, setStatus, revealed, setRevealed, progress, updateProgress, startPractice, bookOptions, sectionOptions, chapterOptions, mcqCount }: any) {
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageQuestions = filtered.slice((page - 1) * pageSize, page * pageSize);
  return <><section className="hero"><div><p className="eyebrow">Revision library</p><h1>Build reliable recall.</h1><p>Study the source material, test yourself, and keep weak areas visible.</p></div><div className="stats"><Stat value={filtered.length} label="matching" /><Stat value={filtered.filter((q: Question) => progress[q.id]?.answered).length} label="answered" /><Stat value={filtered.filter((q: Question) => progress[q.id]?.bookmarked).length} label="bookmarked" /></div></section><Filters {...{ query, setQuery, book, setBook, section, setSection, chapter, setChapter, libraryFormat, setLibraryFormat, status, setStatus, bookOptions, sectionOptions, chapterOptions, mcqCount }} /><div className="library-actions"><span>{filtered.length} questions</span><button className="primary-button" disabled={!filtered.length} onClick={() => startPractice(filtered)}>Start a quick practice</button></div><div className="question-list">{pageQuestions.map((q: Question) => <QuestionCard key={q.id} q={q} progress={progress[q.id] || {}} open={revealed.has(q.id)} onReveal={() => setRevealed((s: Set<string>) => { const next = new Set(s); next.has(q.id) ? next.delete(q.id) : next.add(q.id); return next; })} onBookmark={() => updateProgress(q.id, { bookmarked: !progress[q.id]?.bookmarked })} />)}</div>{!pageQuestions.length && <div className="empty"><strong>No questions match these filters.</strong>Try another format or create your first personal MCQ.</div>}<Pagination page={page} totalPages={totalPages} setPage={setPage} /></>;
}

function QuestionCard({ q, progress, open, onReveal, onBookmark }: { q: Question; progress: Progress; open: boolean; onReveal: () => void; onBookmark: () => void }) {
  const mcq = getFormat(q) === "mcq";
  return <article className="question-card"><div className="question-head"><span className="question-number">Q{q.number}</span><div className="question-title"><h2>{q.question}</h2><div className="badges"><span className="badge book-badge">{q.book}</span><span className="badge">{q.section}</span>{q.chapters.slice(0, 2).map((c) => <span className="badge chapter-badge" key={c}>{c}</span>)}</div></div><button className={"bookmark " + (progress.bookmarked ? "on" : "")} onClick={onBookmark} aria-label="Bookmark question">★</button></div><div className="options">{q.options.map((o) => { const correct = mcq ? o.key === q.answer : o.correct; return <div className={"option " + (open ? (correct ? "correct" : "incorrect") : "")} key={o.key}><b>{o.key}.</b><span>{o.text}</span>{open && <em className={correct ? "true" : "false"}>{mcq ? (correct ? "Best answer" : "Not selected") : (correct ? "True" : "False")}</em>}</div>; })}</div><button className="reveal-button" onClick={onReveal}>{open ? "Hide answer and explanation" : "Reveal answer"}</button>{open && <div className="explanation"><strong>Explanation</strong><p>{q.explanation}</p></div>}<footer>{q.source}{progress.answered && <span>Last attempt: {progress.correct}/{scoreTotal(q)}</span>}</footer></article>;
}

function CreateQuestionView({ existingCount, onSave, onCancel }: { existingCount: number; onSave: (question: Question) => void; onCancel: () => void }) {
  const [stem, setStem] = useState("");
  const [options, setOptions] = useState(["", "", "", "", ""]);
  const [answer, setAnswer] = useState("A");
  const [chapter, setChapter] = useState("");
  const [explanation, setExplanation] = useState("");
  const [error, setError] = useState("");
  function updateOption(index: number, value: string) {
    setOptions((current) => current.map((item, itemIndex) => itemIndex === index ? value : item));
  }
  function save() {
    if (!stem.trim()) return setError("Add the question stem first.");
    if (options.some((option) => !option.trim())) return setError("Add text for all five options.");
    const keys = ["A", "B", "C", "D", "E"];
    onSave({ id: "custom-mcq-" + Date.now(), book: "My MCQs", section: "Created MCQs", number: existingCount + 1, question: stem.trim(), options: options.map((text, index) => ({ key: keys[index], text: text.trim(), correct: keys[index] === answer })), explanation: explanation.trim() || "Created by you.", chapters: [chapter.trim() || "My MCQs"], source: "Created in Primary FRCA Revision", type: "single-best-answer", format: "mcq", answer, custom: true });
  }
  return <><section className="hero"><div><p className="eyebrow">MCQ builder</p><h1>Create a single-best-answer question.</h1><p>Write the stem, add five options, and mark exactly one best answer. It will be saved in this browser.</p></div><div className="stats"><Stat value={existingCount} label="created" /><Stat value={5} label="options" /></div></section><div className="creator-card"><label className="creator-field"><span>Question stem</span><textarea value={stem} onChange={(e) => setStem(e.target.value)} placeholder="For example: Which statement best describes…?" rows={4} /></label><div className="creator-options"><div className="creator-section-heading"><strong>Answer options</strong><span>Select the radio button beside the single best answer.</span></div>{options.map((value, index) => { const key = ["A", "B", "C", "D", "E"][index]; return <div className={"creator-option " + (answer === key ? "selected" : "")} key={key}><input type="radio" name="correct-answer" checked={answer === key} onChange={() => setAnswer(key)} aria-label={"Mark option " + key + " as correct"} /><b>{key}</b><input value={value} onChange={(e) => updateOption(index, e.target.value)} placeholder={"Option " + key} /></div>; })}</div><div className="creator-grid"><label className="creator-field"><span>Chapter tag <small>optional</small></span><input value={chapter} onChange={(e) => setChapter(e.target.value)} placeholder="e.g. Cardiovascular physiology" /></label><label className="creator-field"><span>Explanation <small>optional</small></span><textarea value={explanation} onChange={(e) => setExplanation(e.target.value)} placeholder="Why is this the best answer?" rows={3} /></label></div>{error && <div className="creator-error">{error}</div>}<div className="creator-actions"><button className="secondary-button" onClick={onCancel}>Cancel</button><button className="primary-button" onClick={save}>Save MCQ</button></div></div></>;
}

function AnswerControls({ q, current, submitted, onSelect }: { q: Question; current: Answers; submitted?: boolean; onSelect: (key: string, value: AnswerValue) => void }) {
  if (getFormat(q) === "mcq") {
    return <div className="mcq-choice-grid">{q.options.map((option) => { const chosen = current.selected === option.key; const correct = option.key === q.answer; const state = submitted ? (correct ? "correct" : chosen ? "incorrect" : "") : chosen ? "selected" : ""; return <button type="button" className={"mcq-choice " + state} disabled={submitted} key={option.key} onClick={() => onSelect("selected", option.key)}><b>{option.key}</b><span>{option.text}</span>{submitted && correct && <em>Best answer</em>}</button>; })}</div>;
  }
  return <div className="practice-options">{q.options.map((option) => <div className="practice-option" key={option.key}><b>{option.key}.</b><span>{option.text}</span><div><button type="button" className={current[option.key] === true ? "selected" : ""} disabled={submitted} onClick={() => onSelect(option.key, true)}>True</button><button type="button" className={current[option.key] === false ? "selected" : ""} disabled={submitted} onClick={() => onSelect(option.key, false)}>False</button></div></div>)}</div>;
}

function PracticeView({ questions, index, setIndex, answers, setAnswer, submitted, submit, onFinish }: any) {
  const q = questions[index];
  if (!q) return <div className="empty"><strong>No practice set yet.</strong><button className="primary-button" onClick={onFinish}>Back to start</button></div>;
  const current: Answers = answers[q.id] || {};
  const done = isComplete(q, current);
  const result = submitted ? scoreQuestion(q, current) : null;
  const total = scoreTotal(q);
  const mcq = getFormat(q) === "mcq";
  return <><section className="hero compact"><div><p className="eyebrow">Untimed practice · {mcq ? "Single-best-answer MCQ" : "True / False MTF"}</p><h1>One question at a time.</h1><p>{mcq ? "Choose the single best answer. The explanation appears after submission." : "Judge each statement True or False. The explanation appears after submission."}</p></div><div className="session-counter">{index + 1} <span>/ {questions.length}</span></div></section><div className="practice-card"><div className="progress-line"><span style={{ width: (((index + 1) / questions.length) * 100) + "%" }} /></div><div className="badges"><span className="badge book-badge">{q.book}</span><span className="badge">{q.section}</span></div><h2>{q.question}</h2><AnswerControls q={q} current={current} submitted={submitted} onSelect={(key, value) => setAnswer("practice", q, key, value)} />{result !== null && <div className="result-callout"><strong>{result}/{total} correct</strong><p>{q.explanation}</p></div>}<div className="practice-footer"><button className="secondary-button" onClick={() => setIndex(Math.max(0, index - 1))}>Previous</button>{submitted ? <button className="primary-button" onClick={() => setIndex(Math.min(questions.length - 1, index + 1))}>Next question</button> : <button className="primary-button" disabled={!done} onClick={submit}>Submit answer</button>}<button className="secondary-button" onClick={onFinish}>Exit</button></div></div></>;
}

function ExamView({ started, questions, index, setIndex, answers, setAnswer, flags, setFlags, seconds, config, setConfig, start, finish, questionPool, bookOptions, sectionOptions, chapterOptions }: any) {
  if (!started) return <ExamBuilder config={config} setConfig={setConfig} start={start} questionPool={questionPool} bookOptions={bookOptions} sectionOptions={sectionOptions} chapterOptions={chapterOptions} />;
  const q = questions[index];
  if (!q) return <div className="empty"><strong>No questions available for this exam.</strong><button className="secondary-button" onClick={() => finish()}>Back</button></div>;
  const current: Answers = answers[q.id] || {};
  return <><section className="hero compact"><div><p className="eyebrow">Exam simulator · {getFormat(q) === "mcq" ? "Single-best-answer MCQ" : "True / False MTF"}</p><h1>Focus under pressure.</h1><p>Answers and explanations stay hidden until you submit the exam.</p></div><div className="timer">{formatStatic(seconds)}</div></section><div className="exam-layout"><div className="practice-card exam-card"><div className="exam-meta"><span>Question {index + 1} of {questions.length}</span><button className={flags.has(q.id) ? "flag active" : "flag"} onClick={() => setFlags((s: Set<string>) => { const n = new Set(s); n.has(q.id) ? n.delete(q.id) : n.add(q.id); return n; })}>⚑ {flags.has(q.id) ? "Flagged" : "Flag"}</button></div><h2>{q.question}</h2><AnswerControls q={q} current={current} onSelect={(key, value) => setAnswer("exam", q, key, value)} /><div className="practice-footer"><button className="secondary-button" onClick={() => setIndex(Math.max(0, index - 1))}>Previous</button>{index === questions.length - 1 ? <button className="primary-button" onClick={finish}>Submit exam</button> : <button className="primary-button" onClick={() => setIndex(index + 1)}>Next question</button>}</div></div><aside className="question-map"><strong>Question map</strong><div>{questions.map((item: Question, i: number) => <button key={item.id} className={(i === index ? "current " : "") + (isComplete(item, answers[item.id] || {}) ? "answered " : "") + (flags.has(item.id) ? "flagged" : "")} onClick={() => setIndex(i)}>{i + 1}</button>)}</div><p>{questions.filter((item: Question) => isComplete(item, answers[item.id] || {})).length} answered · {flags.size} flagged</p></aside></div></>;
}

function ExamBuilder({ config, setConfig, start, questionPool, bookOptions, sectionOptions, chapterOptions }: any) {
  const pool = questionPool.filter((q: Question) => getFormat(q) === config.format && (config.book === "all" || q.book === config.book) && (config.section === "all" || q.section === config.section) && (config.chapter === "all" || q.chapters.includes(config.chapter)));
  const mcqCount = questionPool.filter((q: Question) => getFormat(q) === "mcq").length;
  const trueFalseCount = questionPool.filter((q: Question) => getFormat(q) === "true-false").length;
  return <><section className="hero"><div><p className="eyebrow">Exam simulator</p><h1>Design your test.</h1><p>Choose a format and source, set a time limit, and work through a random paper.</p></div></section><div className="builder-card"><div className="builder-grid"><label>Format<select value={config.format} onChange={(e) => setConfig({ ...config, format: e.target.value })}><option value="true-false">True / False MTF ({trueFalseCount})</option><option value="mcq" disabled={!mcqCount}>Single-best-answer MCQ ({mcqCount})</option></select></label><label>Book<select value={config.book} onChange={(e) => setConfig({ ...config, book: e.target.value })}><option value="all">All books</option>{bookOptions.map((v: string) => <option key={v}>{v}</option>)}</select></label><label>Section<select value={config.section} onChange={(e) => setConfig({ ...config, section: e.target.value })}><option value="all">All sections</option>{sectionOptions.map((v: string) => <option key={v}>{v}</option>)}</select></label><label>Chapter<select value={config.chapter} onChange={(e) => setConfig({ ...config, chapter: e.target.value })}><option value="all">All chapters</option>{chapterOptions.map((v: string) => <option key={v}>{v}</option>)}</select></label><label>Questions<select value={config.count} onChange={(e) => setConfig({ ...config, count: Number(e.target.value) })}><option value={10}>10 questions</option><option value={20}>20 questions</option><option value={40}>40 questions</option><option value={90}>90 questions</option></select></label><label>Time limit<select value={config.minutes} onChange={(e) => setConfig({ ...config, minutes: Number(e.target.value) })}><option value={15}>15 minutes</option><option value={25}>25 minutes</option><option value={45}>45 minutes</option><option value={90}>90 minutes</option></select></label></div><div className="builder-summary"><strong>{pool.length} questions available</strong><span>{config.format === "mcq" ? "One answer is selected from five options." : "Each option is scored independently as True or False."}</span></div><button className="primary-button large" disabled={!pool.length} onClick={start}>Start exam</button></div></>;
}

function ResultsView({ questions, answers, onRestart, onReview }: any) {
  const total = questions.reduce((n: number, q: Question) => n + scoreTotal(q), 0);
  const correct = questions.reduce((n: number, q: Question) => n + scoreQuestion(q, answers[q.id] || {}), 0);
  const percentage = total ? Math.round((correct / total) * 100) : 0;
  return <><section className="hero"><div><p className="eyebrow">Exam complete</p><h1>Know what to review next.</h1><p>Your result uses one mark for each SBA, or one mark for each MTF statement.</p></div><div className="score-ring"><strong>{percentage}%</strong><span>{correct}/{total}</span></div></section><div className="results-grid"><div className="result-panel"><h2>Performance</h2><div className="result-bar"><span style={{ width: percentage + "%" }} /></div><p>{percentage >= 80 ? "Strong performance. Keep the momentum." : percentage >= 60 ? "A solid base. Review the flagged areas." : "Use the review queue and try this set again."}</p><div className="practice-footer"><button className="primary-button" onClick={onRestart}>Build another exam</button><button className="secondary-button" onClick={onReview}>Review mistakes</button></div></div><div className="result-panel"><h2>Question breakdown</h2>{questions.slice(0, 12).map((q: Question) => { const result = scoreQuestion(q, answers[q.id] || {}); const itemTotal = scoreTotal(q); return <div className="breakdown-row" key={q.id}><span>Q{q.number} · {q.question}</span><b className={result === itemTotal ? "good" : "needs-review"}>{result}/{itemTotal}</b></div>; })}</div></div></>;
}

function formatStatic(seconds: number) {
  return Math.floor(seconds / 60).toString().padStart(2, "0") + ":" + (seconds % 60).toString().padStart(2, "0");
}

function Stat({ value, label }: { value: number; label: string }) {
  return <div className="stat"><strong>{value}</strong><span>{label}</span></div>;
}

function Pagination({ page, totalPages, setPage }: any) {
  if (totalPages <= 1) return null;
  return <div className="pagination"><button disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</button>{Array.from({ length: Math.min(totalPages, 7) }, (_, i) => <button className={page === i + 1 ? "active" : ""} key={i} onClick={() => setPage(i + 1)}>{i + 1}</button>)}<button disabled={page === totalPages} onClick={() => setPage(page + 1)}>Next</button></div>;
}
