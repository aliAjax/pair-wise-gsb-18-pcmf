// 根管治疗（单牙位推进）领域模型与规则

export const STAGES = ["开髓", "测长", "根管预备", "封药", "充填"] as const;
export type Stage = (typeof STAGES)[number];

/** 进度条上的步骤：封药与充填之间夹着“复诊登记” */
export const STEP_LABELS = ["开髓", "测长", "根管预备", "封药", "复诊", "充填"] as const;

export interface StageEntry {
  id: string;
  kind: "stage";
  date: string; // 接诊日期 YYYY-MM-DD
  stage: Stage;
  /** 工作长度：随牙位带走，快照进每一条接诊记录 */
  workingLength?: string;
  /** 主尖锉号：随牙位带走，快照进每一条接诊记录 */
  masterFile?: string;
  note?: string;
}

export interface FollowUpEntry {
  id: string;
  kind: "followup";
  date: string; // 登记日期
  plannedDate: string; // 计划复诊日期
}

export type Entry = StageEntry | FollowUpEntry;

export interface Case {
  id: string;
  toothNo: string; // 牙位，如 #36
  diagnosis: string;
  createdAt: string;
  /** 只追加，不改写：所有接诊阶段与复诊登记都按时间顺序追加到这里 */
  entries: Entry[];
}

export function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export function stageEntries(c: Case): StageEntry[] {
  return c.entries.filter((e): e is StageEntry => e.kind === "stage");
}

export function hasStage(c: Case, stage: Stage): boolean {
  return stageEntries(c).some((e) => e.stage === stage);
}

export function lastStageEntry(c: Case): StageEntry | undefined {
  const list = stageEntries(c);
  return list[list.length - 1];
}

export function followUps(c: Case): FollowUpEntry[] {
  return c.entries.filter((e): e is FollowUpEntry => e.kind === "followup");
}

export function latestFollowUp(c: Case): FollowUpEntry | undefined {
  const list = followUps(c);
  return list[list.length - 1];
}

/** 复诊登记之后是否又有接诊阶段（患者是否已到诊继续处理） */
export function followUpAttended(c: Case): boolean {
  const fu = latestFollowUp(c);
  if (!fu) return false;
  const fuIndex = c.entries.findIndex((e) => e.id === fu.id);
  return c.entries.some((e, i) => i > fuIndex && e.kind === "stage");
}

/** 从最近一条接诊记录里取沿用值（工作长度 / 主尖锉号） */
export function carried(c: Case, field: "workingLength" | "masterFile"): string {
  const list = stageEntries(c);
  for (let i = list.length - 1; i >= 0; i--) {
    const value = list[i][field];
    if (value && value.trim()) return value;
  }
  return "";
}

export function isCompleted(c: Case): boolean {
  return hasStage(c, "充填");
}

/** 已封药、未充填、且还没有登记复诊 —— 这就是“待复诊” */
export function needsFollowUpRegistration(c: Case): boolean {
  return hasStage(c, "封药") && !isCompleted(c) && !latestFollowUp(c);
}

/** 当前允许追加的阶段；封药后未登记复诊时为空（必须先登记复诊） */
export function nextChoices(c: Case): Stage[] {
  if (isCompleted(c)) return [];
  const prereq: Stage[] = ["开髓", "测长", "根管预备"];
  for (const s of prereq) {
    if (!hasStage(c, s)) return [s];
  }
  if (!hasStage(c, "封药")) return ["封药", "充填"]; // 预备后：封药复诊，或一次性根充
  if (!latestFollowUp(c)) return []; // 已封药，缺复诊登记
  return ["充填"];
}

/** 想充填时被拦住的原因，同时也是页面上“缺了哪一步”的提示 */
export function blockReasonForFill(c: Case): string | null {
  const prereq: Stage[] = ["开髓", "测长", "根管预备"];
  for (const s of prereq) {
    if (!hasStage(c, s)) return `尚未完成「${s}」，不能充填`;
  }
  if (hasStage(c, "封药") && !latestFollowUp(c)) {
    return "已封药但未登记复诊，不能直接充填；缺少步骤：复诊登记";
  }
  return null;
}

export type BadgeTone = "danger" | "warn" | "primary" | "green" | "neutral";

export function caseBadge(c: Case): { label: string; tone: BadgeTone } {
  if (isCompleted(c)) return { label: "已充填", tone: "green" };
  if (needsFollowUpRegistration(c)) return { label: "待复诊", tone: "danger" };
  const fu = latestFollowUp(c);
  if (fu) {
    if (followUpAttended(c)) return { label: "复诊到诊·可充填", tone: "primary" };
    return { label: `已约复诊 ${fu.plannedDate}`, tone: "warn" };
  }
  const last = lastStageEntry(c);
  return { label: last ? `治疗中·${last.stage}` : "未开始", tone: "neutral" };
}

/** 步骤条上每个步骤的状态 */
export function stepState(c: Case, label: string): "done" | "now" | "missing" | "scheduled" | "skip" | "todo" {
  const done = isCompleted(c);
  if (label === "封药") {
    if (hasStage(c, "封药")) return "done";
    if (done) return "skip"; // 一次性根充，未封药
    return "todo";
  }
  if (label === "复诊") {
    const fu = latestFollowUp(c);
    if (fu) return followUpAttended(c) ? "done" : "scheduled";
    if (hasStage(c, "封药") && !done) return "missing";
    if (done) return "skip";
    return "todo";
  }
  const stage = label as Stage;
  if (hasStage(c, stage)) return "done";
  const choices = nextChoices(c);
  if (!done && choices[0] === stage) {
    // 预备之后首选是封药，但充填也合法（一次性根充）
    if (stage === "充填" && !hasStage(c, "封药")) return "now";
    if (stage !== "充填") return "now";
  }
  if (!done && needsFollowUpRegistration(c) && stage === "充填") return "blocked" as "todo";
  return "todo";
}

/** 进度条上高亮的“当前该做的事” */
export function activeStep(c: Case): string {
  if (isCompleted(c)) return "";
  if (needsFollowUpRegistration(c)) return "复诊";
  return nextChoices(c)[0] ?? "";
}

/** 单颗牙的病历摘要（随每次追加实时变化） */
export function summary(c: Case): string {
  const parts: string[] = [];
  for (const e of c.entries) {
    if (e.kind === "followup") {
      parts.push(`复诊登记（${e.date} 登记，计划 ${e.plannedDate}）`);
      continue;
    }
    const extras: string[] = [];
    if (e.workingLength) extras.push(`工作长度 ${e.workingLength}`);
    if (e.masterFile) extras.push(`主尖锉 ${e.masterFile}`);
    if (e.note) extras.push(e.note);
    parts.push(`${e.stage}（${e.date}${extras.length ? "，" + extras.join("，") : ""}）`);
  }

  let tail: string;
  if (isCompleted(c)) {
    tail = "已充填，根管治疗完成";
  } else if (needsFollowUpRegistration(c)) {
    tail = "已封药但未登记复诊，缺【复诊登记】，暂不能充填";
  } else {
    const fu = latestFollowUp(c);
    if (fu && !followUpAttended(c)) {
      tail = `已约复诊（${fu.plannedDate}），到诊后可充填`;
    } else if (fu) {
      tail = "已复诊，待充填";
    } else {
      const next = nextChoices(c)[0];
      tail = next ? `下一步：${next}` : "";
    }
  }

  return `${c.toothNo}｜${c.diagnosis}｜${parts.join(" → ")}${tail ? "｜" + tail : ""}`;
}

export function averageWorkingLength(list: Case[]): string {
  const nums: number[] = [];
  for (const c of list) {
    const wl = carried(c, "workingLength");
    const matches = wl.match(/\d+(?:\.\d+)?/g);
    matches?.forEach((v) => nums.push(Number(v)));
  }
  if (!nums.length) return "—";
  return (nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(1) + " mm";
}

export function makeStageEntry(
  date: string,
  stage: Stage,
  workingLength: string,
  masterFile: string,
  note: string
): StageEntry {
  return {
    id: uid(),
    kind: "stage",
    date,
    stage,
    workingLength: workingLength.trim() || undefined,
    masterFile: masterFile.trim() || undefined,
    note: note.trim() || undefined,
  };
}

// ---------- 演示数据与持久化 ----------

const STORAGE_KEY = "rct-cases-v1";

function seedStage(
  id: string,
  date: string,
  stage: Stage,
  extra: { workingLength?: string; masterFile?: string; note?: string } = {}
): StageEntry {
  return { id, kind: "stage", date, stage, ...extra };
}

export function buildSeed(): Case[] {
  return [
    {
      id: "seed-36",
      toothNo: "#36",
      diagnosis: "慢性根尖周炎",
      createdAt: "2026-09-12",
      entries: [
        seedStage("s36-1", "2026-09-12", "开髓", { note: "揭全髓室顶，定位根管口" }),
        seedStage("s36-2", "2026-09-12", "测长", { workingLength: "MB 19.5mm" }),
        seedStage("s36-3", "2026-09-19", "根管预备", {
          workingLength: "MB 19.5mm",
          masterFile: "#30",
          note: "机用镍钛预备，次氯酸钠冲洗",
        }),
        seedStage("s36-4", "2026-09-19", "封药", {
          workingLength: "MB 19.5mm",
          masterFile: "#30",
          note: "氢氧化钙封药，暂封",
        }),
        // 故意不登记复诊：该牙位不能直接充填
      ],
    },
    {
      id: "seed-46",
      toothNo: "#46",
      diagnosis: "急性牙髓炎",
      createdAt: "2026-09-20",
      entries: [
        seedStage("s46-1", "2026-09-20", "开髓"),
        seedStage("s46-2", "2026-09-20", "测长", {
          workingLength: "近中 19.0mm / 远中 20.5mm",
          note: "近中双根管，需复诊继续",
        }),
      ],
    },
    {
      id: "seed-11",
      toothNo: "#11",
      diagnosis: "外伤后变色",
      createdAt: "2026-09-08",
      entries: [
        seedStage("s11-1", "2026-09-08", "开髓"),
        seedStage("s11-2", "2026-09-08", "测长", { workingLength: "21.0mm" }),
        seedStage("s11-3", "2026-09-08", "根管预备", {
          workingLength: "21.0mm",
          masterFile: "#35",
        }),
        // 未封药，一次性根充，不需要复诊登记
        seedStage("s11-4", "2026-09-08", "充填", {
          workingLength: "21.0mm",
          masterFile: "#35",
          note: "单根管，冷侧压充填完成",
        }),
      ],
    },
  ];
}

export function loadCases(): Case[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed) && parsed.every((c) => c && Array.isArray((c as Case).entries))) {
        return parsed as Case[];
      }
    }
  } catch {
    // 损坏的数据直接回退到演示数据
  }
  return buildSeed();
}

export function saveCases(list: Case[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    // 存储不可用时页面仍可正常使用，只是不能跨刷新保留
  }
}
