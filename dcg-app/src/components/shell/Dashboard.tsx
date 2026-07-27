import { useEffect, useMemo, useState } from "react";
import { useAppState } from "../../state/AppState";
import { countdownTo, todayIso } from "../../lib/format";
import { DEFAULT_EXAM_DATE, getExamPhase } from "../../lib/examPlan";
import { DAILY_BUDGETS, buildDailyPlan, type DailyBudget, type DailyPlanTask } from "../../lib/dailyPlan";
import type { Chapter } from "../../lib/types";
import { QuickReview } from "./QuickReview";
import { QuickQuiz } from "./QuickQuiz";
import { ExamSimulation } from "./ExamSimulation";
import { WeeklyBilanModal } from "./WeeklyBilan";
import type { ShellView } from "./Nav";

type DailyTask = DailyPlanTask & {
  eyebrow: string;
  title: string;
  detail: string;
  tone: "red" | "green" | "cyan" | "blue";
  action: () => void;
  why: string;
};

export function Dashboard({ onNavigate, onQuickStart }: { onNavigate: (view: ShellView) => void; onQuickStart: (chapter: Chapter) => void }) {
  const { ready, ues, chapters, dueChapters, dueFlashcards, dueQuiz, errorNotes, examDate, studentName, focusUeIds, refreshAll } = useAppState();
  const [reviewOpen, setReviewOpen] = useState(false);
  const [quizOpen, setQuizOpen] = useState(false);
  const [bilanOpen, setBilanOpen] = useState(false);
  const [simulationOpen, setSimulationOpen] = useState(false);
  const [planKeys, setPlanKeys] = useState<string[]>([]);
  const [completedKeys, setCompletedKeys] = useState<string[]>([]);
  const [budget, setBudget] = useState<DailyBudget>(() => {
    const saved = Number(window.localStorage.getItem("dcg-daily-budget"));
    return DAILY_BUDGETS.includes(saved as DailyBudget) ? saved as DailyBudget : 30;
  });

  const today = todayIso();
  const planStorageKey = `dcg-daily-plan:${today}:${budget}`;
  const weekday = new Intl.DateTimeFormat("fr-FR", { weekday: "long" }).format(new Date());
  const phase = getExamPhase(examDate || DEFAULT_EXAM_DATE);
  const countdown = countdownTo(examDate || DEFAULT_EXAM_DATE);
  const dueErrors = errorNotes.filter((error) => error.status === "active" && error.next_review_date <= today);
  const dueToday = dueChapters.find((chapter) => chapter.next_review_date <= today);
  const focusedChapters = focusUeIds.length ? chapters.filter((chapter) => focusUeIds.includes(chapter.ue_id)) : chapters;
  const nextChapter = focusedChapters.find((chapter) => chapter.status === "ongoing") ?? focusedChapters.find((chapter) => chapter.status === "todo");

  const dailyPlan = useMemo(() => buildDailyPlan({
    budgetMinutes: budget,
    phaseId: phase.id,
    focusUeIds,
    dueErrors,
    dueFlashcardCount: dueFlashcards.cards.length,
    totalDueFlashcardCount: dueFlashcards.total,
    dueQuizCount: dueQuiz.items.length,
    totalDueQuizCount: dueQuiz.total,
    dueChapter: dueToday ?? null,
    nextChapter: nextChapter ?? null,
  }), [budget, dueErrors, dueFlashcards, dueQuiz, dueToday, focusUeIds, nextChapter, phase.id]);

  const availableTasks = useMemo<DailyTask[]>(() => dailyPlan.tasks.flatMap<DailyTask>((task) => {
    const count = task.count ?? 0;
    const total = task.total ?? count;
    if (task.kind === "errors") return [{ ...task, eyebrow: task.focused ? "Point faible prioritaire · UE en focus" : "Point faible prioritaire", title: `${count} erreur${count > 1 ? "s" : ""} à retravailler${count < total ? ` sur ${total}` : ""}`, detail: "Rappelle la règle, applique-la, puis valide l'étape.", tone: "red", action: () => onNavigate("progress"), why: "Ces erreurs sont déjà dues : les traiter évite qu'un point perdu reste une lacune active." }];
    if (task.kind === "cards") return [{ ...task, eyebrow: "Mémoire · SM-2", title: `${count} carte${count > 1 ? "s" : ""} à rappeler${count < total ? ` sur ${total}` : ""}`, detail: "Formule d'abord la réponse : ce lot tient dans ton temps disponible.", tone: "green", action: () => setReviewOpen(true), why: "Ces cartes sont dues par l'algorithme SM-2 ; les revoir maintenant protège leur stabilité." }];
    if (task.kind === "quiz") return [{ ...task, eyebrow: "Vérification · erreurs passées", title: `${count} question${count > 1 ? "s" : ""} déjà ratée${count < total ? ` sur ${total}` : ""}`, detail: "Rejoue les pièges qui t'ont coûté des points, avec feedback immédiat.", tone: "cyan", action: () => setQuizOpen(true), why: "La répétition espacée des erreurs évite de confondre à nouveau une réponse séduisante avec la bonne règle." }];
    if (task.kind === "chapter" && dueToday) {
      const chapter = chapters.find((item) => item.id === dueToday.chapter_id);
      if (chapter) return [{ ...task, eyebrow: "Révision de chapitre", title: chapter.name, detail: `${dueToday.ue_code} · révision programmée`, tone: "blue", action: () => onQuickStart(chapter), why: "Ce chapitre est arrivé à son échéance de révision : le revoir consolide le rappel avant d'ajouter du nouveau contenu." }];
    }
    if (task.kind === "new-chapter" && nextChapter) return [{ ...task, eyebrow: task.focused ? "UE prioritaire · nouveau contenu" : "Avancer dans le programme", title: nextChapter.name, detail: "Aucune révision plus urgente ne prend ce créneau : prépare et étudie la prochaine leçon.", tone: "blue", action: () => onQuickStart(nextChapter), why: "Le budget restant peut maintenant servir à couvrir le programme sans sacrifier les rappels déjà dus." }];
    if (task.kind === "simulation") return [{ ...task, eyebrow: "Simulation DCG adaptative", title: "12 minutes sur tes notions fragiles", detail: "Rédige avant la grille ; les faiblesses repartent en SM-2.", tone: "blue", action: () => setSimulationOpen(true), why: "La phase d'entraînement demande de transformer les notions fragiles en points, sous un temps limité." }];
    return [];
  }), [chapters, dailyPlan.tasks, dueToday, nextChapter, onNavigate, onQuickStart]);

  useEffect(() => {
    if (!ready) return;
    const saved = window.sessionStorage.getItem(planStorageKey);
    if (saved) {
      try { setPlanKeys(JSON.parse(saved)); } catch { /* replace malformed local state */ }
    } else {
      const keys = availableTasks.map((task) => task.key);
      window.sessionStorage.setItem(planStorageKey, JSON.stringify(keys));
      setPlanKeys(keys);
    }
    const savedCompleted = window.sessionStorage.getItem(`${planStorageKey}:completed`);
    try { setCompletedKeys(savedCompleted ? JSON.parse(savedCompleted) : []); } catch { setCompletedKeys([]); }
  }, [ready, planStorageKey, availableTasks]);

  const completePlanTask = (key: string) => {
    setCompletedKeys((current) => {
      const next = current.includes(key) ? current : [...current, key];
      window.sessionStorage.setItem(`${planStorageKey}:completed`, JSON.stringify(next));
      return next;
    });
  };

  const taskByKey = new Map(availableTasks.map((task) => [task.key, task]));
  const remainingTasks = planKeys.filter((key) => !completedKeys.includes(key)).map((key) => taskByKey.get(key)).filter((task): task is DailyTask => Boolean(task));
  const completedCount = planKeys.filter((key) => completedKeys.includes(key) || !taskByKey.has(key)).length;
  const totalMinutes = remainingTasks.reduce((sum, task) => sum + task.minutes, 0);
  const finished = ready && planKeys.length > 0 && remainingTasks.length === 0;
  const emptyStart = ready && planKeys.length === 0;
  const primaryTask = remainingTasks[0];
  const followingTasks = remainingTasks.slice(1);
  const completedChapters = chapters.filter((chapter) => chapter.status === "done").length;
  const plannedCardCount = dailyPlan.tasks.find((task) => task.kind === "cards")?.count ?? 0;
  const plannedQuizCount = dailyPlan.tasks.find((task) => task.kind === "quiz")?.count ?? 0;
  const focusedUeCodes = new Set(ues.filter((ue) => focusUeIds.includes(ue.id)).map((ue) => ue.code));
  const plannedCards = [...dueFlashcards.cards].sort((a, b) => Number(focusedUeCodes.has(b.ue_code)) - Number(focusedUeCodes.has(a.ue_code))).slice(0, plannedCardCount);
  const plannedQuiz = [...dueQuiz.items].sort((a, b) => Number(focusedUeCodes.has(b.ue_code)) - Number(focusedUeCodes.has(a.ue_code))).slice(0, plannedQuizCount);
  const deferred = [
    dailyPlan.deferred.errors ? `${dailyPlan.deferred.errors} erreur${dailyPlan.deferred.errors > 1 ? "s" : ""}` : "",
    dailyPlan.deferred.cards ? `${dailyPlan.deferred.cards} carte${dailyPlan.deferred.cards > 1 ? "s" : ""}` : "",
    dailyPlan.deferred.quiz ? `${dailyPlan.deferred.quiz} question${dailyPlan.deferred.quiz > 1 ? "s" : ""}` : "",
    dailyPlan.deferred.chapter ? "une révision de chapitre" : "",
  ].filter(Boolean).join(" · ");

  return (
    <div className="desktop-page today-page">
      <header className="work-header today-header">
        <div><div className="eyebrow">{weekday} · plan de travail</div><h1 className="work-title">{studentName ? `Bonjour ${studentName}` : "Plan de travail"}</h1><p className="work-lead">Une seule priorité à la fois. Le reste attend son tour : tu sais exactement quand t'arrêter.</p></div>
        <div className="today-deadline" aria-label={`Échéance : ${countdown?.days ?? phase.daysLeft} jours avant l'examen`}><b>{countdown?.days ?? phase.daysLeft}</b><span>jours avant<br />le DCG</span></div>
      </header>

      <section className="surface" aria-label="Temps disponible aujourd'hui" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap", padding: "14px 16px", marginBottom: 16 }}>
        <div><div className="section-kicker">Temps disponible</div><strong style={{ display: "block", marginTop: 3, fontSize: 14 }}>Combien de minutes peux-tu vraiment protéger aujourd'hui ?</strong><p style={{ margin: "4px 0 0", color: "var(--muted)", fontSize: 11 }}>Le plan garde les rappels dus en priorité et n'ajoute du nouveau contenu que s'il reste un créneau.</p></div>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>{DAILY_BUDGETS.map((value) => <button key={value} onClick={() => { window.localStorage.setItem("dcg-daily-budget", String(value)); setBudget(value); }} style={{ padding: "7px 10px", borderRadius: 4, border: `1px solid ${budget === value ? "var(--accent-blue)" : "var(--border)"}`, background: budget === value ? "color-mix(in srgb,var(--accent-blue) 12%,var(--card))" : "var(--card2)", color: budget === value ? "var(--text)" : "var(--muted)", fontWeight: 700, fontSize: 12 }}>{value} min</button>)}</div>
        <div style={{ width: "100%", color: "var(--muted)", fontSize: 11, lineHeight: 1.5 }}><strong style={{ color: "var(--text)" }}>{dailyPlan.usedMinutes} min utiles proposés sur {budget} min.</strong>{deferred ? ` ${deferred} reste dû et reviendra automatiquement : le plan limite seulement le lot d'aujourd'hui.` : " Tout ce qui est dû tient dans ce créneau."}</div>
      </section>

      <section className={`priority-session surface${finished || emptyStart ? " complete" : ""}`}>
        {primaryTask ? <>
          <div className="priority-session-copy">
            <div className="section-kicker">À faire maintenant</div>
            <span className={`priority-session-signal ${primaryTask.tone}`}>{primaryTask.eyebrow}</span>
            <h2>{primaryTask.title}</h2>
            <p>{primaryTask.detail}</p>
            <div className="priority-session-actions"><button className="primary-button" onClick={primaryTask.action}>Commencer la révision <span>→</span></button><span>Environ {primaryTask.minutes} min</span></div>
          </div>
          <aside className="priority-session-context">
            <div><small>Pourquoi maintenant ?</small><p>{primaryTask.why}</p></div>
            <div className="priority-session-phase"><small>Phase actuelle</small><strong>{phase.label}</strong><span>{phase.progress}% de l'année écoulée</span></div>
          </aside>
        </> : (
          <div className="day-complete"><span>✓</span><div><strong>{finished ? "L'essentiel est fait pour aujourd'hui." : "Ton plan est prêt à démarrer."}</strong><p>{finished ? "Le prochain rappel apparaîtra automatiquement au bon moment." : "Choisis une UE dans Réviser pour créer ta première session guidée."}</p></div>{emptyStart && <button className="primary-button" onClick={() => onNavigate("programme")}>Choisir une UE</button>}</div>
        )}
      </section>

      {followingTasks.length > 0 && <section className="next-steps">
        <div className="next-steps-head"><div><div className="section-kicker">Ensuite</div><h2>{followingTasks.length} étape{followingTasks.length > 1 ? "s" : ""} restante{followingTasks.length > 1 ? "s" : ""} · {totalMinutes - primaryTask!.minutes} min</h2></div>{planKeys.length > 0 && <span>{completedCount}/{planKeys.length} terminé{completedCount > 1 ? "s" : ""}</span>}</div>
        <div className="daily-task-list">
          {followingTasks.map((task, index) => <button key={task.key} className={`daily-task ${task.tone}`} onClick={task.action}>
            <span className="daily-task-index">{index + 2}</span>
            <div><small>{task.eyebrow}</small><strong>{task.title}</strong><p>{task.detail}</p></div>
            <span className="daily-task-time">~{task.minutes} min</span>
            <b>Ouvrir</b>
          </button>)}
        </div>
      </section>}

      <section className="today-tools" aria-label="Autres options de travail">
        <div className="today-tools-intro"><div className="section-kicker">Autres options</div><p>À utiliser quand la priorité du jour est terminée.</p></div>
        <div className="today-tools-list">
          <button onClick={() => onNavigate("programme")}><small>RÉVISER</small><strong>{completedChapters}/{chapters.length} chapitres couverts</strong><span>Voir les UE →</span></button>
          <button onClick={() => setSimulationOpen(true)}><small>SIMULATION</small><strong>12 à 45 min sur tes notions faibles</strong><span>Lancer →</span></button>
          <button onClick={() => onNavigate("timer")}><small>SESSION LIBRE</small><strong>Minuteur de travail</strong><span>Lancer →</span></button>
          <button onClick={() => setBilanOpen(true)}><small>BILAN</small><strong>Faire le point sur ta semaine</strong><span>Ouvrir →</span></button>
        </div>
      </section>

      {bilanOpen && <WeeklyBilanModal onClose={() => setBilanOpen(false)} onNavigate={onNavigate} />}
      {quizOpen && <QuickQuiz items={plannedQuiz} total={plannedQuiz.length} onClose={() => { setQuizOpen(false); completePlanTask("quiz"); refreshAll(); }} />}
      {reviewOpen && <QuickReview cards={plannedCards} total={plannedCards.length} onClose={() => { setReviewOpen(false); completePlanTask("cards"); refreshAll(); }} />}
      {simulationOpen && <ExamSimulation onClose={() => { setSimulationOpen(false); refreshAll(); }} />}
    </div>
  );
}
