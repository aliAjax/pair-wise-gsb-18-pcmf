import { useEffect, useMemo, useState, type FormEvent } from "react";
import "./styles.css";
import {
  STAGES,
  STEP_LABELS,
  activeStep,
  averageWorkingLength,
  blockReasonForFill,
  buildSeed,
  carried,
  caseBadge,
  followUpAttended,
  followUps,
  hasStage,
  lastStageEntry,
  loadCases,
  makeStageEntry,
  needsFollowUpRegistration,
  nextChoices,
  saveCases,
  stageEntries,
  stepState,
  summary,
  todayStr,
  uid,
  type Case,
  type Entry,
  type Stage,
} from "./domain";

type FilterKey = "全部" | "待复诊" | "治疗中" | "已充填";
const FILTERS: FilterKey[] = ["全部", "待复诊", "治疗中", "已充填"];

function MetricCard({ label, value, hint, tone }: { label: string; value: string | number; hint?: string; tone: string }) {
  return (
    <article className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      {hint && <em className={`metric-hint tone-${tone}`}>{hint}</em>}
    </article>
  );
}

function Stepper({ c }: { c: Case }) {
  const current = activeStep(c);
  return (
    <ol className={`stepper ${needsFollowUpRegistration(c) ? "has-missing" : ""}`}>
      {STEP_LABELS.map((label) => {
        const state = stepState(c, label);
        const cls = ["step", `s-${state}`];
        if (current === label) cls.push("active");
        return (
          <li key={label} className={cls.join(" ")}>
            <span className="dot" />
            <span className="step-label">{label}</span>
          </li>
        );
      })}
    </ol>
  );
}

function Timeline({ c }: { c: Case }) {
  return (
    <ol className="timeline">
      {c.entries.map((e: Entry) =>
        e.kind === "followup" ? (
          <li key={e.id} className="tl-followup">
            <span className="tl-date">{e.date}</span>
            <span className="tl-tag tag-fu">复诊登记</span>
            <span className="tl-text">计划复诊 {e.plannedDate}</span>
          </li>
        ) : (
          <li key={e.id} className="tl-stage">
            <span className="tl-date">{e.date}</span>
            <span className="tl-tag">{e.stage}</span>
            {e.workingLength && <span className="tl-text">工作长度 {e.workingLength}</span>}
            {e.masterFile && <span className="tl-text">主尖锉 {e.masterFile}</span>}
            {e.note && <span className="tl-note">{e.note}</span>}
          </li>
        )
      )}
    </ol>
  );
}

function CaseCard({ c, onContinue }: { c: Case; onContinue: (id: string) => void }) {
  const badge = caseBadge(c);
  const block = blockReasonForFill(c);
  return (
    <article className="tooth-card">
      <header className="tooth-head">
        <div className="tooth-id">
          <strong>{c.toothNo}</strong>
          <span className="diagnosis">{c.diagnosis}</span>
        </div>
        <span className={`badge tone-${badge.tone}`}>{badge.label}</span>
      </header>

      <Stepper c={c} />

      {needsFollowUpRegistration(c) && (
        <p className="missing-box">
          <b>缺少步骤：复诊登记</b>
          {block && <span>{block.replace(/^[^，]+；?/, "")}</span>}
          <button type="button" className="link-btn" onClick={() => onContinue(c.id)}>
            去登记 →
          </button>
        </p>
      )}

      <Timeline c={c} />

      <footer className="tooth-foot">
        <button type="button" onClick={() => onContinue(c.id)}>
          继续处理这颗牙
        </button>
      </footer>
    </article>
  );
}

function App() {
  const [cases, setCases] = useState<Case[]>(() => loadCases());
  const [filter, setFilter] = useState<FilterKey>("全部");
  const [copied, setCopied] = useState(false);

  // 表单状态
  const [selectedId, setSelectedId] = useState<string>(""); // 空串 = 新牙
  const [date, setDate] = useState(todayStr());
  const [stage, setStage] = useState<Stage>("开髓");
  const [toothNo, setToothNo] = useState("");
  const [diagnosis, setDiagnosis] = useState("");
  const [workingLength, setWorkingLength] = useState("");
  const [masterFile, setMasterFile] = useState("");
  const [note, setNote] = useState("");
  const [plannedDate, setPlannedDate] = useState("");
  const [error, setError] = useState("");

  // 任何变化都落盘：下次打开接着处理
  useEffect(() => {
    saveCases(cases);
  }, [cases]);

  const selected = cases.find((c) => c.id === selectedId) ?? null;

  // 选中牙位变化（或该牙追加了新记录）时，把牙位、工作长度、主尖锉号带走，
  // 并把本次阶段推进到新的下一步（表单只影响新记录，不动旧条目）
  useEffect(() => {
    if (!selected) {
      setWorkingLength("");
      setMasterFile("");
      setError("");
      return;
    }
    setWorkingLength(carried(selected, "workingLength"));
    setMasterFile(carried(selected, "masterFile"));
    setStage(nextChoices(selected)[0] ?? "封药");
    setError("");
    setPlannedDate(latestPlanned(selected));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, cases]);

  const pendingCount = cases.filter(needsFollowUpRegistration).length;
  const filledCount = cases.filter((c) => hasStage(c, "充填")).length;
  const medCount = cases.filter((c) => hasStage(c, "封药")).length;

  const choices = selected ? nextChoices(selected) : STAGES.slice(0, 1);
  const canFillHere = selected ? choices.includes("充填") : false;
  const showFollowUp = !!selected && hasStage(selected, "封药") && !hasStage(selected, "充填");
  const showFillBlocked = !!selected && blockReasonForFill(selected) !== null && stage === "充填";

  const filtered = useMemo(() => {
    const list = cases.filter((c) => {
      if (filter === "待复诊") return needsFollowUpRegistration(c);
      if (filter === "已充填") return hasStage(c, "充填");
      if (filter === "治疗中") return !hasStage(c, "充填");
      return true;
    });
    // 待复诊（缺登记、不能充填）排最前
    return [...list].sort((a, b) => Number(needsFollowUpRegistration(b)) - Number(needsFollowUpRegistration(a)));
  }, [cases, filter]);

  const allSummaries = useMemo(() => {
    const head = `根管治疗病历摘要（${todayStr()}，共 ${cases.length} 颗，待复诊 ${pendingCount} 颗）`;
    return [head, ...cases.map((c) => "· " + summary(c))].join("\n");
  }, [cases, pendingCount]);

  function latestPlanned(c: Case): string {
    const fus = followUps(c);
    if (fus.length) return fus[fus.length - 1].plannedDate;
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toISOString().slice(0, 10);
  }

  function continueTooth(id: string) {
    setSelectedId(id);
    setDate(todayStr());
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function startNew() {
    setSelectedId("");
    setStage("开髓");
    setToothNo("");
    setDiagnosis("");
    setWorkingLength("");
    setMasterFile("");
    setNote("");
    setPlannedDate("");
    setDate(todayStr());
    setError("");
  }

  function submitVisit(e: FormEvent) {
    e.preventDefault();
    setError("");

    if (!date) return setError("请选择接诊日期");

    let target: Case;

    if (selected) {
      target = selected;
      const allowed = nextChoices(target);
      if (!allowed.includes(stage)) {
        return setError(blockReasonForFill(target) ?? `该牙位当前不能追加「${stage}」，请按步骤推进`);
      }
    } else {
      const no = toothNo.trim();
      if (!no) return setError("请填写牙位");
      if (!/^#?\d{1,2}$/.test(no)) return setError("牙位格式示例：#36");
      const norm = no.startsWith("#") ? no : "#" + no;
      if (cases.some((c) => c.toothNo === norm)) {
        return setError(`牙位 ${norm} 已存在，请在列表中选择该牙继续处理（复诊只追加，不新建）`);
      }
      if (!diagnosis.trim()) return setError("请填写诊断");
      target = {
        id: uid(),
        toothNo: norm,
        diagnosis: diagnosis.trim(),
        createdAt: date,
        entries: [],
      };
    }

    // 复诊只追加新阶段，不改写旧记录：工作长度/主尖锉号在新条目里快照
    const entry = makeStageEntry(date, stage, workingLength, masterFile, note);
    setCases((prev) => {
      const exists = prev.find((c) => c.id === target.id);
      if (exists) {
        return prev.map((c) => (c.id === target.id ? { ...c, entries: [...c.entries, entry] } : c));
      }
      return [...prev, { ...target, entries: [entry] }];
    });

    // 收尾表单，准备好继续下一次
    setNote("");
    setDate(todayStr());
  }

  function registerFollowUp(e: FormEvent) {
    e.preventDefault();
    if (!selected) return;
    if (!plannedDate) return setError("请选择计划复诊日期");
    const entry: Entry = {
      id: uid(),
      kind: "followup",
      date: todayStr(),
      plannedDate,
    };
    setCases((prev) => prev.map((c) => (c.id === selected.id ? { ...c, entries: [...c.entries, entry] } : c)));
    setError("");
  }

  function resetDemo() {
    if (!window.confirm("清空当前病历并恢复演示数据？")) return;
    setCases(buildSeed());
    startNew();
  }

  async function exportSummaries() {
    try {
      await navigator.clipboard.writeText(allSummaries);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      window.alert(allSummaries);
    }
  }

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">牙体牙髓 · 按单颗牙推进根管治疗</p>
          <h1>根管治疗工作台</h1>
          <p className="subtitle">
            每颗牙按「开髓 → 测长 → 根管预备 → 封药 → 复诊 → 充填」推进；接诊记录只追加不改写，
            牙位、工作长度、主尖锉号随复诊带走。已封药未登记复诊的牙位不能充填，页面会明确指出缺步。
          </p>
        </div>
        <div className="stack-card">
          <span>待复诊（已封药·未登记）</span>
          <strong className={pendingCount > 0 ? "num-danger" : ""}>{pendingCount} 颗</strong>
          <button type="button" onClick={resetDemo} className="ghost-btn">
            恢复演示数据
          </button>
        </div>
      </section>

      <section className="metrics-grid">
        <MetricCard label="管理牙位" value={cases.length} hint={`治疗中 ${cases.length - filledCount}`} tone="neutral" />
        <MetricCard
          label="待复诊"
          value={pendingCount}
          hint={pendingCount ? "缺复诊登记，禁充填" : "无"}
          tone={pendingCount ? "danger" : "neutral"}
        />
        <MetricCard label="已充填" value={filledCount} hint="根管治疗完成" tone="green" />
        <MetricCard label="平均工作长度" value={averageWorkingLength(cases)} hint={`封药病例 ${medCount}`} tone="neutral" />
      </section>

      <section className="workspace">
        <form className="panel narrow" onSubmit={submitVisit}>
          <div className="section-heading">
            <div>
              <p>{selected ? "继续处理（复诊只追加）" : "新牙首次接诊"}</p>
              <h2>{selected ? selected.toothNo : "接诊录入"}</h2>
            </div>
            {selected && (
              <button type="button" className="ghost-btn" onClick={startNew}>
                + 新牙
              </button>
            )}
          </div>

          {selected ? (
            <div className="carried-box">
              <span>牙位</span>
              <b>{selected.toothNo}</b>
              <span>诊断</span>
              <b>{selected.diagnosis}</b>
            </div>
          ) : (
            <div className="field-grid">
              <label>
                <span>牙位 *</span>
                <input
                  value={toothNo}
                  onChange={(e) => setToothNo(e.target.value)}
                  placeholder="如 #36"
                  autoComplete="off"
                />
              </label>
              <label>
                <span>诊断 *</span>
                <input
                  value={diagnosis}
                  onChange={(e) => setDiagnosis(e.target.value)}
                  placeholder="如 急性牙髓炎"
                  autoComplete="off"
                />
              </label>
            </div>
          )}

          <label className="block-label">
            <span>本次阶段 *</span>
            <div className="stage-pick">
              {(selected ? choices : STAGES.slice(0, 1)).map((s) => (
                <button
                  key={s}
                  type="button"
                  className={stage === s ? "picked" : ""}
                  onClick={() => setStage(s)}
                >
                  {s}
                </button>
              ))}
            </div>
          </label>

          {showFillBlocked && (
            <p className="error-box">
              {blockReasonForFill(selected!)}
              {needsFollowUpRegistration(selected!) && "（请在下方先登记复诊）"}
            </p>
          )}

          <div className="field-grid">
            <label>
              <span>接诊日期 *</span>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
            <label>
              <span>工作长度（自动带入，可更新）</span>
              <input
                value={workingLength}
                onChange={(e) => setWorkingLength(e.target.value)}
                placeholder="如 19.5mm 或 近中19.0/远中20.5"
                autoComplete="off"
              />
            </label>
          </div>

          <label className="block-label">
            <span>主尖锉号（自动带入，可更新）</span>
            <input
              value={masterFile}
              onChange={(e) => setMasterFile(e.target.value)}
              placeholder="如 #30"
              autoComplete="off"
            />
          </label>

          <label className="block-label">
            <span>本次处理备注</span>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="冲洗、封药材料、充填方式等（旧记录不会被改写）"
              autoComplete="off"
            />
          </label>

          {error && <p className="error-box">{error}</p>}

          <button className="primary-action" type="submit" disabled={!!selected && choices.length === 0 && stage !== "充填"}>
            追加本次接诊记录
          </button>

          {showFollowUp && (
            <div className="followup-box">
              <h3>复诊登记</h3>
              {followUps(selected).length === 0 ? (
                <>
                  <p className="warn-text">
                    已封药且尚未登记复诊 —— 登记后才允许充填，否则将提示缺少「复诊登记」。
                  </p>
                  <div className="fu-row">
                    <label>
                      <span>计划复诊日期</span>
                      <input type="date" value={plannedDate} onChange={(e) => setPlannedDate(e.target.value)} />
                    </label>
                    <button type="button" className="warn-action" onClick={registerFollowUp}>
                      登记复诊
                    </button>
                  </div>
                </>
              ) : (
                <p className="ok-text">
                  最近一次复诊：{followUps(selected)[followUps(selected).length - 1].plannedDate}
                  {followUpAttended(selected) ? "（已到诊继续处理，可充填）" : "（已登记，到诊后追加充填即可）"}
                </p>
              )}
            </div>
          )}
        </form>

        <section className="panel">
          <div className="section-heading">
            <div>
              <p>牙位病历（记录只追加）</p>
              <h2>治疗列表</h2>
            </div>
            <div className="chips filter-chips">
              {FILTERS.map((f) => (
                <button
                  key={f}
                  type="button"
                  className={filter === f ? "chip-on" : ""}
                  onClick={() => setFilter(f)}
                >
                  {f}
                  <em>
                    {f === "全部"
                      ? cases.length
                      : f === "待复诊"
                        ? pendingCount
                        : f === "已充填"
                          ? filledCount
                          : cases.length - filledCount}
                  </em>
                </button>
              ))}
            </div>
          </div>

          {filtered.length === 0 ? (
            <p className="empty">当前筛选下没有牙位。</p>
          ) : (
            <div className="tooth-list">
              {filtered.map((c) => (
                <CaseCard key={c.id} c={c} onContinue={continueTooth} />
              ))}
            </div>
          )}
        </section>
      </section>

      <section className="records panel">
        <div className="section-heading">
          <div>
            <p>实时派生 · 每次追加后同步变化</p>
            <h2>病历摘要</h2>
          </div>
          <button type="button" onClick={exportSummaries}>
            {copied ? "已复制到剪贴板 ✓" : "复制全部摘要"}
          </button>
        </div>
        <ul className="summary-list">
          {cases.map((c) => {
            const badge = caseBadge(c);
            const last = lastStageEntry(c);
            return (
              <li key={c.id}>
                <span className={`badge tone-${badge.tone}`}>{badge.label}</span>
                <span className="summary-text">{summary(c)}</span>
                {!last && <span className="muted">尚无接诊记录</span>}
              </li>
            );
          })}
        </ul>
      </section>
    </main>
  );
}

export default App;
