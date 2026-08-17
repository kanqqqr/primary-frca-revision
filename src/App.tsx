"use client";
/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/set-state-in-effect, @typescript-eslint/no-unused-expressions */

import { useEffect, useMemo, useRef, useState } from "react";
import questionsData from "./data/questions.json";

type Option = { key: string; text: string; correct: boolean };
type QuestionFormat = "true-false" | "mcq";
type Confidence = "low" | "medium" | "high";
type Difficulty = "foundation" | "standard" | "advanced";
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
  difficulty?: Difficulty;
  reviewedAt?: string;
  page?: string;
  questionPage?: number;
  answerPage?: number;
  questionPdfPage?: number;
  answerPdfPage?: number;
};
type Progress = {
  bookmarked?: boolean;
  answered?: boolean;
  correct?: number;
  attempts?: number;
  confidence?: Confidence;
  note?: string;
  reported?: boolean;
  dueAt?: string;
  intervalDays?: number;
  repetitions?: number;
  lapses?: number;
  lastAnsweredAt?: string;
};
type Attempt = {
  id: string;
  questionId: string;
  mode: "practice" | "exam";
  at: string;
  earned: number;
  total: number;
  confidence: Confidence;
  durationSeconds: number;
};
type DailyActivity = { answered: number; earned: number; total: number; seconds: number };
type DailyGoal = { questions: number; minutes: number };
type Mode = "home" | "library" | "practice" | "exam" | "results" | "create" | "dashboard" | "notebook";
type ExamConfig = {
  book: string;
  section: string;
  chapter: string;
  format: QuestionFormat;
  count: number;
  minutes: number;
  selection: "random" | "weak" | "due";
  balanced: boolean;
};

const QUESTIONS = questionsData as Question[];
const TRUE_FALSE_COUNT = QUESTIONS.filter((q) => getFormat(q) === "true-false").length;
const MCQ_COUNT = QUESTIONS.filter((q) => getFormat(q) === "mcq").length;
const pageSize = 10;
const ATTEMPT_LIMIT = 5000;

const STORAGE = {
  progress: "frca-progress",
  attempts: "frca-attempts-v1",
  activity: "frca-daily-activity-v1",
  goal: "frca-daily-goal-v1",
  ui: "frca-ui-state-v1",
  examConfig: "frca-exam-config-v1",
};

function shuffle<T>(items: T[]) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

function safeLoad<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const saved = localStorage.getItem(key);
    return saved ? JSON.parse(saved) as T : fallback;
  } catch {
    return fallback;
  }
}

function todayKey() {
  const now = new Date();
  return [now.getFullYear(), String(now.getMonth() + 1).padStart(2, "0"), String(now.getDate()).padStart(2, "0")].join("-");
}

function getTopic(q: Question) {
  return q.chapters[0] || q.section || "General";
}

function normalizeSearch(value: string) {
  return value.normalize("NFKD").toLowerCase().replace(/[⬚]/g, "°").replace(/[⫽]/g, "=").replace(/[⫺]/g, "-").replace(/[⫹]/g, "+").replace(/[␮]/g, "μ").replace(/[^\p{L}\p{N}°=+<>μ-]+/gu, " ").replace(/\s+/g, " ").trim();
}

function getDifficulty(q: Question, progress?: Progress): Difficulty {
  if (q.difficulty) return q.difficulty;
  if ((progress?.attempts || 0) >= 2) {
    const lastScore = (progress?.correct || 0) / Math.max(1, scoreTotal(q));
    if ((progress?.lapses || 0) >= 2 || lastScore < 0.6) return "advanced";
    if ((progress?.repetitions || 0) >= 2 && lastScore >= 0.9) return "foundation";
  }
  return "standard";
}

function dueNow(progress?: Progress) {
  return Boolean(progress?.dueAt && new Date(progress.dueAt).getTime() <= Date.now());
}

function nextReview(previous: Progress, earned: number, total: number, confidence: Confidence): Partial<Progress> {
  const fullMark = total > 0 && earned === total;
  const repetitions = fullMark ? (previous.repetitions || 0) + 1 : 0;
  let intervalDays = fullMark ? repetitions === 1 ? 1 : repetitions === 2 ? 4 : Math.min(60, Math.max(7, Math.round((previous.intervalDays || 4) * 2.1))) : 1;
  if (confidence === "low") intervalDays = Math.min(intervalDays, 1);
  if (confidence === "high" && fullMark) intervalDays = Math.min(60, Math.max(2, Math.round(intervalDays * 1.4)));
  const due = new Date();
  due.setDate(due.getDate() + intervalDays);
  return {
    repetitions,
    intervalDays,
    lapses: (previous.lapses || 0) + (fullMark ? 0 : 1),
    dueAt: due.toISOString(),
  };
}

function balancedSample(pool: Question[], count: number) {
  const groups = new Map<string, Question[]>();
  shuffle(pool).forEach((question) => {
    const topic = getTopic(question);
    groups.set(topic, [...(groups.get(topic) || []), question]);
  });
  const result: Question[] = [];
  const queues = [...groups.values()];
  while (result.length < count && queues.some((queue) => queue.length)) {
    queues.forEach((queue) => {
      const next = queue.shift();
      if (next && result.length < count) result.push(next);
    });
  }
  return result;
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

type ExplanationSegment = { kind: "paragraph" | "bullet"; text: string };

const REFERENCE_ENTRY_PATTERN = /\b[A-Z][A-Za-z’'-]+(?:\s+[A-Z][A-Za-z’'-]+)?\s+[A-Z]{1,4}(?:,\s*[A-Z][A-Za-z’'-]+(?:\s+[A-Z][A-Za-z’'-]+)?\s+[A-Z]{1,4}){0,5}\.\s+/g;
const EMPHASIS_SPLIT_PATTERN = /(\b(?:TRUE|FALSE)\b|\b[A-Z]{2,8}(?:-\d)?\b|[−-]?\d+(?:\.\d+)?\s?(?:%|°C|mg|mcg|μg|g|kg|ml|l|mmHg|kPa|bar|Hz|h|min|days?)\b)/g;
const EMPHASIS_TOKEN_PATTERN = /^(?:\b(?:TRUE|FALSE)\b|\b[A-Z]{2,8}(?:-\d)?\b|[−-]?\d+(?:\.\d+)?\s?(?:%|°C|mg|mcg|μg|g|kg|ml|l|mmHg|kPa|bar|Hz|h|min|days?)\b)$/;

function splitReferenceEntries(value: string) {
  const matches = [...value.matchAll(REFERENCE_ENTRY_PATTERN)];
  if (matches.length < 2) return value.trim() ? [value.trim()] : [];
  return matches.map((match, index) => value.slice(match.index || 0, matches[index + 1]?.index ?? value.length).trim()).filter(Boolean);
}

function paragraphize(value: string): ExplanationSegment[] {
  const chunks = value.replace(/\s*••\s*/g, "\n• ").split(/\n+/).map((chunk) => chunk.trim()).filter(Boolean);
  return chunks.flatMap((chunk) => {
    if (chunk.startsWith("• ")) return [{ kind: "bullet" as const, text: chunk.slice(2).trim() }];
    const sentences = chunk.match(/[^.!?]+(?:[.!?]+(?=\s+[A-Z]|$)|$)/g)?.map((sentence) => sentence.trim()).filter(Boolean) || [chunk];
    const paragraphs: ExplanationSegment[] = [];
    let current = "";
    sentences.forEach((sentence) => {
      if (current && current.length + sentence.length > 360) {
        paragraphs.push({ kind: "paragraph", text: current });
        current = sentence;
      } else {
        current = [current, sentence].filter(Boolean).join(" ");
      }
    });
    if (current) paragraphs.push({ kind: "paragraph", text: current });
    return paragraphs;
  });
}

function parseExplanation(value: string) {
  const trimmed = value.trim();
  const furtherReadingIndex = trimmed.search(/\bFurther reading\b/i);
  if (furtherReadingIndex >= 0) {
    return {
      segments: paragraphize(trimmed.slice(0, furtherReadingIndex).trim()),
      references: splitReferenceEntries(trimmed.slice(furtherReadingIndex).replace(/^Further reading\s*/i, "").trim()),
    };
  }
  REFERENCE_ENTRY_PATTERN.lastIndex = 0;
  const match = REFERENCE_ENTRY_PATTERN.exec(trimmed);
  REFERENCE_ENTRY_PATTERN.lastIndex = 0;
  if (match?.index !== undefined && match.index > Math.min(80, trimmed.length * 0.2)) {
    return {
      segments: paragraphize(trimmed.slice(0, match.index).trim()),
      references: splitReferenceEntries(trimmed.slice(match.index).trim()),
    };
  }
  return { segments: paragraphize(trimmed), references: [] as string[] };
}

function EmphasizedText({ children }: { children: string }) {
  return <>{children.split(EMPHASIS_SPLIT_PATTERN).map((part, index) => EMPHASIS_TOKEN_PATTERN.test(part) ? <strong className="medical-key" key={`${part}-${index}`}>{part}</strong> : part)}</>;
}

export default function Home() {
  const [mode, setMode] = useState<Mode>("home");
  const [navOpen, setNavOpen] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [fontScale, setFontScale] = useState<"normal" | "large">("normal");
  const [progress, setProgress] = useState<Record<string, Progress>>({});
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [activity, setActivity] = useState<Record<string, DailyActivity>>({});
  const [dailyGoal, setDailyGoal] = useState<DailyGoal>({ questions: 30, minutes: 25 });
  const [customQuestions, setCustomQuestions] = useState<Question[]>([]);
  const [query, setQuery] = useState("");
  const [book, setBook] = useState("all");
  const [section, setSection] = useState("all");
  const [chapter, setChapter] = useState("all");
  const [status, setStatus] = useState("all");
  const [difficulty, setDifficulty] = useState<Difficulty | "all">("all");
  const [sort, setSort] = useState<"source" | "weakest" | "due" | "unseen">("source");
  const [libraryFormat, setLibraryFormat] = useState<QuestionFormat | "all">("all");
  const [page, setPage] = useState(1);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [practiceQuestions, setPracticeQuestions] = useState<Question[]>([]);
  const [practiceIndex, setPracticeIndex] = useState(0);
  const [practiceAnswers, setPracticeAnswers] = useState<Record<string, Answers>>({});
  const [practiceSubmitted, setPracticeSubmitted] = useState<Set<string>>(new Set());
  const [practiceConfidence, setPracticeConfidence] = useState<Record<string, Confidence>>({});
  const [examQuestions, setExamQuestions] = useState<Question[]>([]);
  const [examIndex, setExamIndex] = useState(0);
  const [examAnswers, setExamAnswers] = useState<Record<string, Answers>>({});
  const [examFlags, setExamFlags] = useState<Set<string>>(new Set());
  const [examConfidence, setExamConfidence] = useState<Record<string, Confidence>>({});
  const [examSeconds, setExamSeconds] = useState(0);
  const [examStarted, setExamStarted] = useState(false);
  const [questionFormat, setQuestionFormat] = useState<QuestionFormat>("true-false");
  const [examConfig, setExamConfig] = useState<ExamConfig>({
    book: "all",
    section: "all",
    chapter: "all",
    format: "true-false",
    count: 20,
    minutes: 25,
    selection: "random",
    balanced: false,
  });
  const sessionStartedAt = useRef(Date.now());
  const [storageReady, setStorageReady] = useState(false);

  const allQuestions = useMemo(() => QUESTIONS.concat(customQuestions), [customQuestions]);
  const allBooks = useMemo(() => [...new Set(allQuestions.map((q) => q.book))], [allQuestions]);
  const allSections = useMemo(() => [...new Set(allQuestions.filter((question) => book === "all" || question.book === book).map((q) => q.section))], [allQuestions, book]);
  const allChapters = useMemo(() => [...new Set(allQuestions.filter((question) => (book === "all" || question.book === book) && (section === "all" || question.section === section)).flatMap((q) => q.chapters))].sort(), [allQuestions, book, section]);

  useEffect(() => {
    const savedUi = safeLoad<Partial<{ mode: Mode; query: string; book: string; section: string; chapter: string; status: string; difficulty: Difficulty | "all"; sort: "source" | "weakest" | "due" | "unseen"; libraryFormat: QuestionFormat | "all"; page: number; fontScale: "normal" | "large" }>>(STORAGE.ui, {});
    setProgress(loadProgress());
    setAttempts(safeLoad<Attempt[]>(STORAGE.attempts, []));
    setActivity(safeLoad<Record<string, DailyActivity>>(STORAGE.activity, {}));
    setDailyGoal(safeLoad<DailyGoal>(STORAGE.goal, { questions: 30, minutes: 25 }));
    setCustomQuestions(loadCustomQuestions());
    setExamConfig((current) => ({ ...current, ...safeLoad<Partial<ExamConfig>>(STORAGE.examConfig, {}) }));
    const sharedExam = new URLSearchParams(window.location.search).get("exam");
    if (sharedExam) {
      try {
        const parsed = JSON.parse(atob(sharedExam)) as Partial<ExamConfig>;
        setExamConfig((current) => ({ ...current, ...parsed }));
        setMode("exam");
      } catch {
        window.history.replaceState({}, "", window.location.pathname);
      }
    }
    const savedTheme = localStorage.getItem("frca-theme") as "light" | "dark" | null;
    if (savedTheme) setTheme(savedTheme);
    if (savedUi.fontScale) setFontScale(savedUi.fontScale);
    if (savedUi.mode && !["practice", "exam", "results"].includes(savedUi.mode)) setMode(savedUi.mode);
    if (savedUi.query !== undefined) setQuery(savedUi.query);
    if (savedUi.book) setBook(savedUi.book);
    if (savedUi.section) setSection(savedUi.section);
    if (savedUi.chapter) setChapter(savedUi.chapter);
    if (savedUi.status) setStatus(savedUi.status);
    if (savedUi.difficulty) setDifficulty(savedUi.difficulty);
    if (savedUi.sort) setSort(savedUi.sort);
    if (savedUi.libraryFormat) setLibraryFormat(savedUi.libraryFormat);
    if (savedUi.page) setPage(savedUi.page);
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => undefined);
    setStorageReady(true);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.font = fontScale;
    if (!storageReady) return;
    localStorage.setItem("frca-theme", theme);
  }, [fontScale, storageReady, theme]);
  useEffect(() => {
    if (storageReady) localStorage.setItem(STORAGE.progress, JSON.stringify(progress));
  }, [progress, storageReady]);
  useEffect(() => {
    if (storageReady) localStorage.setItem("frca-custom-questions", JSON.stringify(customQuestions));
  }, [customQuestions, storageReady]);
  useEffect(() => {
    if (storageReady) localStorage.setItem(STORAGE.attempts, JSON.stringify(attempts.slice(-ATTEMPT_LIMIT)));
  }, [attempts, storageReady]);
  useEffect(() => {
    if (!storageReady) return;
    localStorage.setItem(STORAGE.activity, JSON.stringify(activity));
    localStorage.setItem(STORAGE.goal, JSON.stringify(dailyGoal));
    localStorage.setItem(STORAGE.examConfig, JSON.stringify(examConfig));
  }, [activity, dailyGoal, examConfig, storageReady]);
  useEffect(() => {
    if (!storageReady) return;
    localStorage.setItem(STORAGE.ui, JSON.stringify({ mode, query, book, section, chapter, status, difficulty, sort, libraryFormat, page, fontScale }));
  }, [book, chapter, difficulty, fontScale, libraryFormat, mode, page, query, section, sort, status, storageReady]);
  useEffect(() => {
    if (!examStarted) return;
    const timer = window.setInterval(() => setExamSeconds((value) => value > 0 ? value - 1 : 0), 1000);
    return () => window.clearInterval(timer);
  }, [examStarted]);
  useEffect(() => {
    if (examStarted && examSeconds === 0) finishExam();
  // Timer completion intentionally uses the latest render's exam state.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [examSeconds, examStarted]);

  const filtered = useMemo(() => {
      const result = allQuestions.filter((q) => {
        const p = progress[q.id] || {};
        const haystack = normalizeSearch([q.question, q.book, q.section, q.chapters.join(" "), q.options.map((o) => o.text).join(" "), q.explanation, q.source, p.note || ""].join(" "));
        const queryTerms = normalizeSearch(query).split(" ").filter(Boolean);
        const needsReview = p.answered && p.correct !== scoreTotal(q);
        return (
          (book === "all" || q.book === book) &&
          (section === "all" || q.section === section) &&
          (chapter === "all" || q.chapters.includes(chapter)) &&
          (libraryFormat === "all" || getFormat(q) === libraryFormat) &&
          (difficulty === "all" || getDifficulty(q, p) === difficulty) &&
          (status === "all" ||
            (status === "bookmarked" && p.bookmarked) ||
            (status === "unanswered" && !p.answered) ||
            (status === "incorrect" && needsReview) ||
            (status === "due" && dueNow(p)) ||
            (status === "notes" && Boolean(p.note?.trim())) ||
            (status === "reported" && p.reported)) &&
          (!queryTerms.length || queryTerms.every((term) => haystack.includes(term)))
        );
      });
      if (sort === "weakest") return result.sort((a, b) => ((progress[a.id]?.correct || 0) / scoreTotal(a)) - ((progress[b.id]?.correct || 0) / scoreTotal(b)));
      if (sort === "due") return result.sort((a, b) => new Date(progress[a.id]?.dueAt || "2999-01-01").getTime() - new Date(progress[b.id]?.dueAt || "2999-01-01").getTime());
      if (sort === "unseen") return result.sort((a, b) => Number(Boolean(progress[a.id]?.answered)) - Number(Boolean(progress[b.id]?.answered)));
      return result;
    }, [allQuestions, book, chapter, difficulty, libraryFormat, progress, query, section, sort, status]);

  const questionById = useMemo(() => new Map(allQuestions.map((question) => [question.id, question])), [allQuestions]);
  const dueQuestions = useMemo(() => allQuestions.filter((question) => dueNow(progress[question.id])), [allQuestions, progress]);
  const notebookQuestions = useMemo(() => allQuestions.filter((question) => {
    const item = progress[question.id];
    return Boolean(item?.bookmarked || item?.note?.trim() || item?.reported || (item?.answered && item.correct !== scoreTotal(question)));
  }), [allQuestions, progress]);
  const topicStats = useMemo(() => {
    const map = new Map<string, { attempts: number; earned: number; total: number; lowConfidence: number; due: number; lastAt: string }>();
    attempts.forEach((attempt) => {
      const question = questionById.get(attempt.questionId);
      if (!question) return;
      const topic = getTopic(question);
      const current = map.get(topic) || { attempts: 0, earned: 0, total: 0, lowConfidence: 0, due: 0, lastAt: attempt.at };
      current.attempts += 1;
      current.earned += attempt.earned;
      current.total += attempt.total;
      current.lowConfidence += attempt.confidence === "low" ? 1 : 0;
      current.lastAt = attempt.at > current.lastAt ? attempt.at : current.lastAt;
      map.set(topic, current);
    });
    dueQuestions.forEach((question) => {
      const topic = getTopic(question);
      const current = map.get(topic) || { attempts: 0, earned: 0, total: 0, lowConfidence: 0, due: 0, lastAt: "" };
      current.due += 1;
      map.set(topic, current);
    });
    return [...map.entries()].map(([topic, value]) => ({ topic, ...value, accuracy: value.total ? Math.round((value.earned / value.total) * 100) : 0 })).sort((a, b) => a.accuracy - b.accuracy || b.attempts - a.attempts);
  }, [attempts, dueQuestions, questionById]);

  const todayActivity = activity[todayKey()] || { answered: 0, earned: 0, total: 0, seconds: 0 };

  const answered = allQuestions.filter((q) => progress[q.id]?.answered).length;

  function updateProgress(id: string, value: Progress) {
    setProgress((current) => ({ ...current, [id]: { ...current[id], ...value } }));
  }

  function recordAttempt(question: Question, answers: Answers, attemptMode: "practice" | "exam", confidence: Confidence, durationSeconds: number) {
    const earned = scoreQuestion(question, answers);
    const total = scoreTotal(question);
    const now = new Date().toISOString();
    setProgress((current) => {
      const previous = current[question.id] || {};
      return {
        ...current,
        [question.id]: {
          ...previous,
          answered: true,
          correct: earned,
          attempts: (previous.attempts || 0) + 1,
          confidence,
          lastAnsweredAt: now,
          ...nextReview(previous, earned, total, confidence),
        },
      };
    });
    setAttempts((current) => [...current, { id: `${question.id}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, questionId: question.id, mode: attemptMode, at: now, earned, total, confidence, durationSeconds }].slice(-ATTEMPT_LIMIT));
    const day = todayKey();
    setActivity((current) => {
      const previous = current[day] || { answered: 0, earned: 0, total: 0, seconds: 0 };
      return { ...current, [day]: { answered: previous.answered + 1, earned: previous.earned + earned, total: previous.total + total, seconds: previous.seconds + durationSeconds } };
    });
  }

  function startPractice(source = filtered, requestedFormat = questionFormat) {
    const matching = source.filter((q) => getFormat(q) === requestedFormat);
    const fallback = allQuestions.filter((q) => getFormat(q) === requestedFormat);
    const pool = matching.length ? matching : source.length ? source : fallback;
    setPracticeQuestions(shuffle(pool).slice(0, Math.min(20, pool.length)));
    setPracticeIndex(0);
    setPracticeAnswers({});
    setPracticeSubmitted(new Set());
    setPracticeConfidence({});
    sessionStartedAt.current = Date.now();
    setMode("practice");
  }

  function startExam() {
    const basePool = allQuestions.filter(
      (q) =>
        getFormat(q) === examConfig.format &&
        (examConfig.book === "all" || q.book === examConfig.book) &&
        (examConfig.section === "all" || q.section === examConfig.section) &&
        (examConfig.chapter === "all" || q.chapters.includes(examConfig.chapter)),
    );
    const selectedPool = examConfig.selection === "due"
      ? basePool.filter((question) => dueNow(progress[question.id]))
      : examConfig.selection === "weak"
        ? basePool.filter((question) => progress[question.id]?.answered && progress[question.id]?.correct !== scoreTotal(question))
        : basePool;
    const pool = selectedPool.length ? selectedPool : basePool;
    const count = Math.min(Math.max(1, examConfig.count), pool.length);
    setExamQuestions(examConfig.balanced ? balancedSample(pool, count) : shuffle(pool).slice(0, count));
    setExamIndex(0);
    setExamAnswers({});
    setExamFlags(new Set());
    setExamConfidence({});
    setExamSeconds(examConfig.minutes * 60);
    setExamStarted(true);
    sessionStartedAt.current = Date.now();
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
    recordAttempt(q, answers, "practice", practiceConfidence[q.id] || "medium", Math.max(1, Math.round((Date.now() - sessionStartedAt.current) / 1000)));
    setPracticeSubmitted((current) => new Set(current).add(q.id));
    sessionStartedAt.current = Date.now();
  }

  function finishExam() {
    if (examStarted) {
      const completed = examQuestions.filter((question) => isComplete(question, examAnswers[question.id] || {}));
      const elapsed = Math.max(1, examConfig.minutes * 60 - examSeconds);
      const perQuestion = Math.max(1, Math.round(elapsed / Math.max(1, completed.length)));
      completed.forEach((question) => recordAttempt(question, examAnswers[question.id] || {}, "exam", examConfidence[question.id] || "medium", perQuestion));
    }
    setExamStarted(false);
    setMode("results");
  }

  function saveCustomQuestion(question: Question) {
    setCustomQuestions((current) => current.concat(question));
    setQuestionFormat("mcq");
    setMode("home");
  }

  function importCustomQuestions(imported: Question[]) {
    setCustomQuestions((current) => {
      const ids = new Set(current.map((question) => question.id));
      return current.concat(imported.filter((question) => !ids.has(question.id)));
    });
    setQuestionFormat("mcq");
  }

  function navigate(nextMode: Mode) {
    setMode(nextMode);
    setNavOpen(false);
    window.setTimeout(() => document.getElementById("main-content")?.focus(), 0);
  }

  useEffect(() => {
    document.body.classList.toggle("nav-open", navOpen);
    document.body.classList.toggle("nav-locked", navOpen);
    return () => {
      document.body.classList.remove("nav-open");
      document.body.classList.remove("nav-locked");
    };
  }, [navOpen]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement;
      if (target.matches("input, textarea, select, [contenteditable=true]") || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "Escape" && navOpen) return setNavOpen(false);
      if (mode === "library" && event.key === "/") {
        event.preventDefault();
        document.getElementById("question-search")?.focus();
        return;
      }
      const kind = mode === "practice" ? "practice" : mode === "exam" && examStarted ? "exam" : null;
      if (!kind) return;
      const questions = kind === "practice" ? practiceQuestions : examQuestions;
      const index = kind === "practice" ? practiceIndex : examIndex;
      const question = questions[index];
      if (!question) return;
      const answers = kind === "practice" ? practiceAnswers[question.id] || {} : examAnswers[question.id] || {};
      const keys = ["1", "2", "3", "4", "5"];
      if (getFormat(question) === "mcq" && keys.includes(event.key)) {
        const option = question.options[Number(event.key) - 1];
        if (option) setAnswer(kind, question, "selected", option.key);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        kind === "practice" ? setPracticeIndex(Math.max(0, index - 1)) : setExamIndex(Math.max(0, index - 1));
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        kind === "practice" ? setPracticeIndex(Math.min(questions.length - 1, index + 1)) : setExamIndex(Math.min(questions.length - 1, index + 1));
      } else if (event.key === "Enter" && kind === "practice") {
        event.preventDefault();
        if (practiceSubmitted.has(question.id)) setPracticeIndex(Math.min(questions.length - 1, index + 1));
        else if (isComplete(question, answers)) submitPractice();
      } else if (event.key.toLowerCase() === "g" && kind === "exam") {
        setExamFlags((current) => { const next = new Set(current); next.has(question.id) ? next.delete(question.id) : next.add(question.id); return next; });
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <header className="topbar">
        <button className="mobile-menu" onClick={() => setNavOpen((current) => !current)} aria-expanded={navOpen} aria-controls="sidebar" aria-label={navOpen ? "Close navigation" : "Open navigation"}>☰</button>
        <div className="brand-mark">FR</div>
        <div className="brand"><strong>Primary FRCA Revision</strong><span>QBase 6 + Get Through MTFs</span></div>
        <div className="top-actions">
          <button className="text-size-control" onClick={() => setFontScale(fontScale === "normal" ? "large" : "normal")} aria-label="Toggle larger text" aria-pressed={fontScale === "large"}>A⁺</button>
          <button className="theme-toggle" onClick={() => setTheme(theme === "light" ? "dark" : "light")} aria-label="Toggle dark mode">{theme === "light" ? "☾" : "☀"}</button>
          <button className="reset-button" onClick={() => { if (window.confirm("Reset all saved learning progress? Your personal MCQs will stay.")) { setProgress({}); setAttempts([]); setActivity({}); } }}>Reset</button>
        </div>
      </header>
      {navOpen && <button className="nav-scrim" onClick={() => setNavOpen(false)} aria-label="Close navigation" />}
      <div className="layout">
        <aside className="sidebar" id="sidebar">
          <div className="side-label">Start here</div>
          <NavButton active={mode === "home"} onClick={() => navigate("home")} icon="⌂" label="Choose a quiz" />
          <div className="side-label section-label">Workspace</div>
          <NavButton active={mode === "library"} onClick={() => navigate("library")} icon="▦" label="Question library" count={allQuestions.length} />
          <NavButton active={mode === "practice"} onClick={() => startPractice(filtered)} icon="◉" label="Practice session" count={answered} />
          <NavButton active={mode === "exam"} onClick={() => { setExamStarted(false); navigate("exam"); }} icon="◷" label="Exam simulator" />
          <NavButton active={mode === "dashboard"} onClick={() => navigate("dashboard")} icon="↗" label="Performance dashboard" />
          <NavButton active={mode === "notebook"} onClick={() => navigate("notebook")} icon="✎" label="Mistake notebook" count={notebookQuestions.length} />
          <NavButton active={false} onClick={() => startPractice(dueQuestions, questionFormat)} icon="⟳" label="Review due today" count={dueQuestions.length} />
          <NavButton active={mode === "create"} onClick={() => navigate("create")} icon="＋" label="Create / import MCQs" count={customQuestions.length} />
          <div className="side-label section-label">Books</div>
          {allBooks.map((value) => <button className="book-link" key={value} onClick={() => { setBook(value); setSection("all"); setPage(1); navigate("library"); }}>{value}<span>{allQuestions.filter((q) => q.book === value).length}</span></button>)}
        </aside>
        <main className="main-content" id="main-content" tabIndex={-1}>
          <div className="content-wrap">
            {mode === "home" && <DailyGoalCard activity={todayActivity} goal={dailyGoal} dueCount={dueQuestions.length} onReviewDue={() => startPractice(dueQuestions, questionFormat)} onDashboard={() => navigate("dashboard")} />}
            {mode === "home" && <HomeView answered={answered} totalQuestions={allQuestions.length} sourceCount={allBooks.length} selectedFormat={questionFormat} onSelectFormat={setQuestionFormat} trueFalseCount={TRUE_FALSE_COUNT} mcqCount={customQuestions.length + MCQ_COUNT} customQuestions={customQuestions} todayActivity={todayActivity} dailyGoal={dailyGoal} dueCount={dueQuestions.length} onReviewDue={() => startPractice(dueQuestions, questionFormat)} onDashboard={() => navigate("dashboard")} onCreate={() => navigate("create")} onBrowse={(selectedBook: string, selectedFormat: QuestionFormat) => { setBook(selectedBook); setLibraryFormat(selectedFormat); setSection("all"); navigate("library"); }} onPractice={(selectedBook: string, selectedFormat: QuestionFormat) => { const pool = selectedBook === "all" ? allQuestions : allQuestions.filter((q) => q.book === selectedBook); startPractice(pool, selectedFormat); }} onExam={(selectedBook: string, selectedFormat: QuestionFormat) => { setExamConfig((current) => ({ ...current, book: selectedBook, format: selectedFormat })); setExamStarted(false); navigate("exam"); }} />}
            {mode === "create" && <CreateQuestionView existingCount={customQuestions.length} onSave={saveCustomQuestion} onImport={importCustomQuestions} onCancel={() => navigate("home")} />}
            {mode === "library" && <LibraryView filtered={filtered} page={page} setPage={setPage} query={query} setQuery={setQuery} book={book} setBook={setBook} section={section} setSection={setSection} chapter={chapter} setChapter={setChapter} difficulty={difficulty} setDifficulty={setDifficulty} sort={sort} setSort={setSort} libraryFormat={libraryFormat} setLibraryFormat={setLibraryFormat} status={status} setStatus={setStatus} revealed={revealed} setRevealed={setRevealed} progress={progress} updateProgress={updateProgress} startPractice={startPractice} bookOptions={allBooks} sectionOptions={allSections} chapterOptions={allChapters} mcqCount={customQuestions.length + MCQ_COUNT} />}
            {mode === "practice" && <PracticeView questions={practiceQuestions} index={practiceIndex} setIndex={setPracticeIndex} answers={practiceAnswers} setAnswer={setAnswer} submitted={practiceSubmitted} confidence={practiceConfidence} setConfidence={setPracticeConfidence} submit={submitPractice} onFinish={() => navigate("home")} />}
            {mode === "exam" && <ExamView started={examStarted} questions={examQuestions} index={examIndex} setIndex={setExamIndex} answers={examAnswers} setAnswer={setAnswer} flags={examFlags} setFlags={setExamFlags} confidence={examConfidence} setConfidence={setExamConfidence} seconds={examSeconds} config={examConfig} setConfig={setExamConfig} start={startExam} finish={finishExam} questionPool={allQuestions} bookOptions={allBooks} sectionOptions={allSections} chapterOptions={allChapters} progress={progress} />}
            {mode === "results" && <ResultsView questions={examQuestions} answers={examAnswers} elapsedSeconds={Math.max(0, examConfig.minutes * 60 - examSeconds)} onRestart={() => navigate("exam")} onReview={() => { setStatus("incorrect"); navigate("library"); }} />}
            {mode === "dashboard" && <DashboardView topicStats={topicStats} todayActivity={todayActivity} dailyGoal={dailyGoal} setDailyGoal={setDailyGoal} dueCount={dueQuestions.length} attempts={attempts} questions={allQuestions} onPracticeTopic={(topic: string) => startPractice(allQuestions.filter((question) => getTopic(question) === topic), questionFormat)} onReviewDue={() => startPractice(dueQuestions, questionFormat)} />}
            {mode === "notebook" && <NotebookView questions={notebookQuestions} progress={progress} updateProgress={updateProgress} revealed={revealed} setRevealed={setRevealed} onPractice={() => startPractice(notebookQuestions, questionFormat)} />}
          </div>
        </main>
      </div>
      {!["practice", "exam"].includes(mode) && <nav className="bottom-nav" aria-label="Primary navigation">
        <NavButton active={mode === "home"} onClick={() => navigate("home")} icon="⌂" label="Home" />
        <NavButton active={mode === "library"} onClick={() => navigate("library")} icon="▦" label="Library" />
        <NavButton active={mode === "dashboard"} onClick={() => navigate("dashboard")} icon="↗" label="Progress" />
        <NavButton active={mode === "notebook"} onClick={() => navigate("notebook")} icon="✎" label="Notebook" count={notebookQuestions.length} />
        <NavButton active={mode === "exam"} onClick={() => navigate("exam")} icon="◷" label="Exam" />
      </nav>}
    </div>
  );
}

function NavButton({ active, onClick, icon, label, count }: { active: boolean; onClick: () => void; icon: string; label: string; count?: number }) {
  return <button className={"nav-item " + (active ? "active" : "")} onClick={onClick} aria-current={active ? "page" : undefined}><b aria-hidden="true">{icon}</b><span>{label}</span>{count !== undefined && <small>{count}</small>}</button>;
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

function Filters({ query, setQuery, book, setBook, section, setSection, chapter, setChapter, libraryFormat, setLibraryFormat, status, setStatus, difficulty, setDifficulty, sort, setSort, bookOptions, sectionOptions, chapterOptions, mcqCount }: any) {
  return <div className="toolbar"><div className="toolbar-row">
    <label className="search-box"><span className="sr-only">Search the question library</span><b aria-hidden="true">⌕</b><input id="question-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search questions, options, explanations, chapters…" /></label>
    <label className="filter-field"><span>Book</span><select value={book} onChange={(e) => setBook(e.target.value)}><option value="all">All books</option>{bookOptions.map((v: string) => <option key={v}>{v}</option>)}</select></label>
    <label className="filter-field"><span>Section</span><select value={section} onChange={(e) => setSection(e.target.value)}><option value="all">All sections</option>{sectionOptions.map((v: string) => <option key={v}>{v}</option>)}</select></label>
    <label className="filter-field"><span>Chapter</span><select value={chapter} onChange={(e) => setChapter(e.target.value)}><option value="all">All chapters</option>{chapterOptions.map((v: string) => <option key={v}>{v}</option>)}</select></label>
    <label className="filter-field"><span>Format</span><select value={libraryFormat} onChange={(e) => setLibraryFormat(e.target.value)}><option value="all">All formats</option><option value="true-false">True / False MTF</option><option value="mcq" disabled={!mcqCount}>Single-best-answer MCQ{mcqCount ? "" : " (create one first)"}</option></select></label>
    <label className="filter-field"><span>Status</span><select value={status} onChange={(e) => setStatus(e.target.value)}><option value="all">All status</option><option value="unanswered">Unanswered</option><option value="bookmarked">Bookmarked</option><option value="incorrect">Needs review</option><option value="due">Due today</option><option value="notes">Has notes</option><option value="reported">Reported</option></select></label>
    <label className="filter-field"><span>Difficulty</span><select value={difficulty} onChange={(e) => setDifficulty(e.target.value)}><option value="all">All difficulty</option><option value="foundation">Foundation</option><option value="standard">Standard</option><option value="advanced">Advanced</option></select></label>
    <label className="filter-field"><span>Sort</span><select value={sort} onChange={(e) => setSort(e.target.value)}><option value="source">Source order</option><option value="weakest">Weakest first</option><option value="due">Due first</option><option value="unseen">Unseen first</option></select></label>
  </div></div>;
}

function LibraryView({ filtered, page, setPage, query, setQuery, book, setBook, section, setSection, chapter, setChapter, difficulty, setDifficulty, sort, setSort, libraryFormat, setLibraryFormat, status, setStatus, revealed, setRevealed, progress, updateProgress, startPractice, bookOptions, sectionOptions, chapterOptions, mcqCount }: any) {
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageQuestions = filtered.slice((page - 1) * pageSize, page * pageSize);
  useEffect(() => setPage(1), [book, chapter, difficulty, libraryFormat, query, section, setPage, sort, status]);
  return <>
    <section className="hero"><div><p className="eyebrow">Revision library</p><h1>Find exactly what needs work.</h1><p>Search the full question text and explanations, then filter by learning status or estimated difficulty.</p></div><div className="stats"><Stat value={filtered.length} label="matching" /><Stat value={filtered.filter((q: Question) => progress[q.id]?.answered).length} label="answered" /><Stat value={filtered.filter((q: Question) => dueNow(progress[q.id])).length} label="due" /></div></section>
    <Filters {...{ query, setQuery, book, setBook, section, setSection, chapter, setChapter, difficulty, setDifficulty, sort, setSort, libraryFormat, setLibraryFormat, status, setStatus, bookOptions, sectionOptions, chapterOptions, mcqCount }} />
    <div className="library-actions"><span>{filtered.length} questions</span><button className="primary-button" disabled={!filtered.length} onClick={() => startPractice(filtered)}>Start a focused practice</button></div>
    <div className="question-list">{pageQuestions.map((q: Question) => <QuestionCard key={q.id} q={q} progress={progress[q.id] || {}} open={revealed.has(q.id)} onReveal={() => setRevealed((current: Set<string>) => { const next = new Set(current); next.has(q.id) ? next.delete(q.id) : next.add(q.id); return next; })} onBookmark={() => updateProgress(q.id, { bookmarked: !progress[q.id]?.bookmarked })} onNote={(note) => updateProgress(q.id, { note })} onReport={() => updateProgress(q.id, { reported: !progress[q.id]?.reported })} />)}</div>
    {!pageQuestions.length && <div className="empty"><strong>No questions match these filters.</strong>Clear one filter or search for a broader term.</div>}
    <Pagination page={page} totalPages={totalPages} setPage={setPage} />
  </>;
}

function QuestionCard({ q, progress, open, onReveal, onBookmark, onNote, onReport }: { q: Question; progress: Progress; open: boolean; onReveal: () => void; onBookmark: () => void; onNote: (note: string) => void; onReport: () => void }) {
  const mcq = getFormat(q) === "mcq";
  const detailsId = `question-details-${q.id}`;
  return <article className="question-card">
    <div className="question-head"><span className="question-number">Q{q.number}</span><div className="question-title"><h2>{q.question}</h2><div className="badges"><span className="badge book-badge">{q.book}</span><span className="badge">{q.section}</span><span className={`badge difficulty-${getDifficulty(q, progress)}`}>{getDifficulty(q, progress)}</span>{q.chapters.slice(0, 2).map((chapter) => <span className="badge chapter-badge" key={chapter}>{chapter}</span>)}</div></div><button className={`bookmark ${progress.bookmarked ? "on" : ""}`} onClick={onBookmark} aria-pressed={Boolean(progress.bookmarked)} aria-label={progress.bookmarked ? "Remove bookmark" : "Bookmark question"}>★</button></div>
    <div className="options">{q.options.map((option) => { const correct = mcq ? option.key === q.answer : option.correct; return <div className={`option ${open ? correct ? "correct" : "incorrect" : ""}`} key={option.key}><b>{option.key}.</b><span>{option.text}</span>{open && <em className={correct ? "true" : "false"}>{mcq ? correct ? "Best answer" : "Alternative" : correct ? "True" : "False"}</em>}</div>; })}</div>
    <div className="question-actions"><button className="reveal-button" onClick={onReveal} aria-expanded={open} aria-controls={detailsId}>{open ? "Hide answer and explanation" : "Reveal answer"}</button><button className={`report-button ${progress.reported ? "active" : ""}`} onClick={onReport} aria-pressed={Boolean(progress.reported)}>{progress.reported ? "Marked for checking" : "Report an issue"}</button></div>
    {open && <div id={detailsId}><ExplanationPanel q={q} /><label className="note-field"><span>Personal note</span><textarea value={progress.note || ""} onChange={(event) => onNote(event.target.value)} rows={3} placeholder="Add a memory hook, correction, or point to revisit…" /></label></div>}
    <footer><span>{q.source}{q.page ? ` · p. ${q.page}` : ""}</span><span>{progress.lastAnsweredAt ? `Last reviewed ${new Date(progress.lastAnsweredAt).toLocaleDateString()}` : "Not attempted"}{progress.answered ? ` · ${progress.correct}/${scoreTotal(q)}` : ""}</span></footer>
  </article>;
}

function ExplanationPanel({ q, result, total }: { q: Question; result?: number; total?: number }) {
  const { segments, references } = parseExplanation(q.explanation);
  const titleId = `explanation-title-${q.id}`;
  const mcq = getFormat(q) === "mcq";
  return <section className="explanation-panel" aria-labelledby={titleId}>
    <header className="explanation-header"><div><p className="eyebrow">Answer review</p><h3 id={titleId}>{result !== undefined && total !== undefined ? `${result}/${total} correct` : "Explanation and source"}</h3></div><span className="explanation-book">{q.book}</span></header>
    <section className="explanation-section answer-key-section"><div className="explanation-section-title"><span>1</span><div><h4>Answer key</h4><p>{mcq ? "The single best answer from the source." : "Each statement is judged independently as True or False."}</p></div></div><ul className="answer-key-list">{q.options.map((option) => { const correct = mcq ? option.key === q.answer : option.correct; return <li key={option.key}><b>{option.key}</b><span>{option.text}</span><em className={correct ? "answer-true" : "answer-false"}>{mcq ? correct ? "Best answer" : "Alternative" : correct ? "True" : "False"}</em></li>; })}</ul></section>
    <section className="explanation-section"><div className="explanation-section-title"><span>2</span><div><h4>Detailed explanation</h4><p>Key terms, values, and abbreviations are emphasised for faster review.</p></div></div><div className="explanation-copy">{segments.map((segment, index) => segment.kind === "bullet" ? <div className="explanation-bullet" key={index}><i aria-hidden="true" /><p><EmphasizedText>{segment.text}</EmphasizedText></p></div> : <p key={index}><EmphasizedText>{segment.text}</EmphasizedText></p>)}</div></section>
    {references.length > 0 && <section className="explanation-section"><div className="explanation-section-title"><span>3</span><div><h4>References cited in the book</h4><p>Bibliographic references retained from the source explanation.</p></div></div><ol className="reference-list">{references.map((reference, index) => <li key={`${reference}-${index}`}>{reference}</li>)}</ol></section>}
    <SourceLocation q={q} step={references.length > 0 ? 4 : 3} />
  </section>;
}

function SourceLocation({ q, step }: { q: Question; step: number }) {
  const hasPages = Boolean(q.questionPage && q.answerPage);
  return <section className="explanation-section source-location"><div className="explanation-section-title"><span>{step}</span><div><h4>Location in the source book</h4><p>{hasPages ? "Printed page and PDF page are both shown." : "Verified by the paper and question number in the imported source."}</p></div></div><dl>
    <div><dt>Book</dt><dd>{q.book}</dd></div>
    <div><dt>{q.section.toLowerCase().startsWith("paper") ? "Paper" : "Section"}</dt><dd>{q.section}</dd></div>
    <div><dt>Question</dt><dd>{q.number}</dd></div>
    {q.questionPage && <div><dt>Question page</dt><dd>Printed p. {q.questionPage}{q.questionPdfPage ? ` · PDF p. ${q.questionPdfPage}` : ""}</dd></div>}
    {q.answerPage && <div><dt>Explanation page</dt><dd>Printed p. {q.answerPage}{q.answerPdfPage ? ` · PDF p. ${q.answerPdfPage}` : ""}</dd></div>}
    <div className="source-topics"><dt>Topic tags</dt><dd>{q.chapters.join(" · ") || q.section}</dd></div>
  </dl>{!hasPages && <p className="source-location-note">The uploaded Get Through PDF copy does not expose a recoverable page index, so the site shows its verified paper and question location rather than inventing a page number.</p>}</section>;
}

function CreateQuestionView({ existingCount, onSave, onImport, onCancel }: { existingCount: number; onSave: (question: Question) => void; onImport: (questions: Question[]) => void; onCancel: () => void }) {
  const [stem, setStem] = useState("");
  const [options, setOptions] = useState(["", "", "", "", ""]);
  const [answer, setAnswer] = useState("A");
  const [chapter, setChapter] = useState("");
  const [explanation, setExplanation] = useState("");
  const [source, setSource] = useState("Personal revision question");
  const [difficulty, setDifficulty] = useState<Difficulty>("standard");
  const [error, setError] = useState("");
  const [importMessage, setImportMessage] = useState("");
  function updateOption(index: number, value: string) {
    setOptions((current) => current.map((item, itemIndex) => itemIndex === index ? value : item));
  }
  function save() {
    if (!stem.trim()) return setError("Add the question stem first.");
    if (options.some((option) => !option.trim())) return setError("Add text for all five options.");
    const keys = ["A", "B", "C", "D", "E"];
    onSave({ id: "custom-mcq-" + Date.now(), book: "My MCQs", section: "Created MCQs", number: existingCount + 1, question: stem.trim(), options: options.map((text, index) => ({ key: keys[index], text: text.trim(), correct: keys[index] === answer })), explanation: explanation.trim() || "Created by you.", chapters: [chapter.trim() || "My MCQs"], source: source.trim() || "Personal revision question", type: "single-best-answer", format: "mcq", answer, custom: true, difficulty, reviewedAt: new Date().toISOString() });
  }
  async function importFile(file?: File) {
    if (!file) return;
    try {
      const text = await file.text();
      let rows: any[] = [];
      if (file.name.toLowerCase().endsWith(".json")) {
        const parsed = JSON.parse(text);
        rows = Array.isArray(parsed) ? parsed : parsed.questions;
      } else {
        const [headerLine, ...lines] = text.split(/\r?\n/).filter(Boolean);
        const headers = headerLine.split(",").map((item) => item.trim());
        rows = lines.map((line) => Object.fromEntries(line.split(",").map((value, index) => [headers[index], value.trim()])));
      }
      if (!Array.isArray(rows)) throw new Error("No question list found");
      const keys = ["A", "B", "C", "D", "E"];
      const imported = rows.map((row, index) => {
        const importedOptions = Array.isArray(row.options) ? row.options : keys.map((key) => row[key] || row[`option${key}`]);
        const importedAnswer = String(row.answer || "A").toUpperCase();
        if (!row.question || importedOptions.some((option: any) => !option)) throw new Error(`Invalid question at row ${index + 1}`);
        return { id: row.id || `imported-mcq-${Date.now()}-${index}`, book: "My MCQs", section: row.section || "Imported MCQs", number: existingCount + index + 1, question: String(row.question), options: importedOptions.map((option: any, optionIndex: number) => typeof option === "string" ? { key: keys[optionIndex], text: option, correct: keys[optionIndex] === importedAnswer } : option), explanation: row.explanation || "Imported question.", chapters: Array.isArray(row.chapters) ? row.chapters : [row.chapter || "Imported MCQs"], source: row.source || "Imported locally", type: "single-best-answer", format: "mcq" as QuestionFormat, answer: importedAnswer, custom: true, difficulty: row.difficulty || "standard", reviewedAt: row.reviewedAt || new Date().toISOString() } as Question;
      });
      onImport(imported);
      setImportMessage(`${imported.length} questions imported successfully.`);
      setError("");
    } catch (reason) {
      setImportMessage("");
      setError(reason instanceof Error ? reason.message : "Could not import this file.");
    }
  }
  return <>
    <section className="hero"><div><p className="eyebrow">Personal question tools</p><h1>Create or import SBA questions.</h1><p>Build one question carefully, or import a local JSON/CSV set. Everything remains in this browser.</p></div><div className="stats"><Stat value={existingCount} label="created" /><Stat value={5} label="options" /></div></section>
    <div className="creator-layout">
      <div className="creator-card">
        <label className="creator-field"><span>Question stem</span><textarea value={stem} onChange={(event) => setStem(event.target.value)} placeholder="For example: Which statement best describes…?" rows={4} /></label>
        <div className="creator-options"><div className="creator-section-heading"><strong>Answer options</strong><span>Select the radio button beside the single best answer.</span></div>{options.map((value, index) => { const key = ["A", "B", "C", "D", "E"][index]; return <div className={`creator-option ${answer === key ? "selected" : ""}`} key={key}><input type="radio" name="correct-answer" checked={answer === key} onChange={() => setAnswer(key)} aria-label={`Mark option ${key} as correct`} /><b>{key}</b><input value={value} onChange={(event) => updateOption(index, event.target.value)} placeholder={`Option ${key}`} /></div>; })}</div>
        <div className="creator-grid"><label className="creator-field"><span>Chapter tag</span><input value={chapter} onChange={(event) => setChapter(event.target.value)} placeholder="e.g. Cardiovascular physiology" /></label><label className="creator-field"><span>Estimated difficulty</span><select value={difficulty} onChange={(event) => setDifficulty(event.target.value as Difficulty)}><option value="foundation">Foundation</option><option value="standard">Standard</option><option value="advanced">Advanced</option></select></label><label className="creator-field"><span>Source / reference</span><input value={source} onChange={(event) => setSource(event.target.value)} placeholder="Book, guideline, or lecture" /></label><label className="creator-field"><span>Explanation</span><textarea value={explanation} onChange={(event) => setExplanation(event.target.value)} placeholder="Why is this the best answer and why are the alternatives wrong?" rows={4} /></label></div>
        {error && <div className="creator-error" role="alert">{error}</div>}
        <div className="creator-actions"><button className="secondary-button" onClick={onCancel}>Cancel</button><button className="primary-button" onClick={save}>Save MCQ</button></div>
      </div>
      <aside className="import-card"><p className="eyebrow">Bulk import</p><h2>Import JSON or CSV</h2><p>JSON may contain a list or a <code>questions</code> property. CSV columns can include question, A–E, answer, explanation, chapter, and source.</p><label className="file-picker"><span>Choose a question file</span><input type="file" accept=".json,.csv,application/json,text/csv" onChange={(event) => importFile(event.target.files?.[0])} /></label>{importMessage && <div className="import-success" role="status">{importMessage}</div>}</aside>
    </div>
  </>;
}

function AnswerControls({ q, current, submitted, onSelect }: { q: Question; current: Answers; submitted?: boolean; onSelect: (key: string, value: AnswerValue) => void }) {
  if (getFormat(q) === "mcq") {
    return <div className="mcq-choice-grid" role="radiogroup" aria-label="Choose the single best answer">{q.options.map((option, index) => { const chosen = current.selected === option.key; const correct = option.key === q.answer; const state = submitted ? (correct ? "correct" : chosen ? "incorrect" : "") : chosen ? "selected" : ""; return <button type="button" role="radio" aria-checked={chosen} className={`mcq-choice ${state}`} disabled={submitted} key={option.key} onClick={() => onSelect("selected", option.key)}><b>{option.key}</b><span>{option.text}</span><small className="shortcut-hint"><kbd>{index + 1}</kbd></small>{submitted && correct && <em>Best answer</em>}</button>; })}</div>;
  }
  return <div className="practice-options" role="group" aria-label="Mark each statement true or false">{q.options.map((option) => <div className="practice-option" key={option.key}><b>{option.key}.</b><span>{option.text}</span><div><button type="button" aria-label={`Statement ${option.key}: True`} aria-pressed={current[option.key] === true} className={current[option.key] === true ? "selected" : ""} disabled={submitted} onClick={() => onSelect(option.key, true)}>True</button><button type="button" aria-label={`Statement ${option.key}: False`} aria-pressed={current[option.key] === false} className={current[option.key] === false ? "selected" : ""} disabled={submitted} onClick={() => onSelect(option.key, false)}>False</button></div></div>)}</div>;
}

function PracticeView({ questions, index, setIndex, answers, setAnswer, submitted, confidence, setConfidence, submit, onFinish }: any) {
  useEffect(() => { window.scrollTo({ top: 0, behavior: "smooth" }); }, [index]);
  const q = questions[index];
  if (!q) return <div className="empty"><strong>No practice set yet.</strong><button className="primary-button" onClick={onFinish}>Back to start</button></div>;
  const current: Answers = answers[q.id] || {};
  const done = isComplete(q, current);
  const isSubmitted = submitted.has(q.id);
  const result = isSubmitted ? scoreQuestion(q, current) : null;
  const total = scoreTotal(q);
  const mcq = getFormat(q) === "mcq";
  return <>
    <section className="hero compact"><div><p className="eyebrow">Untimed practice · {mcq ? "Single-best-answer MCQ" : "True / False MTF"}</p><h1>Think, commit, then learn.</h1><p>{mcq ? "Choose the single best answer and rate your confidence." : "Judge each statement independently and rate your confidence."}</p></div><div className="session-counter">{index + 1} <span>/ {questions.length}</span></div></section>
    <div className="practice-card"><SessionProgress index={index} total={questions.length} answered={submitted.size} /><div className="badges"><span className="badge book-badge">{q.book}</span><span className="badge">{q.section}</span><span className={`badge difficulty-${getDifficulty(q)}`}>{getDifficulty(q)}</span></div><h2 tabIndex={-1}>{q.question}</h2><AnswerControls q={q} current={current} submitted={isSubmitted} onSelect={(key, value) => setAnswer("practice", q, key, value)} />{!isSubmitted && <ConfidencePicker value={confidence[q.id] || "medium"} onChange={(value) => setConfidence((current: Record<string, Confidence>) => ({ ...current, [q.id]: value }))} />}{result !== null && <><div className="result-callout compact-result" role="status" aria-live="polite"><strong>{result}/{total} correct</strong><span>Your next review was scheduled automatically from this score and confidence.</span></div><ExplanationPanel q={q} result={result} total={total} /></>}
      <div className="practice-footer session-actions"><button className="secondary-button" disabled={index === 0} onClick={() => setIndex(Math.max(0, index - 1))}>Previous</button>{isSubmitted ? <button className="primary-button" disabled={index === questions.length - 1} onClick={() => setIndex(Math.min(questions.length - 1, index + 1))}>Next question</button> : <button className="primary-button" disabled={!done} onClick={submit}>Submit answer</button>}<button className="secondary-button" onClick={onFinish}>Exit</button></div>
      <p className="shortcut-hint session-shortcuts"><kbd>1–5</kbd> answer · <kbd>Enter</kbd> submit/next · <kbd>←</kbd><kbd>→</kbd> navigate</p>
    </div>
  </>;
}

function ExamView({ started, questions, index, setIndex, answers, setAnswer, flags, setFlags, confidence, setConfidence, seconds, config, setConfig, start, finish, questionPool, bookOptions, sectionOptions, chapterOptions, progress }: any) {
  useEffect(() => { if (started) window.scrollTo({ top: 0, behavior: "smooth" }); }, [index, started]);
  if (!started) return <ExamBuilder config={config} setConfig={setConfig} start={start} questionPool={questionPool} bookOptions={bookOptions} sectionOptions={sectionOptions} chapterOptions={chapterOptions} progress={progress} />;
  const q = questions[index];
  if (!q) return <div className="empty"><strong>No questions available for this exam.</strong><button className="secondary-button" onClick={() => finish()}>Back</button></div>;
  const current: Answers = answers[q.id] || {};
  const answeredCount = questions.filter((item: Question) => isComplete(item, answers[item.id] || {})).length;
  return <>
    <section className="hero compact"><div><p className="eyebrow">Exam simulator · {getFormat(q) === "mcq" ? "Single-best-answer MCQ" : "True / False MTF"}</p><h1>Focus under pressure.</h1><p>Answers and explanations stay hidden until the exam is submitted.</p></div><div className={`timer ${seconds <= 300 ? "urgent" : ""}`} aria-label={`${Math.floor(seconds / 60)} minutes remaining`}>{formatStatic(seconds)}</div></section>
    <div className="exam-layout"><div className="practice-card exam-card"><SessionProgress index={index} total={questions.length} answered={answeredCount} /><div className="exam-meta"><span>Question {index + 1} of {questions.length}</span><button className={flags.has(q.id) ? "flag active" : "flag"} aria-pressed={flags.has(q.id)} onClick={() => setFlags((current: Set<string>) => { const next = new Set(current); next.has(q.id) ? next.delete(q.id) : next.add(q.id); return next; })}>⚑ {flags.has(q.id) ? "Flagged" : "Flag"}</button></div><h2 tabIndex={-1}>{q.question}</h2><AnswerControls q={q} current={current} onSelect={(key, value) => setAnswer("exam", q, key, value)} /><ConfidencePicker value={confidence[q.id] || "medium"} onChange={(value) => setConfidence((current: Record<string, Confidence>) => ({ ...current, [q.id]: value }))} /><div className="practice-footer session-actions"><button className="secondary-button" disabled={index === 0} onClick={() => setIndex(Math.max(0, index - 1))}>Previous</button>{index === questions.length - 1 ? <button className="primary-button" onClick={() => { if (window.confirm(`Submit exam with ${answeredCount}/${questions.length} questions answered?`)) finish(); }}>Submit exam</button> : <button className="primary-button" onClick={() => setIndex(index + 1)}>Next question</button>}</div><p className="shortcut-hint session-shortcuts"><kbd>1–5</kbd> answer · <kbd>G</kbd> flag · <kbd>←</kbd><kbd>→</kbd> navigate</p></div>
      <aside className="question-map"><strong>Question map</strong><div>{questions.map((item: Question, itemIndex: number) => <button key={item.id} aria-label={`Question ${itemIndex + 1}${isComplete(item, answers[item.id] || {}) ? ", answered" : ""}${flags.has(item.id) ? ", flagged" : ""}`} className={`${itemIndex === index ? "current " : ""}${isComplete(item, answers[item.id] || {}) ? "answered " : ""}${flags.has(item.id) ? "flagged" : ""}`} onClick={() => setIndex(itemIndex)}>{itemIndex + 1}</button>)}</div><p>{answeredCount} answered · {flags.size} flagged</p></aside>
    </div>
  </>;
}

function ExamBuilder({ config, setConfig, start, questionPool, bookOptions, sectionOptions, chapterOptions, progress }: any) {
  const basePool = questionPool.filter((q: Question) => getFormat(q) === config.format && (config.book === "all" || q.book === config.book) && (config.section === "all" || q.section === config.section) && (config.chapter === "all" || q.chapters.includes(config.chapter)));
  const selectedPool = config.selection === "due" ? basePool.filter((question: Question) => dueNow(progress[question.id])) : config.selection === "weak" ? basePool.filter((question: Question) => progress[question.id]?.answered && progress[question.id]?.correct !== scoreTotal(question)) : basePool;
  const pool = selectedPool.length ? selectedPool : basePool;
  const mcqCount = questionPool.filter((q: Question) => getFormat(q) === "mcq").length;
  const trueFalseCount = questionPool.filter((q: Question) => getFormat(q) === "true-false").length;
  async function copySetup() {
    const encoded = btoa(JSON.stringify(config));
    await navigator.clipboard.writeText(`${window.location.origin}${window.location.pathname}?exam=${encoded}`);
  }
  return <><section className="hero"><div><p className="eyebrow">Exam simulator</p><h1>Build the paper you need.</h1><p>Choose the source, selection strategy, length, and time limit. Settings are remembered locally.</p></div></section><div className="builder-card"><div className="builder-grid">
    <label>Format<select value={config.format} onChange={(event) => setConfig({ ...config, format: event.target.value })}><option value="true-false">True / False MTF ({trueFalseCount})</option><option value="mcq" disabled={!mcqCount}>Single-best-answer MCQ ({mcqCount})</option></select></label>
    <label>Book<select value={config.book} onChange={(event) => setConfig({ ...config, book: event.target.value })}><option value="all">All books</option>{bookOptions.map((value: string) => <option key={value}>{value}</option>)}</select></label>
    <label>Section<select value={config.section} onChange={(event) => setConfig({ ...config, section: event.target.value })}><option value="all">All sections</option>{sectionOptions.map((value: string) => <option key={value}>{value}</option>)}</select></label>
    <label>Chapter<select value={config.chapter} onChange={(event) => setConfig({ ...config, chapter: event.target.value })}><option value="all">All chapters</option>{chapterOptions.map((value: string) => <option key={value}>{value}</option>)}</select></label>
    <label>Selection<select value={config.selection} onChange={(event) => setConfig({ ...config, selection: event.target.value })}><option value="random">Random questions</option><option value="weak">Weak questions first</option><option value="due">Due reviews only</option></select></label>
    <label>Questions<input type="number" min={1} max={Math.max(1, pool.length)} value={config.count} onChange={(event) => setConfig({ ...config, count: Math.max(1, Number(event.target.value)) })} /></label>
    <label>Time limit (minutes)<input type="number" min={1} max={300} value={config.minutes} onChange={(event) => setConfig({ ...config, minutes: Math.max(1, Number(event.target.value)) })} /></label>
    <label className="check-field"><input type="checkbox" checked={config.balanced} onChange={(event) => setConfig({ ...config, balanced: event.target.checked })} /><span>Balance questions across chapters</span></label>
  </div><div className="builder-summary"><strong>{pool.length} questions available</strong><span>{config.selection !== "random" && !selectedPool.length ? "No matching priority questions yet, so the full filtered pool will be used." : config.format === "mcq" ? "One answer is selected from five options." : "Each statement is scored independently as True or False."}</span></div><div className="builder-actions"><button className="secondary-button" onClick={copySetup}>Copy exam setup link</button><button className="primary-button large" disabled={!pool.length} onClick={start}>Start exam</button></div></div></>;
}

function ResultsView({ questions, answers, elapsedSeconds, onRestart, onReview }: any) {
  const total = questions.reduce((n: number, q: Question) => n + scoreTotal(q), 0);
  const correct = questions.reduce((n: number, q: Question) => n + scoreQuestion(q, answers[q.id] || {}), 0);
  const percentage = total ? Math.round((correct / total) * 100) : 0;
  const topicRows = [...questions.reduce((map: Map<string, { earned: number; total: number; count: number }>, question: Question) => { const topic = getTopic(question); const current = map.get(topic) || { earned: 0, total: 0, count: 0 }; current.earned += scoreQuestion(question, answers[question.id] || {}); current.total += scoreTotal(question); current.count += 1; map.set(topic, current); return map; }, new Map()).entries()].map(([topic, value]) => ({ topic, ...value, percentage: value.total ? Math.round((value.earned / value.total) * 100) : 0 })).sort((a, b) => a.percentage - b.percentage);
  return <><section className="hero"><div><p className="eyebrow">Exam complete</p><h1>Know what to review next.</h1><p>The result includes one mark per SBA or one mark per MTF statement.</p></div><div className="score-ring" role="img" aria-label={`Score ${percentage} percent`}><strong>{percentage}%</strong><span>{correct}/{total}</span></div></section><div className="result-summary"><Stat value={questions.length} label="questions" /><Stat value={Math.round(elapsedSeconds / 60)} label="minutes" /><Stat value={questions.length ? Math.round(elapsedSeconds / questions.length) : 0} label="sec / question" /></div><div className="results-grid"><div className="result-panel"><h2>Performance</h2><div className="result-bar" role="progressbar" aria-label="Exam score" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percentage}><span style={{ width: percentage + "%" }} /></div><p>{percentage >= 80 ? "Strong performance. Keep the momentum." : percentage >= 60 ? "A solid base. Review the weakest topics." : "Start with the lowest topic scores and the due review queue."}</p><h3>Topic breakdown</h3>{topicRows.map((row) => <div className="topic-result" key={row.topic}><span>{row.topic}<small>{row.count} questions</small></span><b className={row.percentage >= 80 ? "good" : "needs-review"}>{row.percentage}%</b></div>)}<div className="practice-footer"><button className="primary-button" onClick={onRestart}>Build another exam</button><button className="secondary-button" onClick={onReview}>Review mistakes</button></div></div><div className="result-panel"><h2>Question breakdown</h2>{questions.map((q: Question) => { const result = scoreQuestion(q, answers[q.id] || {}); const itemTotal = scoreTotal(q); return <div className="breakdown-row" key={q.id}><span>Q{q.number} · {q.question}</span><b className={result === itemTotal ? "good" : "needs-review"}>{result}/{itemTotal}</b></div>; })}</div></div></>;
}

function DailyGoalCard({ activity, goal, dueCount, onReviewDue, onDashboard }: { activity: DailyActivity; goal: DailyGoal; dueCount: number; onReviewDue: () => void; onDashboard: () => void }) {
  const questionPercent = Math.min(100, Math.round((activity.answered / Math.max(1, goal.questions)) * 100));
  const minutePercent = Math.min(100, Math.round(((activity.seconds / 60) / Math.max(1, goal.minutes)) * 100));
  return <section className="daily-card"><div><p className="eyebrow">Today</p><h2>{activity.answered}/{goal.questions} questions · {Math.round(activity.seconds / 60)}/{goal.minutes} minutes</h2><div className="dual-progress"><div><span>Questions</span><div role="progressbar" aria-label="Daily question goal" aria-valuemin={0} aria-valuemax={100} aria-valuenow={questionPercent}><i style={{ width: `${questionPercent}%` }} /></div></div><div><span>Study time</span><div role="progressbar" aria-label="Daily study-time goal" aria-valuemin={0} aria-valuemax={100} aria-valuenow={minutePercent}><i style={{ width: `${minutePercent}%` }} /></div></div></div></div><div className="daily-actions"><button className="primary-button" disabled={!dueCount} onClick={onReviewDue}>Review {dueCount} due</button><button className="secondary-button" onClick={onDashboard}>View performance</button></div></section>;
}

function SessionProgress({ index, total, answered }: { index: number; total: number; answered: number }) {
  const percentage = total ? Math.round(((index + 1) / total) * 100) : 0;
  return <div className="session-progress"><div><span>Question {index + 1} of {total}</span><small>{answered} answered</small></div><div role="progressbar" aria-label="Session progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percentage}><i style={{ width: `${percentage}%` }} /></div></div>;
}

function ConfidencePicker({ value, onChange }: { value: Confidence; onChange: (value: Confidence) => void }) {
  return <div className="confidence-picker" role="group" aria-label="Rate your confidence"><span>Confidence</span>{(["low", "medium", "high"] as Confidence[]).map((item) => <button key={item} type="button" className={value === item ? "active" : ""} aria-pressed={value === item} onClick={() => onChange(item)}>{item === "low" ? "Guessing" : item === "medium" ? "Unsure" : "Confident"}</button>)}</div>;
}

function DashboardView({ topicStats, todayActivity, dailyGoal, setDailyGoal, dueCount, attempts, questions, onPracticeTopic, onReviewDue }: any) {
  const earned = attempts.reduce((sum: number, attempt: Attempt) => sum + attempt.earned, 0);
  const total = attempts.reduce((sum: number, attempt: Attempt) => sum + attempt.total, 0);
  const accuracy = total ? Math.round((earned / total) * 100) : 0;
  const lowConfidence = attempts.filter((attempt: Attempt) => attempt.confidence === "low").length;
  const coveredQuestions = new Set(attempts.map((attempt: Attempt) => attempt.questionId)).size;
  return <><section className="hero"><div><p className="eyebrow">Performance dashboard</p><h1>Turn results into the next action.</h1><p>Accuracy, confidence, coverage, and due reviews are combined to show where practice will have the greatest value.</p></div><div className="stats"><Stat value={accuracy} label="accuracy %" /><Stat value={coveredQuestions} label={`of ${questions.length} seen`} /><Stat value={dueCount} label="due today" /></div></section>
    <div className="dashboard-grid"><section className="dashboard-card"><h2>Daily goal</h2><div className="goal-inputs"><label>Questions<input type="number" min={1} max={300} value={dailyGoal.questions} onChange={(event) => setDailyGoal({ ...dailyGoal, questions: Math.max(1, Number(event.target.value)) })} /></label><label>Minutes<input type="number" min={1} max={300} value={dailyGoal.minutes} onChange={(event) => setDailyGoal({ ...dailyGoal, minutes: Math.max(1, Number(event.target.value)) })} /></label></div><p>{todayActivity.answered} questions and {Math.round(todayActivity.seconds / 60)} minutes completed today.</p><button className="primary-button" disabled={!dueCount} onClick={onReviewDue}>Start due review ({dueCount})</button></section><section className="dashboard-card"><h2>Learning signals</h2><div className="signal-grid"><Stat value={attempts.length} label="attempts" /><Stat value={lowConfidence} label="low confidence" /><Stat value={accuracy} label="mark accuracy %" /></div><p>A correct answer with low confidence returns sooner in the review schedule.</p></section></div>
    <section className="topic-panel"><div className="panel-heading"><div><p className="eyebrow">Topic analysis</p><h2>Weakest topics first</h2></div><span>Topics need several attempts before the score becomes reliable.</span></div>{topicStats.length ? <div className="topic-table">{topicStats.map((row: any) => <div className="topic-row" key={row.topic}><div><strong>{row.topic}</strong><span>{row.attempts} attempts · {row.due} due · {row.lowConfidence} low-confidence</span></div><div className="topic-meter" role="progressbar" aria-label={`${row.topic} accuracy`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={row.accuracy}><i style={{ width: `${row.accuracy}%` }} /></div><b className={row.accuracy >= 80 ? "good" : "needs-review"}>{row.accuracy}%</b><button className="secondary-button" onClick={() => onPracticeTopic(row.topic)}>Practice</button></div>)}</div> : <div className="empty"><strong>No performance data yet.</strong>Complete a practice question or exam to build your dashboard.</div>}</section>
  </>;
}

function NotebookView({ questions, progress, updateProgress, revealed, setRevealed, onPractice }: any) {
  return <><section className="hero"><div><p className="eyebrow">Mistake notebook</p><h1>Keep difficult knowledge visible.</h1><p>This view collects incorrect, bookmarked, noted, and reported questions automatically.</p></div><div className="stats"><Stat value={questions.length} label="items" /><Stat value={questions.filter((question: Question) => progress[question.id]?.note?.trim()).length} label="with notes" /><Stat value={questions.filter((question: Question) => progress[question.id]?.reported).length} label="to check" /></div></section><div className="library-actions"><span>Review the explanation, then leave a concise memory hook.</span><button className="primary-button" disabled={!questions.length} onClick={onPractice}>Practice notebook</button></div><div className="question-list">{questions.map((question: Question) => <QuestionCard key={question.id} q={question} progress={progress[question.id] || {}} open={revealed.has(question.id)} onReveal={() => setRevealed((current: Set<string>) => { const next = new Set(current); next.has(question.id) ? next.delete(question.id) : next.add(question.id); return next; })} onBookmark={() => updateProgress(question.id, { bookmarked: !progress[question.id]?.bookmarked })} onNote={(note) => updateProgress(question.id, { note })} onReport={() => updateProgress(question.id, { reported: !progress[question.id]?.reported })} />)}</div>{!questions.length && <div className="empty"><strong>Your notebook is empty.</strong>Incorrect answers, bookmarks, personal notes, and reported questions will appear here.</div>}</>;
}

function formatStatic(seconds: number) {
  return Math.floor(seconds / 60).toString().padStart(2, "0") + ":" + (seconds % 60).toString().padStart(2, "0");
}

function Stat({ value, label }: { value: number; label: string }) {
  return <div className="stat"><strong>{value}</strong><span>{label}</span></div>;
}

function Pagination({ page, totalPages, setPage }: any) {
  if (totalPages <= 1) return null;
  const start = Math.max(1, Math.min(page - 3, totalPages - 6));
  const pages = Array.from({ length: Math.min(totalPages, 7) }, (_, index) => start + index);
  return <nav className="pagination" aria-label="Question library pages"><button disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</button>{pages.map((item) => <button aria-current={page === item ? "page" : undefined} className={page === item ? "active" : ""} key={item} onClick={() => setPage(item)}>{item}</button>)}<button disabled={page === totalPages} onClick={() => setPage(page + 1)}>Next</button></nav>;
}
