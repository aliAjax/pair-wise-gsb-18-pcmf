import { useEffect, useMemo, useState } from "react";
import "./styles.css";

/* ---------------- 领域模型 ---------------- */

type StageType = "开髓" | "测长" | "根管预备" | "封药" | "充填";

interface StageRecord {
  id: string;
  type: StageType;
  date: string; // 接诊日期 YYYY-MM-DD
  masterApicalFile?: string; // 主尖锉号
  workingLength?: string; // 工作长度 mm
  followUpDate?: string; // 复诊日期（封药时登记）
  note?: string;
}

interface ToothCase {
  id: string;
  tooth: string; // 牙位 FDI
  diagnosis: string;
  createdAt: string;
  stages: StageRecord[]; // 仅追加，不改写
}

const STAGE_FLOW: StageType[] = ["开髓", "测长", "根管预备", "封药", "充填"];
const STORAGE_KEY = "hxwl-04-root-canal-cases";

const FDI_TEETH: string[] = [1, 2, 3, 4].flatMap((q) =>
  [1, 2, 3, 4, 5, 6, 7, 8].map((n) => `${q}${n}`)
);

const project = {
  id: "hxwl-04",
  port: 5104,
  title: "牙科根管治疗",
  subtitle: "按单颗牙推进开髓、测长、根管预备、封药与充填；封药未登记复诊不得充填",
  stack: "React + Vite + TypeScript + CSS",
  users: ["牙科医生", "助理", "前台复诊协调员"],
};

/* ---------------- 工具函数 ---------------- */

function uid() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function today() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function lastStage(c: ToothCase): StageRecord | undefined {
  return c.stages[c.stages.length - 1];
}

function lastValue(c: ToothCase, key: "masterApicalFile" | "workingLength"): string {
  for (let i = c.stages.length - 1; i >= 0; i--) {
    const v = c.stages[i][key];
    if (v) return v;
  }
  return "";
}

/** 当前允许追加的阶段 */
function allowedNextStages(c: ToothCase): StageType[] {
  const last = lastStage(c);
  if (!last) return ["开髓"];
  if (last.type === "充填") return [];
  if (last.type === "封药") return ["封药", "充填"]; // 可再次封药或充填
  return [STAGE_FLOW[STAGE_FLOW.indexOf(last.type) + 1]];
}

type Tone = "active" | "followup" | "warn" | "done";

function caseStatus(c: ToothCase): { label: string; tone: Tone } {
  const last = lastStage(c);
  if (!last) return { label: "新建", tone: "active" };
  if (last.type === "充填") return { label: "已充填 · 疗程结束", tone: "done" };
  if (last.type === "封药") {
    return last.followUpDate
      ? { label: `待复诊 · ${last.followUpDate}`, tone: "followup" }
      : { label: "待复诊 · 未登记复诊日期", tone: "warn" };
  }
  return { label: `进行中 · 已完成${last.type}`, tone: "active" };
}

interface StageDraft {
  type: StageType;
  date: string;
  masterApicalFile: string;
  workingLength: string;
  followUpDate: string;
  note: string;
}

/** 追加阶段前的校验；返回 null 表示通过，否则返回缺哪一步 */
function validateAppend(c: ToothCase, draft: StageDraft): string | null {
  const allowed = allowedNextStages(c);
  if (allowed.length === 0) return "该牙位已完成充填，疗程结束，不能再追加记录。";
  if (!draft.date) return "请填写接诊日期。";

  if (!allowed.includes(draft.type)) {
    const target = STAGE_FLOW.indexOf(draft.type);
    for (let i = 0; i < target; i++) {
      if (!c.stages.some((s) => s.type === STAGE_FLOW[i])) {
        return `缺少步骤：「${STAGE_FLOW[i]}」。需先完成「${STAGE_FLOW[i]}」，才能记录「${draft.type}」。`;
      }
    }
    return `当前阶段为「${lastStage(c)!.type}」，下一步只能记录${allowed
      .map((a) => `「${a}」`)
      .join("或")}。`;
  }

  if (draft.type === "充填") {
    const lastSeal = [...c.stages].reverse().find((s) => s.type === "封药");
    if (!lastSeal || !lastSeal.followUpDate) {
      return "缺少复诊登记：该牙位已封药但未登记复诊日期，不能直接充填。请先追加一次「封药」并登记复诊日期，或联系前台补登复诊。";
    }
  }

  if (
    (draft.type === "测长" || draft.type === "根管预备" || draft.type === "充填") &&
    !draft.workingLength.trim()
  ) {
    return `请填写工作长度：「${draft.type}」必须随牙位记录工作长度。`;
  }
  if ((draft.type === "根管预备" || draft.type === "充填") && !draft.masterApicalFile.trim()) {
    return `请填写主尖锉号：「${draft.type}」必须随牙位记录主尖锉号。`;
  }
  return null;
}

function buildSummary(c: ToothCase): string {
  const lines = c.stages.map((s, i) => {
    const extras = [
      s.masterApicalFile ? `主尖锉${s.masterApicalFile}` : "",
      s.workingLength ? `工作长度${s.workingLength}mm` : "",
      s.followUpDate ? `登记复诊${s.followUpDate}` : "",
      s.note ?? "",
    ]
      .filter(Boolean)
      .join("，");
    return `${i + 1}. ${s.date} ${s.type}${extras ? `（${extras}）` : ""}`;
  });
  return [
    `牙位 #${c.tooth}｜诊断：${c.diagnosis}｜建案：${c.createdAt}`,
    ...lines,
    `当前状态：${caseStatus(c).label}`,
  ].join("\n");
}

/* ---------------- 示例数据 ---------------- */

function seedCases(): ToothCase[] {
  return [
    {
      id: uid(),
      tooth: "36",
      diagnosis: "慢性根尖周炎",
      createdAt: "2026-09-02",
      stages: [
        { id: uid(), type: "开髓", date: "2026-09-02", note: "局麻下开髓，揭净髓顶" },
        { id: uid(), type: "测长", date: "2026-09-02", workingLength: "19.5", note: "MB/DB/L 三根管，电测+拍片确认" },
        { id: uid(), type: "根管预备", date: "2026-09-09", masterApicalFile: "#30", workingLength: "19.5", note: "机用镍钛预备至 #30" },
        { id: uid(), type: "封药", date: "2026-09-09", masterApicalFile: "#30", workingLength: "19.5", followUpDate: "2026-09-28", note: "氢氧化钙暂封" },
      ],
    },
    {
      id: uid(),
      tooth: "26",
      diagnosis: "慢性牙髓炎",
      createdAt: "2026-09-15",
      stages: [
        { id: uid(), type: "开髓", date: "2026-09-15" },
        { id: uid(), type: "测长", date: "2026-09-15", workingLength: "21.0" },
        { id: uid(), type: "根管预备", date: "2026-09-22", masterApicalFile: "#25", workingLength: "21.0" },
        { id: uid(), type: "封药", date: "2026-09-22", masterApicalFile: "#25", workingLength: "21.0", note: "患者暂未约定复诊" },
      ],
    },
    {
      id: uid(),
      tooth: "46",
      diagnosis: "急性牙髓炎",
      createdAt: "2026-09-20",
      stages: [
        { id: uid(), type: "开髓", date: "2026-09-20", note: "开髓引流，缓解急性症状" },
        { id: uid(), type: "测长", date: "2026-09-20", workingLength: "20.5", note: "近中双根管需复诊" },
      ],
    },
    {
      id: uid(),
      tooth: "11",
      diagnosis: "外伤后变色",
      createdAt: "2026-08-20",
      stages: [
        { id: uid(), type: "开髓", date: "2026-08-20" },
        { id: uid(), type: "测长", date: "2026-08-20", workingLength: "22.0" },
        { id: uid(), type: "根管预备", date: "2026-08-27", masterApicalFile: "#40", workingLength: "22.0" },
        { id: uid(), type: "封药", date: "2026-08-27", masterApicalFile: "#40", workingLength: "22.0", followUpDate: "2026-09-10" },
        { id: uid(), type: "充填", date: "2026-09-10", masterApicalFile: "#40", workingLength: "22.0", note: "单根管，冷侧压完成" },
      ],
    },
  ];
}

function loadCases(): ToothCase[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (
        Array.isArray(parsed) &&
        parsed.every((c) => c && typeof c.tooth === "string" && Array.isArray(c.stages))
      ) {
        return parsed;
      }
    }
  } catch {
    /* 数据损坏时回退示例数据 */
  }
  return seedCases();
}

/* ---------------- 小组件 ---------------- */

const toneClass: Record<Tone, string> = {
  active: "badge-active",
  followup: "badge-followup",
  warn: "badge-warn",
  done: "badge-done",
};

function MetricCard({ label, value, hint, index }: { label: string; value: string; hint: string; index: number }) {
  const colors = ["status-ok", "status-watch", "status-danger", "status-ok"];
  return (
    <article className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{hint}</small>
      <i className={colors[index % colors.length]} />
    </article>
  );
}

function StageChips({ c }: { c: ToothCase }) {
  const last = lastStage(c);
  return (
    <div className="stage-chips">
      {STAGE_FLOW.map((st) => {
        const done = c.stages.some((s) => s.type === st);
        const cls = done ? (last?.type === st ? "chip done current" : "chip done") : "chip";
        return (
          <span key={st} className={cls}>
            {st}
          </span>
        );
      })}
    </div>
  );
}

/* ---------------- 追加复诊表单 ---------------- */

function AddStageForm({
  toothCase,
  onAppend,
}: {
  toothCase: ToothCase;
  onAppend: (caseId: string, rec: StageRecord) => void;
}) {
  const allowed = allowedNextStages(toothCase);
  const [draft, setDraft] = useState<StageDraft>({
    type: allowed[0] ?? "充填",
    date: today(),
    // 牙位、主尖锉号、工作长度一起带走：从最近一次记录预填
    masterApicalFile: lastValue(toothCase, "masterApicalFile"),
    workingLength: lastValue(toothCase, "workingLength"),
    followUpDate: "",
    note: "",
  });
  const [error, setError] = useState<string | null>(null);

  if (allowed.length === 0) {
    return <p className="done-note">该牙位已完成充填，疗程结束。历史记录仅可查看，不可改写。</p>;
  }

  const set = (patch: Partial<StageDraft>) => setDraft((d) => ({ ...d, ...patch }));

  const submit = () => {
    const err = validateAppend(toothCase, draft);
    if (err) {
      setError(err);
      return;
    }
    onAppend(toothCase.id, {
      id: uid(),
      type: draft.type,
      date: draft.date,
      masterApicalFile: draft.masterApicalFile.trim() || undefined,
      workingLength: draft.workingLength.trim() || undefined,
      followUpDate: draft.followUpDate || undefined,
      note: draft.note.trim() || undefined,
    });
    setError(null);
  };

  return (
    <div className="append-form">
      <h3>
        追加复诊记录 <small>仅追加新阶段，历史记录不可改写</small>
      </h3>
      <p className="hint-line">
        下一步可记录：{allowed.map((a) => `「${a}」`).join(" 或 ")}
        {draft.type === "充填" && !allowed.includes("充填") && (
          <em>（当前不可充填，提交后将提示缺少的步骤）</em>
        )}
      </p>
      <div className="field-grid">
        <label>
          <span>接诊阶段</span>
          <select value={draft.type} onChange={(e) => set({ type: e.target.value as StageType })}>
            {STAGE_FLOW.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>接诊日期</span>
          <input type="date" value={draft.date} onChange={(e) => set({ date: e.target.value })} />
        </label>
        <label>
          <span>主尖锉号（随牙位带走）</span>
          <input
            placeholder="如 #30"
            value={draft.masterApicalFile}
            onChange={(e) => set({ masterApicalFile: e.target.value })}
          />
        </label>
        <label>
          <span>工作长度 mm（随牙位带走）</span>
          <input
            placeholder="如 19.5"
            value={draft.workingLength}
            onChange={(e) => set({ workingLength: e.target.value })}
          />
        </label>
        <label>
          <span>复诊日期（封药时登记）</span>
          <input
            type="date"
            value={draft.followUpDate}
            onChange={(e) => set({ followUpDate: e.target.value })}
          />
        </label>
        <label>
          <span>备注</span>
          <input
            placeholder="冲洗、暂封材料等"
            value={draft.note}
            onChange={(e) => set({ note: e.target.value })}
          />
        </label>
      </div>
      {error && <p className="error-box">{error}</p>}
      <button className="primary-action" onClick={submit}>
        追加「{draft.type}」记录
      </button>
    </div>
  );
}

/* ---------------- 病历摘要（选中牙位） ---------------- */

function CaseDetail({
  toothCase,
  onAppend,
}: {
  toothCase: ToothCase;
  onAppend: (caseId: string, rec: StageRecord) => void;
}) {
  const status = caseStatus(toothCase);
  const [copied, setCopied] = useState(false);
  const summary = buildSummary(toothCase);
  const maf = lastValue(toothCase, "masterApicalFile");
  const wl = lastValue(toothCase, "workingLength");
  const allowed = allowedNextStages(toothCase);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(summary);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section className="panel detail-panel">
      <div className="section-heading">
        <div>
          <p>病历摘要</p>
          <h2>
            #{toothCase.tooth} · {toothCase.diagnosis}
          </h2>
        </div>
        <span className={`badge ${toneClass[status.tone]}`}>{status.label}</span>
      </div>

      <div className="carry-row">
        <div>
          <span>牙位</span>
          <strong>#{toothCase.tooth}</strong>
        </div>
        <div>
          <span>主尖锉号</span>
          <strong>{maf || "—"}</strong>
        </div>
        <div>
          <span>工作长度</span>
          <strong>{wl ? `${wl} mm` : "—"}</strong>
        </div>
        <div>
          <span>下一步</span>
          <strong>{allowed.length ? allowed.join(" / ") : "疗程结束"}</strong>
        </div>
      </div>

      <ol className="timeline">
        {toothCase.stages.map((s, i) => (
          <li key={s.id}>
            <div className="timeline-dot">{i + 1}</div>
            <div className="timeline-body">
              <div className="timeline-head">
                <strong>{s.type}</strong>
                <time>{s.date}</time>
                {s.followUpDate && <span className="badge badge-followup">复诊 {s.followUpDate}</span>}
              </div>
              <p>
                {[
                  s.masterApicalFile && `主尖锉 ${s.masterApicalFile}`,
                  s.workingLength && `工作长度 ${s.workingLength}mm`,
                  s.note,
                ]
                  .filter(Boolean)
                  .join(" · ") || "—"}
              </p>
            </div>
          </li>
        ))}
      </ol>

      <div className="summary-block">
        <pre>{summary}</pre>
        <button onClick={copy}>{copied ? "已复制" : "复制摘要"}</button>
      </div>

      <AddStageForm
        key={`${toothCase.id}:${toothCase.stages.length}`}
        toothCase={toothCase}
        onAppend={onAppend}
      />
    </section>
  );
}

/* ---------------- 主应用 ---------------- */

const FILTERS = ["全部", "进行中", "待复诊", "未登记复诊", "已充填"] as const;
type Filter = (typeof FILTERS)[number];

function matchFilter(c: ToothCase, filter: Filter): boolean {
  const last = lastStage(c);
  if (!last) return filter === "全部" || filter === "进行中";
  switch (filter) {
    case "进行中":
      return last.type !== "封药" && last.type !== "充填";
    case "待复诊":
      return last.type === "封药";
    case "未登记复诊":
      return last.type === "封药" && !last.followUpDate;
    case "已充填":
      return last.type === "充填";
    default:
      return true;
  }
}

function App() {
  const [cases, setCases] = useState<ToothCase[]>(loadCases);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("全部");
  const [newCase, setNewCase] = useState({ tooth: "", diagnosis: "", date: today(), note: "" });
  const [newCaseError, setNewCaseError] = useState<string | null>(null);

  // 持久化：下次打开接着处理
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cases));
    } catch {
      /* 存储不可用时忽略 */
    }
  }, [cases]);

  const metrics = useMemo(() => {
    const filled = cases.filter((c) => lastStage(c)?.type === "充填").length;
    const sealing = cases.filter((c) => lastStage(c)?.type === "封药");
    const followupReady = sealing.filter((c) => lastStage(c)?.followUpDate).length;
    const noFollowup = sealing.length - followupReady;
    const lengths = cases
      .flatMap((c) => c.stages)
      .map((s) => parseFloat(s.workingLength ?? ""))
      .filter((n) => !Number.isNaN(n));
    const avg = lengths.length
      ? `${(lengths.reduce((a, b) => a + b, 0) / lengths.length).toFixed(1)} mm`
      : "—";
    return [
      {
        label: "待复诊",
        value: String(followupReady),
        hint: noFollowup ? `另有 ${noFollowup} 颗封药未登记复诊` : "封药牙位均已登记复诊",
      },
      { label: "已充填", value: String(filled), hint: "完成根管充填的牙位" },
      {
        label: "平均工作长度",
        value: avg,
        hint: `基于 ${lengths.length} 条测长/预备/充填记录`,
      },
      { label: "封药病例", value: String(sealing.length), hint: "当前处于封药阶段的牙位" },
    ];
  }, [cases]);

  const filtered = useMemo(() => cases.filter((c) => matchFilter(c, filter)), [cases, filter]);
  const selected = cases.find((c) => c.id === selectedId) ?? filtered[0] ?? cases[0];

  const appendStage = (caseId: string, rec: StageRecord) => {
    setCases((prev) =>
      prev.map((c) => (c.id === caseId ? { ...c, stages: [...c.stages, rec] } : c))
    );
  };

  const createCase = () => {
    if (!newCase.tooth) return setNewCaseError("请选择牙位。");
    if (!newCase.diagnosis.trim()) return setNewCaseError("请填写诊断。");
    if (!newCase.date) return setNewCaseError("请填写开髓日期。");
    const existing = cases.find(
      (c) => c.tooth === newCase.tooth && lastStage(c)?.type !== "充填"
    );
    if (existing) {
      setSelectedId(existing.id);
      return setNewCaseError(
        `牙位 #${newCase.tooth} 已有进行中的病案，已在下方选中，请直接追加复诊记录。`
      );
    }
    const c: ToothCase = {
      id: uid(),
      tooth: newCase.tooth,
      diagnosis: newCase.diagnosis.trim(),
      createdAt: newCase.date,
      stages: [
        { id: uid(), type: "开髓", date: newCase.date, note: newCase.note.trim() || undefined },
      ],
    };
    setCases((prev) => [c, ...prev]);
    setSelectedId(c.id);
    setNewCase({ tooth: "", diagnosis: "", date: today(), note: "" });
    setNewCaseError(null);
  };

  const resetSeeds = () => {
    const seeded = seedCases();
    setCases(seeded);
    setSelectedId(null);
    setFilter("全部");
  };

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">
            {project.id} · port {project.port}
          </p>
          <h1>{project.title}</h1>
          <p className="subtitle">{project.subtitle}</p>
        </div>
        <div className="stack-card">
          <span>技术栈</span>
          <strong>{project.stack}</strong>
          <span>流程规则</span>
          <strong>开髓 → 测长 → 根管预备 → 封药 →（登记复诊）→ 充填</strong>
        </div>
      </section>

      <section className="metrics-grid">
        {metrics.map((m, index) => (
          <MetricCard key={m.label} label={m.label} value={m.value} hint={m.hint} index={index} />
        ))}
      </section>

      <section className="workspace">
        <aside className="panel narrow">
          <h2>角色</h2>
          <div className="chips">
            {project.users.map((user) => (
              <span key={user}>{user}</span>
            ))}
          </div>
          <h2>筛选</h2>
          <div className="chips muted">
            {FILTERS.map((f) => (
              <button
                key={f}
                className={filter === f ? "chip-active" : ""}
                onClick={() => setFilter(f)}
              >
                {f}
              </button>
            ))}
          </div>
          <button className="ghost-action" onClick={resetSeeds}>
            恢复示例数据
          </button>
        </aside>

        <section className="panel">
          <div className="section-heading">
            <div>
              <p>初诊建案</p>
              <h2>新牙位开髓</h2>
            </div>
            <button className="primary-action" onClick={createCase}>
              建案并记录开髓
            </button>
          </div>
          <div className="field-grid">
            <label>
              <span>牙位（FDI）</span>
              <select
                value={newCase.tooth}
                onChange={(e) => setNewCase({ ...newCase, tooth: e.target.value })}
              >
                <option value="">选择牙位</option>
                {FDI_TEETH.map((t) => (
                  <option key={t} value={t}>
                    #{t}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>诊断</span>
              <input
                placeholder="如 慢性根尖周炎"
                value={newCase.diagnosis}
                onChange={(e) => setNewCase({ ...newCase, diagnosis: e.target.value })}
              />
            </label>
            <label>
              <span>开髓日期</span>
              <input
                type="date"
                value={newCase.date}
                onChange={(e) => setNewCase({ ...newCase, date: e.target.value })}
              />
            </label>
            <label>
              <span>备注</span>
              <input
                placeholder="麻醉方式、髓腔情况等"
                value={newCase.note}
                onChange={(e) => setNewCase({ ...newCase, note: e.target.value })}
              />
            </label>
          </div>
          {newCaseError && <p className="error-box">{newCaseError}</p>}
        </section>
      </section>

      <section className="records-layout">
        <div className="panel list-panel">
          <div className="section-heading">
            <div>
              <p>牙位列表</p>
              <h2>
                {filtered.length} / {cases.length} 颗牙
              </h2>
            </div>
          </div>
          <div className="record-list">
            {filtered.length === 0 && <p className="empty-note">没有符合筛选的病案。</p>}
            {filtered.map((c) => {
              const status = caseStatus(c);
              return (
                <article
                  key={c.id}
                  className={`record-card ${selected?.id === c.id ? "selected" : ""}`}
                  onClick={() => setSelectedId(c.id)}
                >
                  <div className="record-index">#{c.tooth}</div>
                  <div className="record-main">
                    <div className="record-head">
                      <h3>{c.diagnosis}</h3>
                      <span className={`badge ${toneClass[status.tone]}`}>{status.label}</span>
                    </div>
                    <StageChips c={c} />
                    <p>
                      主尖锉 {lastValue(c, "masterApicalFile") || "—"} · 工作长度{" "}
                      {lastValue(c, "workingLength") || "—"}mm · 建案 {c.createdAt}
                    </p>
                  </div>
                </article>
              );
            })}
          </div>
        </div>

        {selected ? (
          <CaseDetail toothCase={selected} onAppend={appendStage} />
        ) : (
          <section className="panel detail-panel">
            <p className="empty-note">暂无病案，请先建案。</p>
          </section>
        )}
      </section>
    </main>
  );
}

export default App;
